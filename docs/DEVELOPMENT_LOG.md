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
 - Usage logger: rough token estimation written to `usage/<sessionId>.jsonl` for each turn (player/NPC).
 - RN app shell and screens: `App.tsx`, `src/screens/Characters.tsx`, `src/screens/Settings.tsx` created (offline-friendly sources).

Notes for resumption
- Server uses mock LLM now; responses are deterministic and safe for UI bring-up.
- All file outputs are append-only for portability; DB remains system of record.
- When enabling installs, run from `server/`:
  - `cp .env.example .env` (adjust paths if needed)
  - `npm i && npm run dev`
