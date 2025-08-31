# Roadmap

Phased plan based on extracted goals. Dates TBD after initial review.

## P0 — Foundations
- Repo structure agreed; environment files drafted.
- Define data model and provider interfaces.
- Add sample character profiles for testing.

## P0.5 — BYOK + Usage Tracking
- Add secure key storage on device; key validation flow.
- Add provider/model selectors; default Gemini (2.5 Flash) with Flash‑Lite toggle.
- Implement local Usage Tracker with per-model counters and reset heuristics.
- Add Settings for limit-hit policy (auto-switch/prompt/paid) and cost ceilings.
- Acceptance: Keys required before calls; UI shows model + free/paid state; counters increment realistically; limit-hit prompts work.

## P1 — Text-only MVP (Turn-based)
- Server: Express skeleton; LLM Router (Gemini/OpenAI) with JSON-only guard; transcripts; characters CRUD; no audio.
- Client: Characters and Conversation screens; provider + input toggles; render text turns only.
- Acceptance: Two-way conversation (text↔text) works; multi-character JSON routing; transcripts persist.

### P1.1 — Avatars
- Client: image picker, preview, resize; avatar chips in Characters list and Conversation.
- Server: `/api/assets/upload` (image), validation, storage under `uploads/avatars`.
- DB: add `characters.avatar_uri`; migration script.
- Acceptance: User can set/change NPC avatar; displays offline from cache.

### P1.2 — Transcript Files + Slash Commands
- Write append-only session transcript files; implement `/LLM`, `/<NPCName>`, and `/scene` commands.
- Acceptance: Files update live; commands parsed and applied safely.

### P1.3 — Per-NPC Memories
- Implement Memory Extractor; persist to per-NPC files and `memories` table with provenance and deduplication.
- Acceptance: New durable facts appear in memory files; cross-NPC references work.

### P1.4 — Running Setting Doc
- Implement Setting Manager; keep session-scoped setting document and `scene_state.current_json`; handle time continuity heuristics.
- Acceptance: Setting reflects locations/participants/time after each turn; can be exported.

### P1.5 — Snapshot/Rewind
- Create turn-level snapshots; add restore/regenerate flow.
- Acceptance: Can rewind to earlier turn and branch safely.

### P1.6 — TTS Output (non-Live)
- Add TTS Router on server; synthesize full-turn audio when enabled; attach audio URLs in responses.
- Conversation UI: play audio while still showing text; retain transcript.
- Acceptance: NPC speech audio works with policy switches; counters/costs tracked.

### P1.7 — Timelines
- Add Timeline Manager; write concise events to global and per-character timelines; export markdown views.
- Acceptance: Events appear with timestamps, participants, and links to turns; per-character timelines reflect knowledge when they learn events later.

## P2 — Voice Input (non-Live)
- STT endpoints and client mic capture.
- Simple VAD/backchannel detector on client.
- Acceptance: Player can speak; recognized text flows into turn pipeline.

## P3 — Polishing & Reliability
- Error handling for malformed JSON; retries; guardrails; cooldowns.
- Export/backup for transcripts; small offline cache on client.
- Basic telemetry/logging.
- Cost estimate display and history; manual reset override for free-tier counters; provider status panel.
 - Avatar caching, placeholder handling, and EXIF stripping; optional cloud storage adapter (deferred).

## P4 — Realtime/Live (Optional)
- OpenAI Realtime via WebRTC signaling; Gemini Live via WS.
- Maintain humane overlap (duck/unduck, not hard-cut) within Live flows.
- Acceptance: Low-latency voice-to-voice mode available behind a toggle.

## P5 — Nice-to-Haves
- Streaming clause playback via SSE/WS.
- Memory tuning and longer-term character notes.
- Packaging, CI checks, and potential iOS exploration.
 - Cinematic avatars: lip-sync/expressions; background policies. See `docs/FUTURE_WORK.md`.

## Risks & Mitigations
- Realtime overlap weirdness → keep orchestrated mode primary; ship feature-gated Live.
- Model JSON drift → enforce response_format/validators; safe fallbacks.
- Audio latency on Android → prefetch; keep clips short; compress appropriately.
