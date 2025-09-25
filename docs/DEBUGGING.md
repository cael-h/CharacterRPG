# Debugging CharacterRPG (Server + CLI)

This guide helps diagnose startup, import, and launcher issues quickly.

Key paths
- Repo root: `~/CharacterRPG`
- Server dir: `server/`
- Drop-in profiles dir (source of truth): `character_profiles/` (repo root)
- Runtime profiles dir (managed by server): `server/profiles/`

Important config (server/config.json)
- `dirs.profilesDropin`: "../character_profiles" (server-relative)
- `flags.autoImportProfiles`: true
- `flags.autoExportProfilesBack`: true|false
- `flags.autoRestartOnLaunch`: true|false (affects crpg)
- `flags.autoShutdownOnExit`: true|false (affects crpg)

Server diagnostics
- Health with extra info: `GET /api/debug/health`
- Resolved config: `GET /api/debug/config`
- Drop-in import scan: `GET /api/characters/import-debug` → shows `cwd`, `base`, `abs`, `exists`, and folder entries.
- Trigger import now: `POST /api/characters/import-now` → returns `count` and `names` plus scan summary.
- List characters: `GET /api/characters`

CLI diagnostics (crpg)
- Start/reset server and log to `server/.crpg.log`:
  - `crpg --restart`
  - Tail logs: `CRPG_LOG=1 crpg` or `crpg --log`
- Show raw characters JSON byte length: set `CRPG_DEBUG=1`
  - `CRPG_DEBUG=1 crpg`
- Expected flow when no characters exist:
  1) "No characters found. Importing from drop-in profiles…"
  2) If still empty, prints two debug lines from `import-debug` and one from `import-now`.
  3) Prompts to seed from folder names (if enabled in launcher flow).

Common fixes
- Server using old config/code → Restart:
  - `cd server && npm run kill:4000` then `crpg --restart`
- Drop-in path wrong → Check `GET /api/debug/config` → `resolved.profilesDropin` should be an absolute path to repo `character_profiles`.
- Importer sees entries but no rows created → `POST /api/characters/import-now` and inspect response.

Notes
- Purges wipe only `server/` managed dirs; `character_profiles/` is preserved.
- Creating a new character as a player writes only to `server/profiles/` by default; enable `autoExportProfilesBack` to mirror to `character_profiles/`.
