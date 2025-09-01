# Requirements

Source: Extracted from `docs/Conversations_with_GPT/rpg-voice-app-architecture-and-mvp.md` and `docs/Conversations_with_GPT/rpg-voice-session-transcript.md` (2025-08-31).

## Functional
- Input modes: toggle between `voice` and `text` at runtime; user can switch anytime.
- Output modes: NPC replies as `voice` and/or `text`; narration may be text-only.
- Provider toggle: OpenAI or Gemini with a simple switch; provider-agnostic abstractions. BYOK‑only: users must supply their own API keys.
- Multi-character scenes: single LLM produces structured JSON turns `{speaker, text, speak}`; per-speaker TTS.
- Character profiles: name, voice, provider, system prompt, memory; persisted on server; selectable per scene.
- Avatars: user can set an image for each NPC character and an optional player avatar; avatars appear next to NPC messages in the transcript/chat (bubble-style). Voice sessions are recorded in the same transcript with speaker labels. Chat layout: NPC messages left‑aligned with a small circular avatar and a name prefix (e.g., "Olive: …"); player messages right‑aligned. Background image behavior is off by default with an option for `activeSpeaker` later.
- Transcripts: persist all turns (player/NPC) per session; exportable.
- Transcript files: in addition to DB, write an append-only verbatim transcript per session under `transcripts/<sessionId>.md`.
- Barge-in policy: humane micro-interrupt handling with courtesy pause, question to yield floor, and Continuation Capsules to resume or drop tail text.
- STT (optional): endpoints to transcribe voice input when not using provider “Live/Realtime”.
- Realtime/Live (optional): stubs for WebRTC (OpenAI Realtime) and Gemini Live behind a feature toggle.
- Secrets: API keys stored on server; client only talks to own server.

### Memory, Setting, Commands, and Control (new)
- Per-NPC memories: maintain a concise, structured memory file for each NPC (e.g., `memories/<characterId>.md|json`) updated in real time; allow entries that apply to multiple NPCs without duplication.
- Running setting doc: maintain a session-scoped scene/setting document tracking location(s), participants, time-of-day, and state changes (entries/exits, movements, activities). Persist across sessions for continuity.
- Time continuity: represent both real time and in-world time; heuristics to infer returns/absences; user overrides allowed.
- Snapshot/rewind: create lightweight checkpoints each turn; allow restoring a prior checkpoint and regenerating from there.
- Slash commands: `/LLM <directive>` for meta instructions; `/<NPCName> <message>` to address a specific NPC; optional `/scene <note>` to adjust setting.
 - Timelines: maintain an overall story timeline and per‑character timelines capturing brief, high‑signal events (what, who, where, when). Per‑character timelines reflect what that character knows; update when they learn about events later.

### Provider/Model selection & usage controls (new)
- Default provider: Gemini. Default model: `gemini-2.5-flash`. Alternative: `gemini-2.5-flash-lite` (quick switch).
- Local OSS option: `provider=ollama` with presets for Qwen2.5‑7B‑Instruct, Llama‑3.1‑8B‑Instruct, Roleplay‑Hermes‑3 (Llama‑3.1‑8B), and a custom model input.
- UI: clear indicator of active provider/model; one-tap toggle between available models.
- Free vs paid state per model: show badge/state (Free OK / Rate-limited / Over free cap / Paid).
- Usage metering: running counts of tokens/requests for each model, daily/monthly windows; estimate remaining free usage where applicable.
- Policy when free cap/rate limit is hit: configurable in Settings:
  - Switch to other free model automatically, or
  - Prompt the user to choose, or
  - Continue on the same model as paid (explicit consent required).
- Rate-limit handling: surface cooldown timers and next reset estimate; allow user to wait or switch.
- OpenAI: always “paid”; still selectable, with running cost estimate.

### Content mode
- Mature mode toggle: when enabled, allow in‑character mature language; still prohibit illegal sexual content and minors. Default off.

### Prompt Tweaker
- Modes: `off` | `suggest` | `auto`.
- Behavior: detect obviously illegal requests; either suggest a safer reframe (`suggest`) or automatically rewrite to a lawful alternative (`auto`). Always block any sexual content involving minors.

## Non-Functional
- Low-latency but predictable conversational rhythm (orchestrated path favored initially).
- Reliability over novelty for MVP; realtime kept optional to avoid hard-cut overlaps.
- Privacy/Security: minimize key exposure; client uses server endpoints; transcripts kept local server-side SQLite.
- Portability: Android first via React Native; potential future native/other platforms.
- Offline/spotty network tolerance: small client cache; durable server storage.
 - BYOK key hygiene: never persist keys on server; store on-device in secure storage; redact from logs; TLS-only.

## Constraints & Assumptions
- Tooling: Node 18+, Android Studio + SDK; USB debugging or emulator.
- Server: Node + Express + SQLite; TypeScript; file storage for synthesized audio okay for MVP.
- Models: OpenAI (text, TTS, optional STT/Realtime) and Gemini (text, TTS/Live) supported; additional vendors are out-of-scope for MVP.
 - Provider free tiers: actual quotas and reset windows vary by provider and may change; the app estimates locally and reconciles with API errors (429/quota exceeded).

## Data Model (SQLite)
- `characters(id, name, voice, provider, system_prompt, memory_json, avatar_uri, created_at, updated_at)`
- `sessions(id, title, provider, participants_json, started_at, ended_at)`
- `turns(id, session_id, role, speaker, text, audio_path, created_at, meta_json)`
- `capsules(id, session_id, speaker, tail_text, resume_hint, hook, drop_if, ttl_ms, created_at)`
 - `memories(id, character_id, session_id, text, scope_json, sources_json, created_at)`
 - `scene_state(id, session_id, current_json, updated_at)`
 - `snapshots(id, session_id, turn_id, payload_json, created_at)`
 - (Optional later) `players(id, display_name, avatar_uri, created_at, updated_at)`
 - `timelines(id, scope, owner_id, created_at, updated_at)`
 - `timeline_events(id, timeline_id, occurred_at, title, summary, location, participants_json, sources_json, created_at)`

## Edge Cases & Handling
- Model returns invalid/non-JSON: enforce JSON response format; retry or fall back to narrator text.
- Micro-interrupt storms: cooldowns (e.g., courtesy prompt ≤1 per 20s per speaker).
- STT partials/backchannels: treat “uh‑huh/yeah/sorry/continue” as backchannel, not full interrupt.
- Audio overlap: duck/unduck instead of hard cancel; only cancel on sustained intent.
- Session continuity: store Continuation Capsules with TTL and drop rules (topic change, time elapsed).
- Image handling: reject unsupported types; downscale large uploads; cache-bust on updates; handle offline avatar display.
 - Multi-speaker voice scenes: even for audio-first replies, the server tags each NPC turn with `speaker`, so the transcript shows the correct name and avatar.
 - Emotion tagging: LLM generates an `emotion` hint for NPC turns (e.g., neutral, amused, worried); stored in `turns.meta_json` for future avatar animation; ignored if absent.
 - Memory extraction: idempotent updates; deduplicate repeated facts; include provenance (turn ids) in `sources_json`.
 - Rewind safety: non-destructive rollback via stored snapshots; enable branch/regenerate workflows.
 - Timeline brevity: enforce concise event summaries; roll‑up older events into higher‑level summaries to keep timelines scannable.
 - Knowledge alignment: when an NPC learns about an event later, append to their personal timeline with source attribution.
