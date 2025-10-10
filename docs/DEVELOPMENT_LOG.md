# Development Log

This file tracks progress, choices, and reminders so work can resume with fresh context.

## 2025-08-31
- Added docs suite (requirements, architecture, decisions, roadmap, implementation plan, billing/usage, interaction model, future work).
- Integrated BYOK-only, Gemini defaults, usage tracking, avatars, text-first scope, transcript/memory/setting/snapshot/timeline mechanics, and slash commands.
- Scaffolded server (TypeScript):
  - Express app with health, static uploads, and asset upload.
  - DB schema (SQLite via better-sqlite3) for characters, sessions, turns (+meta_json), capsules, memories, scene_state, snapshots, timelines, timeline_events.
  - Routes: characters (list/create/patch), sessions (create/end), convo (turn) with mock LLM provider.
  - Services: llmRouter (mock only now), memory extractor (placeholder), setting manager (merge placeholder), snapshot manager, file I/O for transcripts/memories/timelines, header scrubbing middleware.
  - Storage dirs ensured at boot: uploads/, transcripts/, memories/, timelines/.
- Client: created `app/README.md` with planned structure; RN code not generated yet due to no network/tooling.

Blocked / To do next
- npm install and run server (blocked by network; ready once allowed).
- Implement real provider adapters (OpenAI/Gemini) respecting transient BYOK headers.
- Implement avatars in client UI; add BYOK settings screen and usage tracker store.
- Usage tracker counters and cost estimates in client; server echo of token counts later.

Later on 2025-08-31
- Added slash command parsing server-side; records `/LLM`, `/<NPCName>`, and `/scene` in `turns.meta_json`.
- Hooked up Timeline Manager; NPC replies create simple per-character events; `/scene` notes add global events.
- Client sources scaffolded: Zustand store and Conversation screen with left/right bubbles and avatar placeholder.
- Server export endpoints: `/api/exports/transcripts/:sessionId`, `/api/exports/memories/:characterId`, `/api/exports/timelines/:ownerId` (use `global` for global timeline).
 - Server export endpoint added: `/api/exports/setting/:sessionId` → latest scene state.
- Usage logger: rough token estimation written to `usage/<sessionId>.jsonl` for each turn (player/NPC).
- RN app shell and screens: `App.tsx`, `src/screens/Characters.tsx`, `src/screens/Settings.tsx` created (offline-friendly sources).
- Client: Conversation now starts a session automatically if missing and tracks rough token usage locally per model.
- Client: Characters screen supports selecting participants for the scene.
- Server: added a minimal test file (`src/tests/basic.ts`) and a `npm test` script that compiles and runs it without extra deps.
- Server: added permissive CORS middleware for cross-origin testing (includes `X-Provider` headers).
- Server: added local OSS adapter `provider=ollama` (env: `OLLAMA_BASE`, `OLLAMA_MODEL`).
- Client: settings now include provider=Ollama with presets (Qwen2.5 7B, Llama 3.1 8B, Hermes RP 8B) and a custom model field.
- Client: mature language toggle plumbed through to server; prompt adjusted accordingly.
- Prompt Tweaker: settings with off/suggest/auto; server pre-processes user text (heuristic), blocks minors sexual content, suggests or rewrites otherwise.
 - Characters UI: added optional Age field (sent to server; included in LLM context and used by tweaker).

Dependency hygiene
- Replaced `ts-node-dev` with `tsx` for the dev runner to avoid deprecated transitive deps (`glob@7`, `rimraf@2`, `inflight`).
- Upgraded `multer` from `1.x` to `^2.0.0` (our usage remains compatible: `upload.single('file')`).
- Removed `node-fetch` (we will use Node 18’s global `fetch` when implementing real providers) to avoid `node-domexception` warnings.
- After these changes, `npm i` should show fewer deprecation warnings.

Notes for resumption
- Server uses mock LLM now; responses are deterministic and safe for UI bring-up.
- All file outputs are append-only for portability; DB remains system of record.
- When enabling installs, run from `server/`:
  - `cp .env.example .env` (adjust paths if needed)
  - `npm i && npm run dev`


## 2025-09-09
- Seeds + Docs import:
  - Added seeds importer: `server/seeds/characters/<Name>/profile.md` (+docs) auto‑imports on boot.
  - Added docs importer: scans `docs/Character_*.md` (e.g., `Character_Olive.md`) to create/update characters, snapshot base_json, and write profile bundles.
  - API: `POST /api/characters/import-from-docs` triggers a re-import.
- Documents API:
  - `GET/POST/GET/DELETE /api/characters/:id/docs[/:filename]` stored under `profiles/<id>/docs/`.
- Save/Import base profile:
  - `POST /api/characters/:id/save-profile` snapshots current fields and writes `profile.md` (plus `timeline.md` if present).
  - `POST /api/characters/:id/import-base` (multipart md) replaces system prompt and updates base_json.
- RAG scaffolding wired into convo:
  - `/api/convo/turn` now accepts `useRag`, `reviewer_provider`, `reviewer_model`, and `style_short`.
  - Builds compact context from profile/timeline/docs/memories; adds a brief‑response guideline when `style_short` is true.
  - Reviewer route now supports OpenAI/Ollama; falls back to heuristic when unspecified.
- OpenAI adapter:
  - Added provider with default model `gpt-5-nano`; Settings exposes `gpt-5`, `gpt-5-mini`, `gpt-5-nano`.
- UI:
  - Settings/Conversation screens: RAG toggle, reviewer provider/model inputs, “Short” toggle.
- CLI:
  - Provider menu includes OpenAI; added `--rag` and `--short` flags (defaults on).

Artifacts added
- `docs/USAGE_AND_TESTING_CHEATSHEET.md` — concise terminal commands for imports, curl tests, CLI usage, docs CRUD, and RAG/reviewer endpoints.

Notes / Next steps:
- Reviewer caching: add per-session cache with TTL and topic change heuristics.
 - Implemented simple per-session cache with 2‑minute TTL.
- Reviewer prompt: initial JSON reviewer with short‑reply guidance; next add conflict detection + in‑character clarify.
- Gemini adapter next; then convert reviewer to use chosen model end‑to‑end.

## 2025-09-10
- Loader and session stability
  - Fixed here-string misuse that swallowed API responses; switched to piping/explicit here-string into Python for JSON printing.
  - Added HTTP status/body length diagnostics; removed once stable via `DEBUG_PRINT=0`.
  - Made session creation and turn flow resilient to non-JSON model output; explicit errors replace silent `…` fallbacks.
- Provider toggles and key handling
  - Clean split between server `.env` (secrets + infra) and loader `scripts/olive.config` (per‑run, non‑secret defaults).
  - Loader no longer imports `.env`; BYOK header only sent when `PROVIDER_KEY` is explicitly set in the config.
  - Precedence: request `use_responses`/model/provider override env defaults; server still supports `OPENAI_USE_RESPONSES` as a fallback.
- OpenAI adapters
  - Text adapter now supports both Chat Completions and Responses API (toggle: `use_responses` or `OPENAI_USE_RESPONSES=true`).
  - Switched defaults to `gpt-4o-mini` for broad availability; clear error messages on HTTP/model errors and non‑JSON content.
  - JSON helper (reviewer) hardened with the same error handling and model defaults.
- RAG/Reviewer
  - Added `USE_RAG` toggle in loader; `REVIEWER_PROVIDER` can be `stub|openai`.
  - Reviewer cache (2‑minute TTL) prevents repeat LLM calls per session.
- Character meta preferences
  - Loader now fetches `/api/characters/:id/meta` and uses `provider_pref.provider/model` when `PROVIDER` or `MODEL` is unset or `auto`.
- Responses API support
  - New pathway via `/v1/responses` when enabled; parses `output_text` and enforces strict JSON contract.
- Dev docs
  - Updated `docs/USAGE_AND_TESTING_CHEATSHEET.md` to reflect 4o‑mini defaults, BYOK header usage, and config split.

Open issues / follow‑ups
- Playground key input: add optional `X-Provider-Key` field to avoid relying on `.env` during browser tests.
- Reviewer prompt improvements: contradiction detection, ask-to-clarify signal plumbing.
- Gemini adapter (text) parity with OpenAI + Responses pathway.
- Unit tests: adapters (OpenAI/Responses), loader parser, RAG scoring, reviewer selection.

## 2025-09-23
- Replaced the compiled `dist/` workflow with direct TypeScript execution (`node --import tsx ./src/index.ts`); build now runs `tsc --noEmit` and the runtime stays in sync with sources.
- Added `server/src/types.ts` and refactored all routes/services (characters, sessions, convo, stories, providers, RAG, prompts, exports, seeds, timeline, etc.) to use typed SQLite result structs—no more implicit `any` under strict mode.
- Hardened the CLI (`crpg` + `server/src/cli.ts`) with new diagnostics (`--diagnose`, `--no-server`), larger HTTP timeouts, and typed fetch helpers; importer diagnostics now reuse shared scan logic in `services/importDebug.ts`.
- Bumped the HTTP curl timeouts in `crpg` (10s max, 2s connect) to fix the “No characters found” race caused by short `curl` deadlines; `CRPG_SERVER_CMD` env var selects `npm run start` vs `dev`.
- Added type-safe adapters for Ollama/OpenAI reviewers, ensuring diagnostics and RAG reviewer flows use shared Candidate types; `npm run build` passes with full `strict` settings.

## 2025-09-28
- Cleaned up lingering merge markers in the React Native screens so the Characters, Conversation, and Settings components now reflect the merged feature set (profile URL attach, RAG reviewer controls, Ollama health check) without duplicate blocks.
- Added an `app/package.json` with the minimal dependencies and scripts so `npm install --prefix app` works out of the box; left out RN type stubs that aren’t published for 0.75 yet.
- Extended the `crpg` launcher with 60s curl timeouts and a retry helper to wait for `/api/characters`, eliminating the “no characters found” race during startup diagnostics.
- Removed `server/.env` and every `node_modules` directory from Git, refreshed `.gitignore`, and restored tracked timelines/transcripts to their clean state.
- Filtered local history to purge earlier `.env` commits; follow-up push used GitHub Desktop’s force-push.

## 2025-10-10
- Added `docs/STATE_OF_THE_ART.md` capturing OpenAI Dev Day (GPT‑5 family, AgentKit, Apps SDK), new Google Gemini capabilities, and open-source releases relevant to CharacterRPG.
- Updated defaults across docs to use OpenAI `gpt-5-mini` (quick toggle `gpt-5-nano`) with Gemini noted as the secondary preset once adapters are in place.
- Refreshed architecture/config notes to mention the new default provider/model and resolved lingering merge markers in scripts and cheat sheets.
- Implemented the first-cut Responses API search agent (`server/src/services/searchAgent.ts`) with telemetry logging + reviewer cache integration, swapped `convo` to use it, and started recording retrieval usage alongside generation usage.
- Changed OpenAI adapters, CLI defaults, and RN store/UI defaults to `gpt-5-mini`/`gpt-5-nano`, and surfaced retrieval telemetry in the Conversation screen.
- Drafted `docs/CHATGPT_COMPANION.md` and scaffolded `apps/chatgpt-companion/` (MCP server placeholder + package metadata) as the foundation for the ChatGPT Companion Apps SDK project.
- Apps SDK packages are still preview-only; `npm install` inside `apps/chatgpt-companion/` will fail until OpenAI publishes the beta bits or we point npm at their tarballs (note recorded so we remember next session).

Next session
============
- Prototype the ChatGPT Companion (Apps SDK + MCP) that surfaces CharacterRPG quick actions inside ChatGPT.
- Evaluate AgentKit guardrails/Evals for the reviewer + barge-in flows and draft a connector plan for sanctioned external sources.
- Build a LangGraph proof-of-concept that chains the new search agent, memory writer, and reviewer; exercise it against a small RAG-Gym-style scenario.
- Extend the client usage tracker to budget retrieval/tool calls alongside token usage (UI controls for auto-switching models based on spend).
