# Implementation Plan

Note: This is the detailed plan for review. No code will be implemented until you approve.

## 0) Environment Prep (You + Me)
- Install `Node 18+` and `Android Studio + SDK` (emulator or device with USB debugging).
- Create `.env` files for `server` and `app` (keys only on server). Example keys: `OPENAI_API_KEY`, `GEMINI_MODEL`, `PORT`.
- Decide ports and base URL (default `http://localhost:4000`).
 - BYOK-only: plan for no server-stored keys. Server will accept transient per-request keys when needed.

## 1) Repository Layout
- `server/` (TypeScript, Express, better-sqlite3)
- `app/` (React Native, Android target)
- `docs/` (this folder)

## 2) Server (MVP Turn-Based Path)
- Bootstrap Express app with JSON body parser and health route.
- Add SQLite DB module and create tables (characters, sessions, turns, capsules).
- Characters API: list/create minimal fields.
- Sessions API: create and end sessions.
- LLM Router: adapter interface; implement OpenAI (`gpt-5-mini` default, `gpt-5-nano` fallback) first, then add Gemini; enforce JSON response; retries/fallbacks.
- Clause Chunker + Capsules: split by punctuation, store tail, TTL/drop rules, courtesy prompt cooldowns.
- Convo API: `POST /api/convo/turn` persists player turn, calls LLM, persists NPC turns, returns structured payload (text only in P1).
- Logging: minimal request/response logs (no secrets); error handling.
- BYOK transit: accept `X-Provider` (`gemini|openai`) and `X-Provider-Key` headers; use only for that request; never persist.

### 2b) Retrieval & Search Agent (Responses API)
- Wrap the OpenAI Responses API hosted tools (`web-search`, `file-search`, `browser`, `code_interpreter`) behind a `services/searchAgent.ts` module that accepts structured retrieval plans.
- Implement a three-tier context pipeline:
  1. Prompt cache for recent turns (Responses API prompt caching).
  2. Episodic memories via file-search over transcripts/memory files.
  3. Long-term lore/timelines indexed via MCP connectors or markdown snapshots.
- Instrument tool calls with latency/cost telemetry so the usage tracker can surface retrieval spend separate from generation.
- Integrate the search agent into the RAG path for `/api/convo/turn`, using a LangGraph-style controller to plan → execute → aggregate snippets before reviewer/LLM calls.

### 2a) Assets: Avatars
- Endpoint: `POST /api/assets/upload` (multipart/form-data). Validate content-type (PNG/JPEG/WebP), < 5 MB, max 2048x2048; strip EXIF.
- Storage: write to `uploads/avatars/<hash>.<ext>`; respond with `{ uri }`.
- Characters: extend table with `avatar_uri`; add `PATCH /api/characters/:id` to set/unset avatar.
- Security: throttle uploads per minute; reject duplicate hashes to save space.

Acceptance
- Start server; `POST /api/convo/turn` with sample characters returns `{turns:[...]}` with optional audio paths.
- DB files created and populated; transcripts listable.
 - Files: `transcripts/<sessionId>.md` created and appended; per-NPC `memories/*` begins empty.

## 3) Client (React Native, Android)
- App config: `.env` for `API_BASE`, default provider; build scripts.
- Global store: provider toggle; input mode toggle; selected characters; session id; turns; voiceWanted flag.
- Characters screen: list/create/select profiles; simple local cache mirrored from server.
- Conversation screen: render turns; per-speaker headings; play audio when present; send text turns; toggles.
- Conversation UI (text-first): bubble layout, per-speaker labels, left-aligned NPC bubbles with circular avatars and `Name:` prefix; right-aligned player bubbles; background policy hooks (disabled by default).

### 3d) Slash Commands & Files
- Implement `/LLM`, `/<NPCName>`, and `/scene` parsing on client; send structured flags with the message.
- Server applies directives and updates transcript files and setting doc.

### 3a) BYOK & Model Selection
- Secure key storage (RN Keychain) for `OPENAI_API_KEY`, `OPENAI_SECONDARY_KEY` (optional), and `GEMINI_API_KEY`.
- Provider/model selector UI with defaults: `openai` + `gpt-5-mini`; quick toggle to `gpt-5-nano`; Gemini presets remain available but start disabled until adapters are wired.
- Banner/chips showing active provider/model and free/paid state.

### 3b) Usage Tracker & Policy
- Local counters per model: requests, input/output tokens; reset heuristics (daily/monthly windows configurable).
- Intercept calls: check policy; on limit-hit, either auto-switch, prompt, or continue (paid) after explicit consent.
- Rate-limit feedback: parse 429/quota responses; start cooldown timers; show next retry estimate.
- Cost estimation: price table in app config; multiply by token counts; show running total per model and session.
- Surface retrieval/tooling spend from the Responses API (search/file-search/browser) alongside generation so players can see total cost per scene.

### 3c) Avatars
- Add image picker (camera/gallery) with preview and crop/resize.
- Upload to server and patch character with returned `avatar_uri`; cache locally.
- Conversation UI: render avatar next to each NPC message (bubble-style) in the transcript, including entries created from voice replies; fallback placeholder.

Acceptance
- On emulator/device: send text turn; see structured NPC turns; hear per-turn audio when enabled.

## 4) TTS Output (Non-Live)
- Add TTS Router and playback utility; keep policy toggles and counters.
- Maintain transcript-first UX (text always present); audio is optional add-on.

## 5) Voice Input (Non-Live)
- Client mic capture (RN module) and simple VAD/backchannel flags.
- STT endpoints on server (OpenAI example); post audio; receive text; feed into `/api/convo/turn`.
- UX affordance to flip input mode seamlessly.

Acceptance
- Speak to the app; NPC responds; micro/backchannel does not hard-cut speech.

## 6) Realtime/Live (Optional Feature Gate)
- WebRTC signaling endpoint on server for OpenAI Realtime; client SDP offer/answer flow; attach mic and remote audio.
- Gemini Live WS path; send PCM frames; receive audio chunks.
- Keep humane overlap policy where feasible (ducking & courtesy prompts on client-side timer cues).

Acceptance
- Toggle enables low-latency mode; fallback to orchestrated path works reliably.

## 7) Polishing & Hardening
- Robust JSON validation with `zod`; safe fallbacks to narrator text on failure.
- Export transcripts; basic session browser.
- Telemetry toggles and structured logs.
 - Sensitive header scrubbing; redaction tests; unit tests for Usage Tracker state machine.

## 8) Testing & Validation
- Unit: chunker, capsule lifecycle, JSON schema validators, adapters with mocked providers.
- Manual: scripted conversation scenarios covering micro-interrupts, backchannels, narration, multi-character.
- Performance: measure perceived latency per step; tune TTS settings and audio format.

## 9) Deliverables
- Running Android app (emulator or device) with provider toggle; voice/text input toggle.
- Server with LLM/TTS adapters; SQLite persistence; transcripts.
- Docs updated: quick start, decisions, and troubleshooting.
- BYOK guide + usage tracking behavior documented.
- Avatar support documented and implemented (MVP static images; future talking-avatar notes).

## Dependencies & Install Notes
- Server: `better-sqlite3`, `express`, `node-fetch`, `dotenv`, `zod`.
- Client: `react-native`, audio playback/capture modules (to be selected during implementation).
- Keys: keep in server `.env`; client references server only.
 - For BYOK-only: server `.env` contains no provider keys in production; developer may set for local testing but app ignores when a user key is present.
### 3e) Prompt Tweaker
- Add UI control in Settings for modes: off, suggest, auto.
- Server: run `tweakUserText` before LLM; in suggest mode prepend a System hint; in auto mode rewrite; block prohibited minors content.
- Later: replace heuristic with a small safety model or provider moderation endpoint.

### 3f) Ages and narrative time
- Characters: add optional Birth Year field in UI; send `birth_year` to server.
- Server: include birth year and/or age in system context; compute age from `birth_year` when `scene_state.time` is set.
- Slash `/scene` time control: support `time: YYYY-MM-DD` or `year: YYYY` to set narrative time.
