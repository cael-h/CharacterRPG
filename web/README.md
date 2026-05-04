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

## Android PWA

The Android shortcut launcher serves the production build with Vite preview by default, so Chrome can install CharacterRPG as a standalone app.

From the project root:

```bash
scripts/install_android_shortcut.sh
```

Then use the `CharacterRPG` Termux:Widget shortcut. For one-time install, open the app URL in Chrome, choose `Install app` or `Add to Home screen`, and use the same shortcut afterward. Android may require Restricted settings plus Display over other apps for Termux before the widget can bring the app window forward.
