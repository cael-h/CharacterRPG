# Future Work: Cinematic Avatars and Backgrounds

This document captures aspirational features to inform current architecture without expanding the near-term scope. The main app remains text-first, with voice added later.

## Talking Avatars (Realistic)
- Goals: lip-sync, facial expressions, eye blinks, and camera framing that feel natural during NPC speech.
- Inputs we can provide from the app:
  - Text (what to say), audio (TTS output or recorded), and optional timing/phoneme marks.
  - Speaker identity and emotional intent tags (e.g., calm, excited).
- Implementation paths:
  - Static portrait + audio (baseline): no lip-sync; keep as fallback.
  - Lightweight client animation: sprite/mesh mouth shapes driven by simple phoneme or envelope heuristics.
  - Timing-driven lip-sync: if TTS provides viseme/phoneme timings, map to mouth shapes; blend with expression presets.
  - Model-driven lip-sync: run a lip-sync model on-device or server to animate a still image or 3D avatar (deferred; heavy).
- Hook points to design now:
  - `AvatarRenderer` interface with modes: `static`, `timedViseme`, `modelDriven`.
  - `SpeechTiming` structure: `{ startMs, endMs, phoneme|viseme }[]` used by renderers when available.
  - `EmotionHint` tag on NPC turns to bias expression selection.

## Backgrounds During Conversation
- Idea: while an NPC speaks, set the transcript background to that NPC’s image (or an associated scene image).
- Variations:
  - Single speaker: switch the background to the active NPC’s image.
  - Multiple NPCs: tile images, or cross-fade on speaker change.
  - Accessibility: optional blur/opacity; maintain text contrast.
- Hooks:
  - `BackgroundPolicy`: `none | activeSpeaker | tiled` with user setting.
  - `BackgroundRenderer` with opacity/blur controls and per-speaker assets.

## Local Voice Models (Exploration)
- Option to run a local TTS/voice model on-device to save API costs.
- Abstraction:
  - `VoiceEngine` interface with implementations: `remoteGemini`, `remoteOpenAI`, `localEngine`.
  - The app chooses engine per policy; token/cost tracking only applies to remote engines.

## Out-of-Scope for MVP
- Full 3D avatars or video synthesis.
- Server-side GPU pipelines for real-time face animation.
- World-model integration (e.g., fully interactive environments). We note interest in future world-models and will maintain clean boundaries so the Conversation UI can be embedded in a richer scene later.

## Design Principles (to keep now)
- Keep the conversation layer independent: text/logic separate from rendering.
- Use capability detection: if timings/visemes are present, enhance; otherwise degrade gracefully.
- Make all avatar/background features user-optional with sensible defaults.
