# CharacterRPG Server Architecture (Story‑First)

Overview
- SQLite schema: characters, sessions, turns, memories, timelines(+events), stories, session_story, story_participants, scene_state, snapshots, session_control.
- Filesystem (configurable roots under `server/`):
  - `profiles/` — canonical per‑character bundles (`<slug>__<charId>/`): profile.md, prompt/*, memories/memories.md, timeline/timeline.md, transcripts/index.md.
  - `character_profiles/` — user‑managed drop‑in bundles (import source; never mutated on purge).
  - `transcripts/stories/<storySlug__storyId>/session-<sessionId>.md` — authoritative story transcript files.
  - `timelines/` — global timeline at `timelines/global.md`; character timelines in profile bundles; story timelines at `timelines/stories/<storySlug__storyId>.md`.
  - `uploads/` — assets.

Key flows
- Session start → sessions row, optional Story create/continue → link in `session_story` → optionally seed `story_participants`.
- Turn post → persist player turn → enforce control map (never speak for player‑controlled characters) → call provider → write NPC turns, transcript lines, usage, memories → optional story/global timeline events.
- Player identity → `sessions.player_name` and/or `sessions.player_character_id`; additional control per character via `session_control`.
- Purge → script wipes DB (optional) and server‑managed dirs while preserving `character_profiles/`.

Control model
- `session_control(session_id, character_id, controller)` determines if the model or the player controls a character.
- When controller='player', that character is removed from the LLM character list; prompts include a “do not generate turns for …” directive.

Stories
- `stories(id, name, meta_json)`; `session_story(session_id, story_id)`; `story_participants(story_id, character_id, aware_of_json)`.
- Story timeline lives both in DB (timelines/timeline_events with scope='story', owner_id=storyId) and in a flat Markdown file under `timelines/stories/` for easy browsing.
- Awareness can express cross‑story knowledge per character (future UI/API).

RAG inputs
- Profile bundle (profile.md + prompt/* + docs/* + timeline.md) and recent memories.
- Reviewer selects a small set of snippets; result is appended to the system context.

Config
- `server/config.json` sets dirs, flags, and `user` defaults (name, nicknames, defaultPlayer).
