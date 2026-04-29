# CharacterRPG Web

Responsive React client for the new FastAPI backend.

## Run

Start the backend first:

```bash
. .venv/bin/activate
backend/scripts/run_backend.sh
```

Then start the web client:

```bash
cd web
npm run dev
```

Default URLs:

- Backend: `http://127.0.0.1:4100`
- Web: `http://127.0.0.1:5173`

The client currently targets the backend API directly and uses the `mock` provider by default, so it can bootstrap a campaign and persist mock turns without external model keys.
