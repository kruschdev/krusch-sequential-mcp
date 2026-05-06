# krusch-sequential-mcp

A fork of the Model Context Protocol (MCP) `sequential-thinking` server, augmented with **Semantic Plausibility Gating** and **DBOS PostgreSQL persistence**.

## Overview

This MCP server provides a `sequentialthinking` tool for dynamic, reflective problem-solving through chain-of-thought. It enhances the original implementation by adding:

1. **Semantic Plausibility Gating:** An interceptor that evaluates the semantic plausibility of a thought against an optional `groundingContext`. If a thought hallucinated facts or drifted from the context, it is autonomously rejected and returned as a soft error, forcing the agent to rethink.
2. **DBOS PostgreSQL Persistence:** Every thought, branch, and revision is synchronously persisted to a Postgres database (`dbos_thoughts` table) to maintain an auditable, deterministic DAG of the swarm's reasoning process.

## Usage

Agents can invoke the `sequentialthinking` tool with the standard parameters (`thought`, `thoughtNumber`, `totalThoughts`, `nextThoughtNeeded`, etc.). 

To engage the plausibility gate, include the `groundingContext` parameter. The server will use a fast edge-model (e.g., `qwen2.5-coder:1.5b`) to evaluate the thought before accepting it.

## Environment Variables

- `DATABASE_URL` (optional): PostgreSQL connection string. Defaults to `postgres://openclaw:openclaw_password@kruschserv:5434/kruschdb`.
- `OLLAMA_URL` (optional): URL to the Ollama service for plausibility checks. Defaults to `http://localhost:11434`.

## Installation

```bash
npm install
npm run build
npm start
```
