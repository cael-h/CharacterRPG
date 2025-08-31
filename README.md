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
- `docs/REQUIREMENTS.md` (functional/non‑functional requirements)
- `docs/ARCHITECTURE.md` (system design and data flow)
- `docs/DECISIONS.md` (key architectural decisions)
- `docs/ROADMAP.md` (phased milestones)
- `docs/IMPLEMENTATION_PLAN.md` (detailed plan for review; no code yet)
- `docs/BILLING_AND_USAGE.md` (BYOK, model toggles, usage metering, cost estimates)
- `docs/FUTURE_WORK.md` (cinematic avatars, backgrounds, local voice engines)
