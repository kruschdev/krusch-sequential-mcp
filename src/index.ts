#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { evaluatePlausibility } from '@krusch/toolkit/evaluator';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://openclaw:openclaw_password@kruschserv:5434/kruschdb'
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dbos_thoughts (
      id SERIAL PRIMARY KEY,
      thought_number INTEGER,
      total_thoughts INTEGER,
      is_revision BOOLEAN,
      revises_thought INTEGER,
      branch_from_thought INTEGER,
      branch_id VARCHAR(255),
      needs_more_thoughts BOOLEAN,
      thought_content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
}

class SequentialThinkingServer {
  private server: Server;
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};

  constructor() {
    this.server = new Server(
      {
        name: 'krusch-sequential-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'sequentialthinking',
          description: 'A detailed tool for dynamic and reflective problem-solving through thoughts. Augmented with Semantic Plausibility Gating.',
          inputSchema: {
            type: 'object',
            properties: {
              thought: { type: 'string', description: 'Your current thinking step' },
              nextThoughtNeeded: { type: 'boolean', description: 'Whether another thought step is needed' },
              thoughtNumber: { type: 'integer', description: 'Current thought number' },
              totalThoughts: { type: 'integer', description: 'Estimated total thoughts needed' },
              isRevision: { type: 'boolean', description: 'Whether this revises previous thinking' },
              revisesThought: { type: 'integer', description: 'Which thought is being reconsidered' },
              branchFromThought: { type: 'integer', description: 'Branching point thought number' },
              branchId: { type: 'string', description: 'Branch identifier' },
              needsMoreThoughts: { type: 'boolean', description: 'If more thoughts are needed' },
              groundingContext: { type: 'string', description: 'OPTIONAL: Provide the source context for this thought. The server will independently verify the plausibility of your thought against this context.' }
            },
            required: ['thought', 'nextThoughtNeeded', 'thoughtNumber', 'totalThoughts'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'sequentialthinking') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }

      const args = request.params.arguments as any;
      
      // 1. Intercept for Plausibility Check
      if (args.groundingContext) {
        console.error(`[Plausibility Check] Intercepting thought #${args.thoughtNumber}`);
        
        // Use local Ollama qwen2.5-coder:1.5b configured via env
        const config = {
          provider: 'ollama',
          apiUrl: process.env.OLLAMA_URL ? `\${process.env.OLLAMA_URL}/v1/chat/completions` : 'http://localhost:11434/v1/chat/completions',
          model: 'qwen2.5-coder:1.5b'
        };

        try {
          const evalResult = await evaluatePlausibility(args.groundingContext, args.thought, config, { useFastModel: true });
          
          if (!evalResult.isPlausible) {
            console.error(`[Plausibility Rejected] Thought #${args.thoughtNumber}: ${evalResult.reason}`);
            // Return a soft error to the agent to naturally correct itself
            return {
              content: [
                {
                  type: 'text',
                  text: `THOUGHT REJECTED BY PLAUSIBILITY GATE:
Your thought hallucinates facts or introduces variables not found in the groundingContext.
Reason: \${evalResult.reason}
Action: You must rethink and submit a revised thought that strictly adheres to the groundingContext.`,
                },
              ],
              isError: true,
            };
          }
        } catch (e) {
          console.error(`[Plausibility Error] Failed to execute evaluator: ${e}`);
        }
      }

      // 2. Accept and Store Thought
      const thoughtData: ThoughtData = {
        thought: args.thought,
        thoughtNumber: args.thoughtNumber,
        totalThoughts: args.totalThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
        isRevision: args.isRevision,
        revisesThought: args.revisesThought,
        branchFromThought: args.branchFromThought,
        branchId: args.branchId,
        needsMoreThoughts: args.needsMoreThoughts,
      };

      if (args.branchId) {
        if (!this.branches[args.branchId]) {
          this.branches[args.branchId] = [];
        }
        this.branches[args.branchId].push(thoughtData);
      } else {
        this.thoughtHistory.push(thoughtData);
      }

      // Persist to DBOS PostgreSQL
      try {
        await pool.query(
          `INSERT INTO dbos_thoughts 
          (thought_number, total_thoughts, is_revision, revises_thought, branch_from_thought, branch_id, needs_more_thoughts, thought_content) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            args.thoughtNumber,
            args.totalThoughts,
            args.isRevision || false,
            args.revisesThought || null,
            args.branchFromThought || null,
            args.branchId || null,
            args.needsMoreThoughts || false,
            args.thought
          ]
        );
      } catch (e) {
        console.error('[DBOS Persistence Error] Failed to persist thought:', e);
      }

      // Format response
      let responseText = `Thought #${args.thoughtNumber} accepted.`;
      if (args.isRevision) responseText += ` (Revised thought #${args.revisesThought})`;
      if (args.branchId) responseText += ` (Branch: \${args.branchId})`;
      
      responseText += `\\nTotal thoughts completed: \${this.thoughtHistory.length}`;
      
      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    });
  }

  async run() {
    await initDb();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('krusch-sequential-mcp server running on stdio with DBOS persistence');
  }
}

const server = new SequentialThinkingServer();
server.run().catch(console.error);
