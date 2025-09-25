# User Guide: Stories, Characters, and Shorthand Commands

Quick start
- Start server: `cd server && npm run dev`
- Import drop‑in profiles (if enabled): set `flags.autoImportProfiles=true` in `server/config.json`.

Starting a session
- Minimal (uses `config.user.defaultPlayer` if present):
  - `curl -sX POST :4000/api/sessions -H 'Content-Type: application/json' -d '{"participants":[]}'`
- Play as an existing character (e.g., Olive):
  - `curl -sX POST :4000/api/sessions -H 'Content-Type: application/json' -d '{"participants":[{"id":"<oliveId>","name":"Olive"}],"player":"char:Olive"}'`
- Play as a new user character (confirm creation):
  - 1) `curl -sX POST :4000/api/sessions -H 'Content-Type: application/json' -d '{"player":"Ellis"}'` → returns 409 with `{ error:"confirm_new_character" }`
  - 2) `curl -sX POST :4000/api/sessions -H 'Content-Type: application/json' -d '{"player":"Ellis","confirm_create_player":true}'`

Posting a turn
- `curl -sX POST :4000/api/convo/turn -H 'Content-Type: application/json' -d '{"session_id":"<sid>","player_text":"Hello","characters":[{"id":"<oliveId>","name":"Olive"}]}'`

Stories API
- List stories: `npm run api:stories:list`
- Get one story: `ID=<storyId> npm run api:story:get`
- Add a story timeline event:
  - `ID=<storyId> TITLE="Car arrives" SUMMARY="Olive reaches the pier" npm run api:story:timeline:add`
 - Get a story timeline:
   - `ID=<storyId> npm run api:story:timeline:get` (JSON)
   - `ID=<storyId> FORMAT=md npm run api:story:timeline:get` (Markdown file content)

Control (who speaks for a character)
- Hand Olive to the model: `curl -sX POST :4000/api/sessions/<sid>/control -H 'Content-Type: application/json' -d '{"character_id":"<oliveId>","controller":"llm"}'`
- Take control of Olive: `... -d '{"controller":"player"}'`

Cloning a character
- `curl -sX POST :4000/api/characters/<srcId>/clone -H 'Content-Type: application/json' -d '{"name":"Olive (AU)"}'`

Shorthand npm scripts
- `npm run api:stories:list` → list stories (id, name, sessions, participants)
- `ID=<storyId> npm run api:story:get` → detailed view
- Export a runtime bundle back to character_profiles:
  - `cd server && ID=<charId> npm run export:dropin`
  - or by name: `NAME=Ellis npm run export:dropin`
- Purge helpers (CAUTION): see `server/scripts/purge-*.sh`.

Storage layout
- Per‑character bundle: `server/profiles/<nameSlug__charId>/`
- Story transcripts: `server/transcripts/stories/<storySlug__storyId>/session-<sid>.md`
- Story timeline: `server/timelines/stories/<storySlug__storyId>.md`
- Character memories: `server/memories/<CharacterName>.md` (mirrored to bundle if enabled)

Guidelines
- Model never speaks for player‑controlled characters. If you want two Olives in a scene, use clone: create “Olive (Player)” and control that.
- To start where a character left off, play “char:Name” without cloning.

One‑shot CLI alias: crpg
- From the repo root you can run:
  - `./crpg` → interactive (auto‑starts server if needed)
  - `./crpg Olive` → chat with Olive (player from config)
  - `./crpg Olive Ellis` → player is Ellis
  - `./crpg Olive char:Olive` → act as Olive (model won’t speak for Olive)
  - Story inline: `./crpg Olive Ellis @MyStory` or `./crpg @MyStory Olive Ellis`
- Make it globally available:
  - `chmod +x crpg`
  - `ln -s "$(pwd)/crpg" /usr/local/bin/crpg` (may require sudo), or add the repo root to your PATH.
- Environment knobs:
  - `BASE` (default `http://localhost:4000`), `PROVIDER`, `MODEL`, `PROVIDER_KEY`, `USE_RAG`, `USE_RESPONSES`.
 - Debugging:
   - `CRPG_LOG=1 crpg` or `crpg --log` to tail server/.crpg.log
   - `CRPG_DEBUG=1 crpg` to print raw character list byte length
   - Server debug endpoints: `/api/debug/config`, `/api/debug/health`, `/api/characters/import-debug`, `POST /api/characters/import-now`

See `docs/DEBUGGING.md` for a deeper troubleshooting guide.
- Restart control:
  - Config: `flags.autoRestartOnLaunch` (bool) — if true, crpg kills any process on port 4000 and starts fresh.
  - CLI overrides: `--restart` (force), `--no-restart` (skip), regardless of config.
 - Shutdown control:
   - Config: `flags.autoShutdownOnExit` (bool, default true) — if crpg started the server, shut it down on exit.
   - CLI overrides: `--shutdown` (force), `--keep` (leave server running).
 - Interactive: when autoRestartOnLaunch is false and no CLI override, crpg asks “Restart server now? (y/N)”.

Two‑way sync (optional)
- Config: `flags.autoExportProfilesBack` (default false). When true, saving/importing/cloning/creating a character exports its server bundle to `profilesDropin` without overwriting existing folders; if a folder exists, a `-2`, `-3`, … suffix is added to the folder name, while the profile title remains the original character name.
