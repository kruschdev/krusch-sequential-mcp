#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Dynamic Version ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
let PKG_VERSION = '1.0.0';
try {
  const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback to hardcoded */ }

// ── Database Pool ───────────────────────────────────────────────────────────
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[krusch-sequential-mcp] WARNING: DATABASE_URL not set. Thought persistence is disabled.');
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function initDb() {
  if (!pool) return;
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

// ── Inlined Plausibility Evaluator ──────────────────────────────────────────
// Self-contained — no @krusch/toolkit dependency required.
// Uses a local Ollama model to screen thoughts against grounding context.

interface PlausibilityResult {
  isPlausible: boolean;
  reason: string;
}

function parseAIJson(text: string): Record<string, unknown> {
  if (!text || typeof text !== 'string') {
    return { raw: text, parseError: true };
  }

  // Strip <think> blocks and markdown code fences
  const stripped = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json|javascript|js)?\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    // Try to extract first { ... } block
    const jsonMatch = stripped.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch { /* fall through */ }
    }
    return { raw: text, parseError: true };
  }
}

async function evaluatePlausibility(
  sourceContext: string,
  generatedOutput: string,
  ollamaUrl: string,
  model: string
): Promise<PlausibilityResult> {
  const systemPrompt = `You are a strict, zero-tolerance Plausibility Evaluator.
Your ONLY job is to determine if the Generated Output hallucinates or introduces facts, variables, or claims NOT present in the Source Context.

Rules:
1. If the Output is supported by or reasonably inferred from the Source Context, it is Plausible (PASS).
2. If the Output invents names, numbers, rules, or claims not found in the Context, it is Implausible (FAIL).
3. Do not evaluate style, tone, or formatting. Only semantic truth against the source.

Return a JSON object:
{
  "reasoning": "Brief explanation of which claims are or are not supported.",
  "isPlausible": boolean
}`;

  const userMessage = `## Source Context\n${sourceContext}\n\n## Generated Output\n${generatedOutput}`;

  const apiUrl = `${ollamaUrl}/v1/chat/completions`;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      temperature: 0.0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama API ${res.status}: ${err}`);
  }

  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || '';
  const result = parseAIJson(text);

  return {
    isPlausible: !!result.isPlausible,
    reason: (result.reasoning as string) || 'No reason provided.',
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── MCP Server ──────────────────────────────────────────────────────────────

class SequentialThinkingServer {
  private server: Server;
  private thoughtHistory: ThoughtData[] = [];
  private branches: Record<string, ThoughtData[]> = {};

  constructor() {
    this.server = new Server(
      {
        name: 'krusch-sequential-mcp',
        version: PKG_VERSION,
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

    // Graceful shutdown
    const shutdown = async () => {
      console.error('[krusch-sequential-mcp] Shutting down...');
      await this.server.close();
      if (pool) await pool.end();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
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

      const args = request.params.arguments as Record<string, unknown>;
      
      // 1. Intercept for Plausibility Check
      if (args.groundingContext) {
        console.error(`[Plausibility Check] Intercepting thought #${args.thoughtNumber}`);
        
        const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
        const model = process.env.PLAUSIBILITY_MODEL || 'qwen2.5-coder:1.5b';

        try {
          const evalResult = await evaluatePlausibility(
            args.groundingContext as string,
            args.thought as string,
            ollamaUrl,
            model
          );
          
          if (!evalResult.isPlausible) {
            console.error(`[Plausibility Rejected] Thought #${args.thoughtNumber}: ${evalResult.reason}`);
            // Return a soft error to the agent to naturally correct itself
            return {
              content: [
                {
                  type: 'text',
                  text: `THOUGHT REJECTED BY PLAUSIBILITY GATE:\nYour thought hallucinates facts or introduces variables not found in the groundingContext.\nReason: ${evalResult.reason}\nAction: You must rethink and submit a revised thought that strictly adheres to the groundingContext.`,
                },
              ],
              isError: true,
            };
          }
        } catch (e) {
          console.error(`[Plausibility Error] Failed to execute evaluator: ${e}`);
          // Fail-open: allow the thought to proceed if the evaluator is unavailable
        }
      }

      // 2. Accept and Store Thought
      const thoughtData: ThoughtData = {
        thought: args.thought as string,
        thoughtNumber: args.thoughtNumber as number,
        totalThoughts: args.totalThoughts as number,
        nextThoughtNeeded: args.nextThoughtNeeded as boolean,
        isRevision: args.isRevision as boolean | undefined,
        revisesThought: args.revisesThought as number | undefined,
        branchFromThought: args.branchFromThought as number | undefined,
        branchId: args.branchId as string | undefined,
        needsMoreThoughts: args.needsMoreThoughts as boolean | undefined,
      };

      if (args.branchId) {
        const bid = args.branchId as string;
        if (!this.branches[bid]) {
          this.branches[bid] = [];
        }
        this.branches[bid].push(thoughtData);
      } else {
        this.thoughtHistory.push(thoughtData);
      }

      // Persist to DBOS PostgreSQL
      if (pool) {
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
      }

      // Format response
      let responseText = `Thought #${args.thoughtNumber} accepted.`;
      if (args.isRevision) responseText += ` (Revised thought #${args.revisesThought})`;
      if (args.branchId) responseText += ` (Branch: ${args.branchId})`;
      
      responseText += `\nTotal thoughts completed: ${this.thoughtHistory.length}`;
      
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
    console.error(`krusch-sequential-mcp v${PKG_VERSION} running on stdio${pool ? ' with DBOS persistence' : ' (no DATABASE_URL — persistence disabled)'}`);
  }
}

const server = new SequentialThinkingServer();
server.run().catch(console.error);
