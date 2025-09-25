### Character RPG App for Android

## Android app to create and chat with RPG characters.

- Android app for creating RPG characters, chatting (text or voice), and RPG-ing your own storyline.

- App is intended to allow users to upload character profiles and set voice models (tuned to whatever tone/attitude you want for your character).

- Interaction can be text to text, text to voice, and voice to voice. Environmental narration can be done by your character and your own player via speaking, or typing. You can specify that you want the NPC character to put narrations in the chat rather than saying them for better authenticity.

- Backend model (i.e., not the voice model) is powered by GPT or Gemini, and soon (hopefully) Venice and Grok.

## Work Summary
- Provider‑agnostic voice RPG: toggle between OpenAI and Gemini, and between voice↔text input at runtime.
- BYOK‑only: users supply their own provider keys; defaults favor Gemini free‑tier usage.
- Text‑first MVP: start with text↔text conversations; add TTS/STT later.
- Orchestrated speech path for natural rhythm (later): LLM → clause chunking → TTS with humane barge‑in; Realtime stubs optional.
- Multi‑character scenes via single‑LLM structured JSON (`{speaker, text, speak}`) with per‑speaker voices.
- Persistence: characters, sessions, turns, and transcripts stored on a lightweight server (SQLite); client keeps a small cache.
- Security: API keys live only on the server; the app talks solely to your server.
 - Visuals: user-uploaded avatars for NPCs (and optional player avatar) shown in lists and chat; talking avatars explored later.

See `docs/` for full details:

## Ollama Quick Start (Local Models)
- Ensure Ollama is running locally (default `http://localhost:11434`).
- Edit `server/.env` to set:
  - `OLLAMA_BASE=http://localhost:11434`
  - `OLLAMA_MODEL=deepseek-r1:1.5b` (or your installed model)
- Start the server: `cd server && npm run dev`.
- In the app Settings:
  - Set Provider: Ollama
  - Tap “Use deepseek-r1:1.5b” or enter your model in “Custom Ollama model”
  - Tap “Test Ollama” to verify connectivity and list models
- Start a conversation; server will call Ollama and return strict JSON turns. If a model emits extra text (e.g., <think> blocks), the server strips it and extracts the JSON.
  - You can control think-block stripping via `OLLAMA_STRIP_THINK=true|false` in `server/.env`.

## Browser Playground
- Start the server: `cd server && npm run dev`
- Open http://localhost:4000/playground in your browser.
- Create/select characters, choose provider (mock or ollama), set optional model, toggle Mature/Tweaker, start a session, and chat.
- “Health” under Ollama checks that Ollama is reachable and lists models.
- Characters list includes Reset and Delete buttons:
  - Reset: restore fields from base profile; clears per-character memories/timeline files and DB rows.
  - Delete: removes the character record and associated memories/timeline files and rows. Transcripts remain intact.

## Character Documents API (per-character files)
- List: `GET /api/characters/:id/docs` → `[{ name, size, mtimeMs }]`
- Upload: `POST /api/characters/:id/docs` (multipart form `file`)
- Download: `GET /api/characters/:id/docs/:filename`
- Delete: `DELETE /api/characters/:id/docs/:filename`

Notes
- Files are stored under `profiles/<id>/docs/`.
- We index `.md` and `.txt` for search; PDFs are stored but not searched (no OCR).

## Save / Export Profile
- Save: `POST /api/characters/:id/save-profile` — snapshots base_json and writes `profiles/<id>/profile.md` (+ timeline.md if present).
- Export: `GET /api/exports/profile/:id` — returns `profile.md` (synthesizes from DB if missing).

## RAG (Scaffolding)
- Search: `POST /api/rag/search` with `{ character_id, query, k? }` → top matches from:
  - Profile bundle (profile.md, timeline.md), per-character docs (`.md`/`.txt`), and the `memories` table.
- Review: `POST /api/rag/review` with `{ candidates:[{id,text,score,occurred_at?}], n? }` → `{ selected, reason }`.
  - Currently uses a score+recency heuristic. We will later add a reviewer model call and let users choose a separate model/provider.

## Seeds: Drop-in Markdown Profiles
- Drop files into `server/seeds/characters/<Name>/profile.md` (optional front‑matter keys: `age`, `birth_year`, `voice`, `provider`).
- Optional: put additional docs under `server/seeds/characters/<Name>/docs/`.
- On server start, seeds are imported:
  - A character row is created (or updated) for `<Name>` with `system_prompt` from `profile.md` and `base_json` snapshot.
  - A profile bundle is written to `profiles/<id>/` for use in RAG and exports.
- This lets you bulk-add characters by dropping folders into the repo.


Design choices
- Keep the “Core Timeline” inside the profile bundle so resets and in-context prompting always have a concise, curated timeline.
- Use RAG for longer sources (docs + memories). We’ll add an LLM reviewer in a fresh context to pick relevant citations before the main answer.

## Terminal CLI

## Character Profiles (PDF)
- Option A — Serve via app: copy your PDF to `server/uploads/profiles/<Name>.pdf` (e.g., `Olive.pdf`). It will be accessible at `/uploads/profiles/<Name>.pdf`.
- In the Characters screen (RN skeleton) use “Set Profile URL” with `/uploads/profiles/Olive.pdf` to attach it to the character. Future UI can show an “Open Profile” action.
- Option B — Keep in repo docs: place under `docs/characters/<Name>/` for versioned reference (not served by the app).
- Start the server: `cd server && npm run dev`
- In another terminal: `cd server && npm run cli`
- Features:
  - Arrow-key character multi-select (Space toggles, Enter confirms)
  - Provider picker (mock or ollama); optional model prompt
  - Mature language toggle and Prompt Tweaker mode
  - Chat loop with `/end` (end session) and `/exit` (quit)
- `docs/REQUIREMENTS.md` (functional/non‑functional requirements)
- `docs/ARCHITECTURE.md` (system design and data flow)
- `docs/DECISIONS.md` (key architectural decisions)
- `docs/ROADMAP.md` (phased milestones)
- `docs/IMPLEMENTATION_PLAN.md` (detailed plan for review; no code yet)
- `docs/BILLING_AND_USAGE.md` (BYOK, model toggles, usage metering, cost estimates)
- `docs/FUTURE_WORK.md` (cinematic avatars, backgrounds, local voice engines)
