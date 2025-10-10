# CharacterRPG ChatGPT Companion (Preview Scaffold)

This directory hosts the Apps SDK project that will power our ChatGPT “Companion” experience. It is currently a stub MCP server with two tools (`listCharacters`, `sessionTelemetry`); we’ll flesh out the full dashboard and action flow next.

## Setup

```bash
cd apps/chatgpt-companion
npm install
npm run dev
```

The MCP server assumes your CharacterRPG API is reachable at `http://localhost:4000` (override with `CRPG_API_BASE`). When ChatGPT invokes tools it will forward BYOK secrets (we map `openai_key` to `X-Provider-Key`).

## Roadmap
- Add tools for session start/resume, sending turns, toggling `/reseed`.
- Render the dashboard UI (Apps SDK components) with retrieval telemetry.
- Integrate AgentKit Evals once the workflow is stable.
