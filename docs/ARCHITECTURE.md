# Architecture

Source: Consolidated from `docs/Conversations_with_GPT/rpg-voice-app-architecture-and-mvp.md` and the transcript.

## Overview
- Client: React Native (Android). Toggles for input (voice/text), provider (OpenAI/Gemini), and voice output. Local VAD flags for micro/backchannel.
- Server: Node + Express + SQLite. Routers for LLM (text/JSON), TTS, optional STT; barge-in policy and Continuation Capsules; persistence.
- Optional realtime: WebRTC bootstrapping for OpenAI Realtime and Gemini Live (feature-gated).

## Components
- Client UI: screens for Characters and Conversation; provider + input toggles; headphone/voice output preference.
- Barge-In Controller (client): simple energy/duration/VAD to flag `micro` and `backchannel` events.
- Scene Orchestrator (client): submits player turns; renders structured NPC turns; dispatches TTS per speaker.
- LLM Router (server): system prompt enforces JSON `{turns:[{speaker,text,speak,emotion?}]}`; provider adapter for OpenAI/Gemini. The optional `emotion` hint is stored for future avatar animation.
- Clause Chunker + Capsules (server): splits NPC text into clauses; manages pause/resume; stashes tails with TTL and drop rules.
- TTS Router (server): per-provider synthesis; returns audio path/URL.
- STT (optional): upload/stream audio to transcribe into text turns without Live/Realtime.
- Persistence: characters/sessions/turns/capsules in SQLite; simple backup/export.
- Files: append-only `transcripts/<sessionId>.md` and per-NPC `memories/<characterId>.(md|json)` for portability.
- Timelines: global and per‑character timelines stored in DB and exported to `timelines/global.md` and `timelines/<characterId>.md`.

### Assets (Avatars)
- Client: image picker (camera/gallery), optional crop/resize; local cache and placeholder fallback.
- Server: `/api/assets/upload` for images (PNG/JPEG/WebP), stores to `uploads/avatars/` with hashed filenames; returns public path.
- DB: `characters.avatar_uri` stores the returned path; player avatar stored locally or in optional `players` table.
- Security: size/type validation, max dimensions, strip EXIF; rate limiting to avoid abuse.

### New: BYOK & Usage Tracking
- Key Storage (client): Android Keystore via RN Keychain; keys never touch persistent server storage.
- Provider Clients (client-first):
  - Gemini/OpenAI calls go directly from device when possible (to keep keys device-only).
  - For server-mediated features (e.g., server-side TTS file generation), client includes a transient `X-Provider-Key` header; server forwards to provider and never persists the key.
- Usage Tracker (client primary, server assist):
  - Track per-model metrics: requests, input/output tokens, last success/error, moving windows.
  - Estimate free-tier remaining for Gemini models and detect limits via 429/quota errors.
  - Surface state machine to UI: Free → Near Limit → Rate-limited → Over Cap → Paid (allowed only after consent).
- Policy Engine (client Settings):
  - Preferences for default model, behavior on limit hit (auto-switch/prompt/paid), and cost ceilings.
  - Emits decisions used by the Scene Orchestrator before each call.
- Cost Estimator: simple lookup table of per-model pricing (maintained in app config) × token counts → running total; annotate outputs with “estimated cost”.

### Extensibility Hooks (for future avatars/backgrounds)
- `AvatarRenderer` interface: `render(mode, timings?, emotion?)` where mode ∈ `static|timedViseme|modelDriven`.
- `SpeechTiming` struct used by renderers when available.
- `BackgroundPolicy` and `BackgroundRenderer` for optional background image behavior.
- `VoiceEngine` abstraction: `remoteGemini | remoteOpenAI | localEngine`.

### Conversation Layout (UI)
- NPC: left‑aligned bubbles with circular avatar and `Name:` prefix (e.g., `Olive: ...`).
- Player: right‑aligned bubbles.
- Background: off by default; optional `activeSpeaker` mode may switch/tile background images later.

## Data Flow (Turn-Based Path)
1. Client sends player turn with session/characters/provider.
2. Usage Tracker checks policy and limits; may switch model or prompt the user.
3. Server persists player turn, calls LLM with JSON-only guard. If using server mediation, provider key is sent transiently.
4. Server post-processes NPC turns: clause chunking; optional TTS per speaker; saves to DB.
5. Server returns `{turns:[{speaker,text,speak,audio?,clauses}]}`; client plays audio and renders text; Usage Tracker updates meters and costs.
6. If `micro/backchannel` flags are signaled during playback, apply pause/capsule policy on next turn.
7. Avatar flow: when user selects an avatar, client uploads to server and updates the character/player profile with `avatar_uri`; conversation view renders avatars next to NPC messages in the transcript.
8. Emotion hint: if present on a turn, save to `turns.meta_json` and expose to the UI (currently unused).
9. Timeline update: Memory/Setting services emit concise timeline events to global and relevant per‑character timelines; per‑character views reflect knowledge when they learn events later.

## Barge-In Policy (Essentials)
- Micro interrupt during NPC speech → finish current clause → courtesy pause (~750ms) → ask to jump in.
- If the player speaks within ~2s, yield floor; save tail in a Continuation Capsule. Otherwise, resume and clear.
- Cooldowns prevent repeated courtesy prompts; capsules drop on topic change or after TTL.

## Multi-Character Orchestration
- Single LLM produces JSON turns with `speaker` chosen from the scene characters; `speak:false` for stage directions.
- Client routes TTS by speaker voice; prints `speak:false` lines.

## Storage & Secrets
- Keys live only on server; client uses server endpoints.
 - SQLite DB with tables listed in Requirements; audio files stored on disk (MVP) or cloud later.
 - Memory & Setting services:
   - Memory Extractor updates per-NPC memory files and `memories` table with deduplication and provenance.
   - Setting Manager maintains `scene_state.current_json` and exports a readable setting doc.
   - Snapshot Manager records a checkpoint pointer each turn for rewind/regenerate.
   - Timeline Manager maintains global and per‑character timelines; summarizes/rolls‑up older events; exports markdown views.

## Optional Realtime / Live

## Future: Talking Avatars (Exploration)
- Static image + audio only (MVP): simplest; no lip-sync; transcript still shows avatar and speaker.
- Lightweight lip-sync: approximate visemes from TTS timing or phoneme heuristics; basic mouth sprites.
- Model-driven: integrate a lip-sync model (e.g., Wav2Lip‑style) on-device or server; heavier CPU/GPU cost.
- Provider signals: if a TTS provider exposes viseme/phoneme timing, drive mouth animation directly.
- Decision: defer heavy talking-portrait work; ship notes and hooks to plug in later.
- OpenAI Realtime via WebRTC: server endpoint performs signaling; client attaches mic and plays remote audio.
- Gemini Live via WebSocket: client sends PCM frames, receives audio chunks; courtesy policy stays client-side.
