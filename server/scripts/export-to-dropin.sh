#!/usr/bin/env bash
set -euo pipefail
# Export a runtime character bundle back to the drop-in directory.
# Usage: ID=<char_id> npm run export:dropin
#    or: NAME=<name> npm run export:dropin

BASE="${BASE:-http://localhost:4000}"
ID="${ID:-}"
NAME="${NAME:-}"

if [ -z "$ID" ] && [ -n "$NAME" ]; then
  ID=$(curl -s "$BASE/api/characters" | python3 - "$NAME" << 'PY'
import sys,json
name=sys.argv[1].lower()
try: rows=json.load(sys.stdin)
except Exception: rows=[]
for r in rows:
  if str(r.get('name','')).lower()==name:
    print(r.get('id',''))
    break
PY
)
fi

if [ -z "$ID" ]; then
  echo "Usage: ID=<char_id> or NAME=<name> npm run export:dropin" >&2
  exit 1
fi

curl -sX POST "$BASE/api/characters/$ID/export-to-dropin" | jq '.'

