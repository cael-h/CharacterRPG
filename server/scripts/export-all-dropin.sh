#!/usr/bin/env bash
set -euo pipefail
# Export all runtime character bundles back to drop-in directory.
# Skips 'Default' by default; set INCLUDE_DEFAULT=1 to include.

BASE="${BASE:-http://localhost:4000}"
INCLUDE_DEFAULT="${INCLUDE_DEFAULT:-}"

ROWS=$(curl -s "$BASE/api/characters" || echo '[]')
printf '%s' "$ROWS" | python3 - "$BASE" "$INCLUDE_DEFAULT" << 'PY'
import sys,json,subprocess
base=sys.argv[1]
include_default=(sys.argv[2]=='1')
try:
  rows=json.loads(sys.stdin.read() or '[]')
except Exception:
  rows=[]
for r in rows:
  name=r.get('name') or ''
  if name=='Default' and not include_default:
    continue
  cid=r.get('id')
  if not cid: continue
  print(f"Exporting {name} ({cid})…", file=sys.stderr)
  subprocess.run(["curl","-sX","POST",f"{base}/api/characters/{cid}/export-to-dropin"], check=False)
PY

