#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:4000}"
ID="${ID:-}"
TITLE="${TITLE:-}"
SUMMARY="${SUMMARY:-}"
if [ -z "$ID" ] || [ -z "$TITLE" ] || [ -z "$SUMMARY" ]; then
  echo "Usage: ID=<story_id> TITLE='Event' SUMMARY='Short description' npm run api:story:timeline:add" >&2
  exit 1
fi
curl -sX POST "$BASE/api/stories/$ID/timeline" -H 'Content-Type: application/json' \
  -d "{\"title\":$(jq -Rn --arg x "$TITLE" '$x'),\"summary\":$(jq -Rn --arg x "$SUMMARY" '$x')}" | jq '.'

