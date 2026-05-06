import { spawn } from 'child_process';
import path from 'path';

async function runTest() {
  console.log("=== Testing krusch-sequential-mcp ===");
  
  // Build first
  console.log("Building...");
  await new Promise((resolve) => {
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    build.on('close', resolve);
  });

  // Start the server
  const serverPath = path.resolve('./build/index.js');
  const server = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

  // Listen for output
  server.stdout.on('data', (data) => {
    const msg = data.toString();
    console.log("[MCP Response]", msg);
    
    // We expect a JSON-RPC response rejecting the thought
    if (msg.includes('THOUGHT REJECTED BY PLAUSIBILITY GATE')) {
      console.log("✅ Success: Plausibility gate intercepted and rejected the poisoned thought.");
      server.kill();
      process.exit(0);
    }
  });

  // Wait a second for DB connection to init
  await new Promise(r => setTimeout(r, 1000));

  // Send a JSON-RPC request simulating an agent calling the tool with a poisoned thought
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "sequentialthinking",
      arguments: {
        thought: "I will process the refund for User ID 405 because they are a Platinum Tier member and have a balance of $500.",
        thoughtNumber: 1,
        totalThoughts: 3,
        nextThoughtNeeded: true,
        groundingContext: "User ID 405 requested a refund. Account balance is $50. Refund policy allows it within 30 days."
      }
    }
  };

  console.log("Sending poisoned thought to MCP...");
  server.stdin.write(JSON.stringify(request) + "\\n");
}

runTest().catch(console.error);
