#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:4000}"
CONFIRM="${CONFIRM:-}"
# Optional toggles
# - set WIPE_DB=1 to delete rpg.sqlite instead of calling the API
# - set WIPE_UPLOADS=1 to clear uploads/* (default: 1)
# - set WIPE_LEGACY=1 to also clear legacy top-level folders outside server/ (default: 1)
# - set WIPE_DROPIN=1 to clear character_profiles/* drop-in bundles (default: 0)
WIPE_DB="${WIPE_DB:-}"
WIPE_UPLOADS="${WIPE_UPLOADS:-1}"
WIPE_LEGACY="${WIPE_LEGACY:-1}"
WIPE_DROPIN="${WIPE_DROPIN:-}"

if [ -z "$CONFIRM" ]; then
  echo "This will delete ALL characters and wipe server-managed files." >&2
  echo "Default behavior: calls API to delete characters, then removes server/{profiles,memories,timelines,transcripts,uploads}." >&2
  echo "Options: WIPE_DB=1 (delete rpg.sqlite), WIPE_LEGACY=1 (also clear legacy roots), WIPE_DROPIN=1 (clear character_profiles/)." >&2
  echo "Set CONFIRM=1 to proceed. Example: CONFIRM=1 npm run purge:characters" >&2
  exit 1
fi

if [ -n "$WIPE_DB" ]; then
  echo "WIPE_DB=1 set: deleting rpg.sqlite (full reset)" >&2
  rm -f rpg.sqlite
else
  echo "Listing characters from $BASE ..." >&2
  ROWS=$(curl -sf "$BASE/api/characters" || echo '[]')
  COUNT=$(printf '%s' "$ROWS" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
  echo "Found $COUNT characters" >&2
  if [ "$COUNT" != "0" ]; then
    echo "$ROWS" | python3 - "$BASE" << 'PY'
import sys,json,subprocess
base=sys.argv[1]
try:
  rows=json.load(sys.stdin)
except Exception:
  rows=[]
for r in rows:
  cid=r.get('id'); name=r.get('name')
  if not cid: continue
  print(f"Deleting {name} ({cid})", file=sys.stderr)
  subprocess.run(["curl","-sfX","DELETE",f"{base}/api/characters/{cid}"], check=False)
PY
  fi
fi

echo "Removing server-managed bundles and artifacts ..." >&2
rm -rf profiles/* || true
rm -rf memories/* || true
rm -rf timelines/* || true
rm -rf transcripts/* || true
if [ -n "$WIPE_UPLOADS" ]; then
  rm -rf uploads/* || true
fi

if [ -n "$WIPE_LEGACY" ]; then
  echo "Also removing legacy root-level folders (outside server/) ..." >&2
  # NB: the script runs from server/, so ../ points to repo root
  rm -rf ../memories/* ../timelines/* ../transcripts/* || true
fi

if [ -n "$WIPE_DROPIN" ]; then
  echo "WIPE_DROPIN=1 set: clearing character_profiles/* (drop-in bundles) ..." >&2
  rm -rf ../character_profiles/* || true
fi
echo "Done." >&2
