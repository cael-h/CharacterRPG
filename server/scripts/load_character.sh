#!/usr/bin/env bash
set -euo pipefail

CFG="${1:-scripts/olive.config}"
if [ ! -f "$CFG" ]; then
  echo "Config not found: $CFG" >&2
  exit 1
fi
set -a; source "$CFG"; set +a

# Health check
if ! curl -sf "$BASE/health" >/dev/null; then
  echo "Server at $BASE not reachable. Start it: cd server && npm run dev" >&2
  exit 1
fi

BASE="${BASE:-http://localhost:4000}"
CH_NAME="${CH_NAME:-Olive}"
SHORT="${SHORT:-}"
LONG_MD="${LONG_MD:-}"
LONG_PDF="${LONG_PDF:-}"
PROVIDER="${PROVIDER:-}"
MODEL="${MODEL:-}"
REVIEWER_PROVIDER="${REVIEWER_PROVIDER:-openai}"
REVIEWER_MODEL="${REVIEWER_MODEL:-gpt-5-nano}"
STYLE_SHORT="${STYLE_SHORT:-true}"
PROVIDER_KEY="${PROVIDER_KEY:-}"
USE_RAG="${USE_RAG:-true}"
USE_RESPONSES="${USE_RESPONSES:-false}"
USE_PREFS="${USE_PREFS:-true}"

json_get() { python3 - "$@" << 'PY'
import sys, json
s = sys.stdin.read().strip()
if not s:
    print('')
    sys.exit(0)
try:
    data = json.loads(s)
except Exception:
    print('')
    sys.exit(0)
path = sys.argv[1]
cur = data
for key in path.split('.'):
    if isinstance(cur, dict):
        cur = cur.get(key)
    else:
        cur = None
    if cur is None:
        break
if cur is None or isinstance(cur, (dict, list)):
    print('')
else:
    print(cur)
PY
}

char_id() {
  curl -s "$BASE/api/characters" | python3 - "$CH_NAME" << 'PY'
import sys, json
name = sys.argv[1]
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
for r in rows:
    if r.get('name') == name:
        print(r.get('id',''))
        break
PY
}

ensure_char() {
  local id
  id=$(char_id)
  if [ -z "$id" ]; then
    echo "Creating character $CH_NAME" >&2
    resp=$(curl -sfX POST "$BASE/api/characters" -H 'Content-Type: application/json' \
      -d '{"name":"'"$CH_NAME"'","system_prompt":""}' || true)
    echo "Create resp: $resp" >&2
    # Try JSON parser, then regex fallback
    id=$(printf '%s' "$resp" | json_get id || true)
    if [ -z "$id" ]; then
      id=$(printf '%s' "$resp" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
    fi
    # Retry fetch by name a few times (eventual consistency)
    if [ -z "$id" ]; then
      for i in 1 2 3 4 5; do
        sleep 0.2
        id=$(char_id)
        [ -n "$id" ] && break
      done
    fi
  fi
  echo "$id"
}

CID=$(ensure_char)
echo "Character: $CH_NAME ($CID)"

if [ -n "$SHORT" ] && [ -f "$SHORT" ]; then
  echo "Importing base prompt from $SHORT"
  curl -sX POST "$BASE/api/characters/$CID/import-base" -F file=@"$SHORT" >/dev/null
fi

if [ -n "$LONG_MD" ] && [ -f "$LONG_MD" ]; then
  echo "Uploading long MD: $LONG_MD"
  curl -sX POST "$BASE/api/characters/$CID/docs" -F file=@"$LONG_MD" >/dev/null
fi

if [ -n "$LONG_PDF" ] && [ -f "$LONG_PDF" ]; then
  echo "Uploading PDF (stored only): $LONG_PDF"
  curl -sX POST "$BASE/api/characters/$CID/docs" -F file=@"$LONG_PDF" >/dev/null
fi

echo "Syncing bundle"
curl -sX POST "$BASE/api/characters/$CID/sync-files" >/dev/null

# Optional: provider/model fallback from character meta when not set or set to 'auto'
if [ "$USE_PREFS" = "true" ] || [ "$USE_PREFS" = "1" ]; then
  if [ -z "$PROVIDER" ] || [ "$PROVIDER" = "auto" ] || [ -z "$MODEL" ] || [ "$MODEL" = "auto" ]; then
    META=$(curl -s "$BASE/api/characters/$CID/meta")
    P_REF=$(printf '%s' "$META" | json_get provider_pref.provider || true)
    M_REF=$(printf '%s' "$META" | json_get provider_pref.model || true)
    if [ -z "$PROVIDER" ] || [ "$PROVIDER" = "auto" ]; then
      [ -n "$P_REF" ] && PROVIDER="$P_REF"
    fi
    if [ -z "$MODEL" ] || [ "$MODEL" = "auto" ]; then
      [ -n "$M_REF" ] && MODEL="$M_REF"
    fi
  fi
fi

# Final defaults if still unset
[ -z "$PROVIDER" ] && PROVIDER="openai"
[ -z "$MODEL" ] && MODEL="gpt-4o-mini"

# Story selection
STORY_NAME="${STORY:-}"
STORY_MODE="new"
if [ -z "${STORY_NAME}" ]; then
  # If stories exist, ask to continue
  SROOT="profiles/$CID/stories"
  if [ -d "$SROOT" ] && [ -n "$(ls -A "$SROOT" 2>/dev/null)" ]; then
    echo "Existing stories:" >&2
    ls -1 "$SROOT" | sed 's/^/  - /'
    read -rp "Continue existing story? (y/N): " ANS || true
    if [[ "$ANS" =~ ^[Yy]$ ]]; then
      read -rp "Enter story name from list: " STORY_NAME
      STORY_MODE="continue"
    else
      read -rp "New story name [story1]: " STORY_NAME || true
      [ -z "$STORY_NAME" ] && STORY_NAME="story1"
      STORY_MODE="new"
    fi
  else
    STORY_NAME="story1"
    STORY_MODE="new"
  fi
else
  STORY_MODE="continue"
fi

echo "Starting session ($PROVIDER • $MODEL) — ${STORY_MODE} story \"$STORY_NAME\" with $CH_NAME"
RESP=$(curl -sfX POST "$BASE/api/sessions" -H 'Content-Type: application/json' \
  -d '{"title":"'"$CH_NAME"' Test","provider":"'"$PROVIDER"'","participants":[{"id":"'"$CID"'"}],"story":"'"$STORY_NAME"'","story_mode":"'"$STORY_MODE"'"}')
echo "Session resp: $RESP" >&2
SID=$(printf '%s' "$RESP" | json_get id || true)
if [ -z "$SID" ]; then
  SID=$(printf '%s' "$RESP" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi
if [ -z "$SID" ]; then echo "Failed to start session. Response: $RESP" >&2; exit 1; fi
echo "SID=$SID"

echo "Type messages. Commands: /exit to quit"
DEBUG_ECHO="${DEBUG_ECHO:-0}"
DEBUG_PRINT="${DEBUG_PRINT:-0}"
URL_TURN="$BASE/api/convo/turn"
if [ "$DEBUG_ECHO" = "1" ]; then URL_TURN="$URL_TURN?debug=1"; fi

while IFS= read -rp "> " MSG; do
  [ "$MSG" = "/exit" ] && break
  [ -z "$MSG" ] && continue
  if [ -n "$PROVIDER_KEY" ]; then EXTRA_HEADER=( -H "X-Provider-Key: $PROVIDER_KEY" ); else EXTRA_HEADER=(); fi
  RES=$(curl -sS "${EXTRA_HEADER[@]}" -H 'Content-Type: application/json' -X POST "$URL_TURN" \
    -w "\n__HTTP_STATUS__=%{http_code}" -d @- <<JSON
{
  "session_id": "$SID",
  "player_text": $(printf %s "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "characters": [{"name": "$CH_NAME", "system_prompt": ""}],
  "provider": "$PROVIDER",
  "model": "$MODEL",
  "useRag": ${USE_RAG},
  "use_responses": ${USE_RESPONSES},
  "reviewer_provider": "$REVIEWER_PROVIDER",
  "reviewer_model": "$REVIEWER_MODEL",
  "style_short": ${STYLE_SHORT}
}
JSON
)
  # Split body and status (robust): last line has __HTTP_STATUS__=NNN
  STATUS=$(printf '%s' "$RES" | tail -n1 | sed -n 's/.*__HTTP_STATUS__=\([0-9][0-9][0-9]\).*/\1/p')
  BODY=$(printf '%s' "$RES" | sed '$d')
  # Print each NPC turn "Speaker: text"; if not JSON, echo raw body with status
  if [ "$DEBUG_PRINT" = "1" ]; then echo "[DBG] /convo/turn status=$STATUS bytes=$(printf '%s' "$BODY" | wc -c | tr -d ' ')" >&2; fi
  python3 -c '
import sys, json
status = sys.argv[1] if len(sys.argv)>1 else "?"
data_raw = sys.stdin.read()
try:
    data = json.loads(data_raw)
    turns = data.get("turns", [])
    for t in turns:
        sp = t.get("speaker", "")
        tx = t.get("text", "")
        print(f"{sp}: {tx}")
except Exception as e:
    if data_raw.strip():
        print(f"[HTTP {status}]", data_raw)
    else:
        print(f"[HTTP {status}] Empty response")
' "$STATUS" <<< "$BODY"
done

exit 0
