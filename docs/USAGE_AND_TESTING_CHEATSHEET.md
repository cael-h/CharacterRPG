# CharacterRPG — Usage & Testing Cheat Sheet

This page captures the minimal terminal commands to run the server, import character profiles from docs/, test conversations via curl, and drive the CLI.

## Prereqs
- Node 18+
- jq (for curl examples)

## 1) Start the Server
```
cd server
npm run dev
```

## 2) Import Characters from docs/
- Put Markdown files like `docs/Character_Olive.md` in the workspace.
- Import on demand:
```
curl -sX POST http://localhost:4000/api/characters/import-from-docs | jq
```

## 3) List Characters and Snapshot Profile
```
curl -s http://localhost:4000/api/characters | jq
# Snapshot current fields to base_json and write profiles/<id>/profile.md
curl -sX POST http://localhost:4000/api/characters/<CHAR_ID>/save-profile | jq
```

<<<<<<< HEAD
## 2b) Import Characters from character_profiles/ (drop-in bundles)
- Create a folder per character under `character_profiles/` (see `docs/PROFILES_LAYOUT.md`).
- Import on demand:
```
curl -sX POST http://localhost:4000/api/characters/import-from-profiles | jq
```
- Optional: set `autoImportProfiles: true` in `server/config.json` to auto-import on boot.

=======
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
## 4) OpenAI Key (BYOK)
Server secret lives in `server/.env`. For per-run override, pass a header (the loader supports `PROVIDER_KEY` in `scripts/olive.config`).
Option A (server secret): add to `server/.env` then restart server
```
OPENAI_API_KEY=sk-...
```
Option B (per-request header)
```
-H 'X-Provider-Key: YOUR_OPENAI_KEY'
```

## 5) Quick Chat Test (curl)
Start a session and send a turn using OpenAI with strict JSON reply.
```
SID=$(curl -sX POST http://localhost:4000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Olive Test","provider":"openai","participants":[{"id":"Olive"}]}' | jq -r .id)

curl -sX POST http://localhost:4000/api/convo/turn \
  -H 'Content-Type: application/json' \
  -H 'X-Provider-Key: YOUR_OPENAI_KEY' \
  -d "$(jq -n --arg sid "$SID" '{
    session_id:$sid,
    player_text:"Olive, what do you see from the Watchtower?",
    characters:[{name:"Olive",system_prompt:""}],
    provider:"openai",
    model:"gpt-4o-mini",
    useRag:false,
    reviewer_provider:"stub",
    reviewer_model:"gpt-4o-mini",
    style_short:true
  }')" | jq
```

## 6) Playground (browser)
```
http://localhost:4000/playground
```
- Provider: OpenAI
- Model: gpt-4o-mini (or gpt-4o)
- RAG: Optional; Reviewer: OpenAI or stub
Note: Playground does not capture API keys yet. Use server `.env` or pass header via curl.

## 7) CLI
```
cd server
npm run cli -- --rag=true --short=true
```
- Pick provider (mock, ollama, openai). For OpenAI, set `OPENAI_API_KEY` in server `.env` or use BYOK header.
- Space toggles characters; Enter confirms. `/end` to end session; `/exit` to quit.

## 8) Docs API (attach files to a character)
Assumes `<CHAR_ID>` from `/api/characters`.
```
# Upload (multipart)
curl -sX POST http://localhost:4000/api/characters/<CHAR_ID>/docs \
  -F file=@notes.md | jq

# List
curl -s http://localhost:4000/api/characters/<CHAR_ID>/docs | jq

# Download
curl -s http://localhost:4000/api/characters/<CHAR_ID>/docs/notes.md -o notes.md

# Delete
curl -sX DELETE http://localhost:4000/api/characters/<CHAR_ID>/docs/notes.md | jq
```

## 9) Reset/Delete Character
```
# Reset to base (also clears per-character memory/timeline files)
curl -sX POST http://localhost:4000/api/characters/<CHAR_ID>/reset | jq

# Delete character (removes row + per-character files). Transcripts remain.
curl -sX DELETE http://localhost:4000/api/characters/<CHAR_ID> | jq
```

## 10) Profile Import from Markdown
Replace a character’s base/system prompt with an uploaded `.md`.
```
curl -sX POST http://localhost:4000/api/characters/<CHAR_ID>/import-base \
  -F file=@Character_Olive.md | jq
```

## 11) Reviewer + RAG API (advanced)
Search and review directly:
```
# Search
curl -sX POST http://localhost:4000/api/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"character_id":"<CHAR_ID>","query":"watchtower river ford","k":8}' | jq

# Review (let reviewer LLM select); for 4o-mini
curl -sX POST http://localhost:4000/api/rag/review \
  -H 'Content-Type: application/json' \
  -d '{"reviewer_provider":"openai","reviewer_model":"gpt-4o-mini","x_provider_key":"YOUR_OPENAI_KEY","candidates":[]}' | jq

<<<<<<< HEAD
## 13) Config Split: config.json vs .env vs scripts/olive.config
- `server/config.json` (server): non-sensitive options
  - `port`, directory paths (`uploads`, `transcripts`, `memories`, `timelines`, `profiles`)
  - flags: `autoImportProfiles`, `syncCharacterBundles`
- `.env` (server): secrets only (API keys/endpoints)
  - `OPENAI_API_KEY`, `OPENAI_BASE`, `OPENAI_USE_RESPONSES`, etc.
=======
## 13) Config Split: .env vs scripts/olive.config
- `.env` (server): secrets + infra defaults only
  - `OPENAI_API_KEY`, `OPENAI_BASE`, `OPENAI_USE_RESPONSES`
  - `PORT`, `PROFILES_DIR`, `TRANSCRIPTS_DIR`, `MEMORIES_DIR`, `TIMELINES_DIR`
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
- `scripts/olive.config` (loader): non-secret per-run behavior
  - `PROVIDER`, `MODEL`, `USE_RAG`, `USE_RESPONSES`, `STYLE_SHORT`, `CH_NAME`, `SHORT`, `LONG_MD`, `PROVIDER_KEY` (optional)

Per-character defaults
- If `PROVIDER` or `MODEL` is empty or `auto`, the loader calls `/api/characters/:id/meta` and uses `provider_pref.provider/model` when present.
```

## 12) Troubleshooting
- 404 on profile export: run `save-profile` first to write the bundle.
- Long replies: enable `style_short` on convo; keep Short toggle on in the Conversation screen.
- BYOK headers: use `X-Provider-Key` for OpenAI calls when not using `.env`.
If a previous server is stuck on the port (e.g., 4000):
```
cd server
npm run kill:4000   # uses lsof/fuser to kill the listener
# or choose another port
PORT=4100 npm run dev
```
<<<<<<< HEAD

## Prompt Editor API
List, read, and update per-character prompts.
```
# List
curl -s http://localhost:4000/api/characters/<CHAR_ID>/prompt | jq

# Read short.md
curl -s http://localhost:4000/api/characters/<CHAR_ID>/prompt/short.md

# Update reviewer.md
curl -sX PUT http://localhost:4000/api/characters/<CHAR_ID>/prompt/reviewer.md \
  -H 'Content-Type: application/json' -d '{"content":"You are the reviewer..."}' | jq

# Bulk refresh generic.md (uses profiles/Default/generic.md, falls back to docs)
curl -sX POST http://localhost:4000/api/characters/refresh-generic | jq
```

## Verbose Backend Mode
Prints backend actions (prompt injections, RAG scoring, reviewer picks) to console and transcript as `system:` lines.
```
cd server
VERBOSE=1 npm run dev
```

## Runtime Slash Commands
Use inside your next player message to force context refresh this turn:
- `/reseed prompts` — inject generic guidelines + character briefs
- `/reseed profile` — inject long profile excerpt once
- `/reseed all` — both

Note: If `character_profiles/Default/generic.md` is missing (and the docs fallback is also missing), the server will add a stub and warn on the first session turn.
=======
>>>>>>> 6592229df14f2c8e73dc251dab1748a39fb567a2
