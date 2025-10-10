# ChatGPT Companion (Apps SDK + MCP)

_Last updated: 2025-10-10_

## Objectives
- Provide a lightweight “control tower” for CharacterRPG inside ChatGPT (dashboard, quick actions, retrieval telemetry).
- Reuse the Model Context Protocol so future AgentKit workflows can share tools/components.
- Respect BYOK defaults (OpenAI `gpt-5-mini` / `gpt-5-nano`, Ollama reviewer via `deepseek-r1:1.5b`).

## Project Layout
```
apps/chatgpt-companion/
  package.json
  tsconfig.json
  src/server.ts   # MCP tool handlers (listCharacters, sessionTelemetry, startSession, sendTurn, reseedPrompts)
  README.md
```

## MCP Tools (v0)
| Tool            | Description                                      | Notes |
|-----------------|--------------------------------------------------|-------|
| `listCharacters`| GET `/api/characters`                             | forwards BYOK header |
| `sessionTelemetry` | GET `/api/usage/:sessionId` (new consolidated endpoint) | surfaces retrieval + usage stats |
| `startSession`  | POST `/api/sessions` with participant IDs         | defaults provider=`openai` |
| `sendTurn`      | POST `/api/convo/turn`                            | exposes `useRag`, `style_short` toggles |
| `reseedPrompts` | Sends `/reseed all` into `/api/convo/turn`        | ideal for “refresh context” button |

## Server Changes (supporting tools)
- Added `server/src/routes/usage.ts` and mounted it at `/api/usage` to read JSONL usage logs (generation + retrieval telemetry).
- `recordRetrieval` now makes those logs consumable by the companion tools.

## Dev Workflow
1. Start CharacterRPG server (`npm run dev` from repo root). Ensure `OLLAMA_BASE`/`OLLAMA_MODEL=deepseek-r1:1.5b` if you want reviewer parity.
2. Install dependencies for the companion (versions may still be in preview; adjust `package.json` if npm cannot resolve the latest releases).
   ```bash
   cd apps/chatgpt-companion
   npm install
   npm run dev
   ```
3. In ChatGPT Developer Mode, register the local MCP server (Apps SDK CLI once available) and provide secrets:
   - `openai_key` → X-Provider-Key forwarded to CharacterRPG.
   - optional: `deepseek_key` if we wire additional reviewers later.
4. Test the tools:
   - `listCharacters` should mirror `/api/characters`.
   - `startSession` + `sendTurn` should produce turns and retrieval telemetry you can confirm via the helper endpoint.

## Next Tasks
- Build the Apps SDK UI components (dashboard tiles, action footer, context panels).
- Wire AgentKit Evals for regression testing of companion flows.
- Add secrets management UI (Apps SDK secret prompts) and document the publication process for the upcoming Companion directory.
