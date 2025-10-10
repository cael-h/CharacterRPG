# Decisions (ADR-Style)

Source: Derived from the architecture doc and transcript.

## D1: Orchestrated TTS path first; Realtime optional
- Context: Realtime voice can hard-cut and makes overlap control harder.
- Decision: Default to LLM→text→clause chunking→TTS playback; Realtime behind a toggle.
- Consequences: Better rhythm and barge-in behavior; slightly higher latency than Live APIs.

## D2: Single-LLM multi-speaker JSON
- Context: Multiple models per character add cost and inconsistency.
- Decision: One model outputs `{speaker,text,speak}` turns.
- Consequences: Cheaper, coherent scene; routing is simple.

## D3: SQLite for persistence
- Context: Simple MVP storage; easy export and backup.
- Decision: `better-sqlite3` with tables for characters/sessions/turns/capsules.
- Consequences: Good enough for single-user dev; migrate later if needed.

## D4: React Native (Android first)
- Context: Fast iteration; acceptable audio APIs; future native port possible.
- Decision: RN app targeting Android; minimal native modules.
- Consequences: Quick delivery; some platform-specific quirks possible.

## D5: Server holds provider keys
- Context: Avoid exposing secrets to the client.
- Decision: All provider calls from server; client configured with server base URL.
- Consequences: Safer; requires running a local server.

## D6: Humane barge-in with Continuation Capsules
- Context: User dislikes walkie-talkie hard cuts.
- Decision: Finish clause; courtesy pause; ask to jump in; stash tail with TTL and drop rules.
- Consequences: Natural feel; added policy/state code.

## D7: Provider abstraction
- Context: Support OpenAI and Gemini now; add more later.
- Decision: `LLM Router` and `TTS Router` interfaces with adapters.
- Consequences: Clear swap; minimal duplication.

## D8: Non-streamed per-turn audio in MVP
- Context: Simpler client/server; fewer moving parts.
- Decision: Return full audio URL per NPC turn; streaming considered later via SSE/WS.
- Consequences: Slightly slower perceived start; simpler to debug.

## D9: BYOK-only
- Context: Avoid maintaining shared billing; align costs to user accounts.
- Decision: Require user-supplied API keys; block provider calls without a key.
- Consequences: Simpler compliance; onboarding friction; must build key UX and secure storage.

## D10: Default to OpenAI GPT‑5 Mini
- Context: We want to integrate OpenAI first and take advantage of the new low-cost GPT‑5 family for testing.
- Decision: Default provider/model is `openai` / `gpt-5-mini`; quick switch to `gpt-5-nano`. Gemini 2.5 Flash remains the secondary preset once its adapters are wired.
- Consequences: Immediate coverage for OpenAI-specific features (Apps SDK, AgentKit) while keeping a cheaper fallback. Requires careful budget controls until Gemini free tiers are reintroduced.

## D11: Local usage metering with server assist
- Context: Providers don’t expose “remaining free quota” directly.
- Decision: Track request/token counts locally; infer limits from responses; maintain reset heuristics; allow manual override.
- Consequences: Estimates may drift; require clear UI and recovery on 429/quota errors.

## D12: Transient key forwarding for server-mediated features
- Context: Some features (e.g., server-side TTS files) require server to call providers.
- Decision: Send user’s provider key per request via header; do not persist; redact from logs.
- Consequences: Minimal key exposure; careful middleware required.

## D13: Avatar storage strategy
- Context: Users want images for NPCs and optionally their player; needs to be simple and offline-friendly.
- Decision: Store character avatar images on the server under `uploads/avatars/`; reference via `characters.avatar_uri`. Player avatar is local-only at first; optional server mirror later.
- Consequences: Straightforward caching and sharing across devices; later migration to cloud storage is possible without schema churn.

## D14: Talking avatars deferred
- Context: Lip-sync/animated portraits add complexity and potential model/runtime costs.
- Decision: Ship static avatars in MVP; document hooks and options for later (visemes/phonemes, client animation).
- Consequences: Faster MVP; clear path to enhance without rework.

## D15: Text-first scope
- Context: Avoid getting bogged down in audio/animation details before core features work.
- Decision: P1 delivers text↔text only; audio and voice features come in later phases.
- Consequences: Simpler implementation, clearer milestones, faster usable prototype.

## D16: Background image behavior deferred
- Context: Backgrounds that switch/tile per speaker are cosmetic and may affect readability.
- Decision: Provide hooks and a user setting, but ship disabled; treat as future polish.
- Consequences: Maintains focus while preserving a clean path to implement later.

## D17: Emotions inferred by LLM
- Context: Realism improves when NPC emotion is implicit, not user-driven.
- Decision: The LLM includes an optional `emotion` hint on NPC turns; we store it for future animated avatars.
- Consequences: No user burden; metadata available without UI complexity today.

## D18: Chat layout style
- Context: Familiar messaging layout improves readability.
- Decision: NPC bubbles left with circular avatar and `Name:` prefix; player bubbles right.
- Consequences: Clear attribution in text and voice transcripts; aligns with avatar design.

## D19: File exports alongside DB
- Context: You want portable artifacts and easy sharing without DB access.
- Decision: Maintain append-only session transcript files and per-NPC memory files in parallel with DB storage.
- Consequences: Simple backups; keep DB as system of record, files as portable views.

## D20: Running setting document
- Context: Scenes need continuity (locations, time, who’s present) across turns and sessions.
- Decision: Maintain a session-scoped setting document plus a `scene_state` record updated after each exchange.
- Consequences: Better prompts and natural continuity; small extra processing per turn.

## D21: Snapshot/rewind
- Context: Need to correct or steer when the story drifts.
- Decision: Create turn-level snapshots and allow restoring to a prior point for regeneration.
- Consequences: Safer experimentation; must manage branching/metadata.

## D22: Slash commands
- Context: Efficient control without breaking immersion.
- Decision: Add `/LLM` directives and `/<NPCName>` addressing; optional `/scene` notes.
- Consequences: Lightweight parsing; sanitize before sending to LLM.

## D23: Dual timelines (global + per-character)
- Context: Long-running stories need recall without overwhelming context windows.
- Decision: Maintain a concise global timeline and per-character timelines that reflect each character’s knowledge; update when characters learn new info.
- Consequences: Better long-term memory scaffolding; extra summarization work each turn.
## D24: Local open-source provider (Ollama)
- Context: You asked for a private, no-sharing option for initial builds.
- Decision: Support a local provider via Ollama with a simple adapter; default to `llama3.1:8b-instruct` (configurable).
- Consequences: Zero external data egress when used; JSON enforcement handled by prompt + fallback.

## D25: Mature language toggle
- Context: You want stories to flow without artificial blocks, but safely.
- Decision: Add a user setting that relaxes language constraints in the system prompt while explicitly disallowing illegal sexual content and any content involving minors.
- Consequences: Clear user control; prompt-level guardrails; can be tightened per scene if desired.
## D26: Prompt Tweaker
- Context: You want the app to help keep stories within legal boundaries without harsh stops.
- Decision: Add a Prompt Tweaker with modes: off, suggest, auto. It can propose safer phrasings or rewrite the user’s input; explicit sexual content involving minors is always blocked.
- Consequences: Better UX than hard refusals; uses lightweight heuristics now, can plug in a proper classifier later.


## D27: Character ages tracked and surfaced
- Context: Mature content depends on participant ages.
- Decision: Add `age` to character profiles; include ages in LLM context; if sexual content is requested and ages are missing, prompt for clarification (or annotate 18+ in auto mode).
- Consequences: Clearer safety posture; fewer false blocks; better continuity.


## D28: Birth year + narrative time
- Context: Flashbacks and time jumps change ages mid-story.
- Decision: Track `birth_year` and compute age at the current narrative time from the setting or timeline; include computed age in LLM system context.
- Consequences: Accurate ages during flashbacks/forwards with minimal user effort (set `/scene time:` when needed).
