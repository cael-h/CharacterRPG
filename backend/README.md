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
- `POST /campaign/bootstrap`
- `GET /campaign/bundle`
- `POST /play/respond`
- `GET /play/history`
- `POST /play/review`
- `POST /play/memory/index`
- `POST /play/memory/search`
