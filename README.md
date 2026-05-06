<p align="center">
  <strong>Krusch Sequential MCP</strong>
</p>

<p align="center">
  <strong>An advanced Model Context Protocol (MCP) server for reflective chain-of-thought, augmented with Semantic Plausibility Gating and DBOS PostgreSQL persistence.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/krusch-sequential-mcp"><img src="https://img.shields.io/github/package-json/v/kruschdev/krusch-sequential-mcp.svg?style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/kruschdev/krusch-sequential-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kruschdev/krusch-sequential-mcp.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-blue.svg?style=flat-square" alt="Node Version">
</p>

---

## ⚡ Why Krusch Sequential MCP?

The standard `sequential-thinking` MCP provides a great tool for chain-of-thought reasoning, but it suffers from the "Telephone Game" problem in multi-agent environments, where agents can confidently hallucinate ungrounded thoughts that poison the context window.

`krusch-sequential-mcp` solves this by introducing **Semantic Plausibility Gating** alongside a highly reliable **DBOS PostgreSQL persistence** layer.

### Key Features
- **🧠 Semantic Plausibility Gating:** Autonomously rejects drifted or hallucinated thoughts via an edge model evaluator.
- **💾 DBOS PostgreSQL Persistence:** Synchronously persists every thought, branch, and revision into a `dbos_thoughts` table, creating an auditable DAG of reasoning.
- **🛑 Deterministic State Reliability:** Halts poisoned thought execution, forcing agents to re-evaluate their reasoning path.
- **🔌 Drop-In Replacement:** Fully compatible with the standard `sequential-thinking` interface while supporting the new `groundingContext` parameter.

---

## 🧠 Architecture: Semantic Plausibility Gate

When an agent proposes a thought, the internal evaluator screens it against the provided `groundingContext`.

```mermaid
graph TD;
    A[Agent Thought Proposed] --> B{Grounding Context Provided?};
    B -- No --> C[Accept & Persist to DBOS];
    B -- Yes --> D[Edge Model Evaluator];
    D -- Plausible --> C;
    D -- Hallucinated/Drifted --> E[Reject Thought];
    E --> F[Return Soft Error to Agent];
    F --> G[Agent Re-evaluates];
```

---

## 📦 Installation

```bash
npm install -g krusch-sequential-mcp
```

Or configure it in your MCP settings file (e.g., `claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "krusch-sequential-mcp": {
      "command": "npx",
      "args": ["-y", "krusch-sequential-mcp"]
    }
  }
}
```

---

## 🚀 Quick Start Guide

Agents can invoke the `sequentialthinking` tool with the standard parameters (`thought`, `thoughtNumber`, `totalThoughts`, `nextThoughtNeeded`, etc.). 

To engage the plausibility gate, include the `groundingContext` parameter in your tool call:

```json
{
  "thought": "Since the user is asking about the database schema, I will assume it uses MongoDB and write a query for it.",
  "thoughtNumber": 1,
  "totalThoughts": 3,
  "nextThoughtNeeded": true,
  "groundingContext": "The current codebase exclusively uses DBOS PostgreSQL for persistence. No NoSQL databases are present."
}
```
*Because the thought conflicts with the `groundingContext`, the evaluator will autonomously reject it, returning an error to the agent to rethink its approach.*

---

## ⚙️ Environment Variables

- `DATABASE_URL` (optional): PostgreSQL connection string. Defaults to `postgres://openclaw:openclaw_password@kruschserv:5434/kruschdb`.
- `OLLAMA_URL` (optional): URL to the Ollama service for plausibility checks. Defaults to `http://localhost:11434`.

---

## 🤝 Contributing

We welcome contributions! Please ensure your tests pass and adhere to the project formatting standards.
Run tests via `npm run build` and `npm start` (or `node build/index.js`).

## 📄 License

MIT License © 2026 kruschdev
