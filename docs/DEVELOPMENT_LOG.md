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
- Add slash command parsing server-side; structure `/LLM`, `/<NPCName>`, `/scene`.
- Append timeline events (service stub to call from convo route after memory extraction).
- Implement avatars in client UI; add BYOK settings screen and usage tracker store.

Notes for resumption
- Server uses mock LLM now; responses are deterministic and safe for UI bring-up.
- All file outputs are append-only for portability; DB remains system of record.
- When enabling installs, run from `server/`:
  - `cp .env.example .env` (adjust paths if needed)
  - `npm i && npm run dev`

