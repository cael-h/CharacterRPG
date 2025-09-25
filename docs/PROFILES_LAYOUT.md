# Profiles Layout (Drop-in Bundles)

You can manage each character entirely under `profiles/`, and import them without touching `docs/`.

## Directory Structure (per character)

Place a folder under `character_profiles/` using the character’s name (e.g., `character_profiles/Olive/`). On import, the server will create a canonical bundle folder under `profiles/<slug>__<id>/` and copy your files in.

Inside your character folder you may include:

- `long_char_profile/` — the long/system profile
  - `profile.md` (or any single `.md` file in this folder)
- `short_char_prompt/` — short prompt file
  - `short.md` (or any single `.md` file in this folder)
- `base_prompt/` — base/generic style prompt
  - `generic.md` or `base.md` (any single `.md` file in this folder)
- `additional_context/` — extra docs, notes, or references (any files)
- `images/` — avatar image (pick one: png/jpg/webp)
- `memories/` — optional seed `memories.md` (copied into the bundle only)
- `timeline/` — optional seed `timeline.md` (copied into the bundle only)

Defaults and templates

- Put shared templates in `character_profiles/Default/`:
  - `generic.md` (generic style guidelines)
  - `short.md` (baseline short prompt)
  - `reviewer.md` (reviewer JSON prompt)
  These seed new/updated characters automatically when missing.

Examples

```
profiles/
  Olive/
    long_char_profile/profile.md
    short_char_prompt/short.md
    generic_prompt/generic.md
    additional_context/notes.md
    images/avatar.png
```

## Importing

- One-time or on-demand:
  - `curl -sX POST http://localhost:4000/api/characters/import-from-profiles | jq`
- Optional auto-import on server boot:
  - Set `AUTO_IMPORT_PROFILES=true` in `server/.env`.

## Where things end up

When imported, the server will:

- Create/update a character row in the DB by name.
- Write the canonical bundle at `profiles/<slug>__<id>/` with:
  - `profile.md` (base profile header + system prompt)
  - `prompt/short.md` and `prompt/generic.md` (from your files if provided)
  - `docs/` (copy of your `additional_context/`)
  - `memories/memories.md` and `timeline/timeline.md` (if provided)
- If `images/avatar.*` is present, copy it to `/uploads/avatars/` and set `characters.avatar_uri`.

Notes

- The existing `docs/Character_<Name>.md` importer still works; use whichever flow you prefer.
- The server also mirrors runtime memories/timeline into the bundle when enabled (`SYNC_CHARACTER_BUNDLES=true`, default).
