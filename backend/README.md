# CharacterRPG Backend

This is the new Python/FastAPI backend foundation for CharacterRPG. It copies and adapts the useful campaign/session runtime from the sibling `RolePlayGPT` project while keeping that repo independent and usable.

## Run Locally

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .[dev]
uvicorn backend.app.main:app --reload --port 4100
```

## Provider Configuration

The default provider is `mock`, so the backend can run and test without external keys.
The backend automatically loads environment variables from `../.env`, `../.env.local`,
`backend/.env`, or `backend/.env.local` without requiring you to export them in the shell.
For Termux convenience, it also reads a small whitelist of model-provider keys from `~/.env`.

Useful environment variables:

- `CHARACTERRPG_PROVIDER=mock|openai_responses|openai_compatible|venice|ollama|huggingface`
- `CHARACTERRPG_MODEL=gpt-4o-mini`
- `CHARACTERRPG_MODEL_TIMEOUT_SECONDS=180`
- `CHARACTERRPG_OPENAI_API_KEY=...` or `OPENAI_API_KEY=...` or `OPENAI_KEY=...`
- `CHARACTERRPG_OPENAI_BASE_URL=https://api.openai.com/v1`
- `CHARACTERRPG_VENICE_API_KEY=...` or `VENICE_API_KEY=...` or `VENICE_KEY=...`
- `CHARACTERRPG_VENICE_BASE_URL=https://api.venice.ai/api/v1`
- `CHARACTERRPG_VENICE_MODEL=...`
- `CHARACTERRPG_OPENAI_COMPATIBLE_BASE_URL=...`
- `CHARACTERRPG_OPENAI_COMPATIBLE_API_KEY=...`
- `CHARACTERRPG_OLLAMA_BASE_URL=http://localhost:11434`
- `CHARACTERRPG_OLLAMA_MODEL=llama3.1:8b-instruct`
- `CHARACTERRPG_HUGGINGFACE_API_KEY=...`
- `CHARACTERRPG_HUGGINGFACE_BASE_URL=...`

Runtime storage defaults to `storage/CharacterRPG_Generated_Files/`.

## Initial API

- `GET /health`
- `GET /providers`
- `POST /providers/test`
- `POST /setup/respond`
- `POST /setup/review`
- `POST /campaign/bootstrap`
- `GET /campaign/bundle`
- `POST /play/respond`
- `GET /play/runtime-settings`
- `POST /play/runtime-settings`
- `GET /play/history`
- `POST /play/review`
- `POST /play/memory/index`
- `POST /play/memory/search`

## Runtime Play Notes

`POST /play/runtime-settings` stores provider, model, choice-prompt, mature-content,
and operator-note preferences for a campaign or a named session. `/play/respond`
uses those saved settings when the request does not explicitly override provider
or model. Mature-content handling defaults on, with guardrails for minors and
sexual violence, so normal adult stakes do not make the runtime halt or steer away.

Play turns ask capable models for a structured JSON turn with player-facing
`reply` plus conservative updates for world state, timeline, recap, quest notes,
story threads, event queue, and NPC memory. If a model returns normal prose
instead, the backend tries one structured repair pass. If repair still fails or
the provider is rate-limited, the reply still works and persistence falls back
to transcript + turn count only.

Campaigns now use `story_threads.yaml` as the main momentum primitive. Factions
are optional; the bootstrap only creates them when the requested story frame
explicitly points that way. The runtime builds a story-director brief from active
threads each turn, so mysteries, romances, horror, survival, slice-of-life, and
personal dramas can keep moving without forcing faction politics.
