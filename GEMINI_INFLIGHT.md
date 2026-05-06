# Session State: krusch-sequential-mcp

## Active Goal
Built and tested the krusch-sequential-mcp fork with native Semantic Plausibility Gating and DBOS PostgreSQL persistence. Selected the name `krusch-sequential-mcp` for the upcoming public open-source repository release.

## Fragile Files / Context
- `projects/krusch-sequential-mcp/src/index.ts` (Core MCP logic with DBOS PG pool and evaluatePlausibility interceptor)
- `lib/evaluator.js` (The underlying Plausibility Gate logic inside @krusch/toolkit)
- `projects/krusch-sequential-mcp/package.json` (Includes local file symlinks and pg dependencies)

## Next Steps (for /continue)
1. Initialize a Git repository for `krusch-sequential-mcp` or prepare it for extraction to a public repo.
2. Draft the `README.md` and repository metadata highlighting Semantic Plausibility Gating and DBOS persistence.
3. Configure the NPM publishing pipeline (similar to `krusch-router`).
