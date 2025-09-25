#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:4000}"
ID="${ID:-}"
FORMAT="${FORMAT:-json}"  # json|md
if [ -z "$ID" ]; then echo "Usage: ID=<story_id> [FORMAT=json|md] npm run api:story:timeline:get" >&2; exit 1; fi
if [ "$FORMAT" = "md" ]; then
  curl -s "$BASE/api/stories/$ID/timeline?md=1"
else
  curl -s "$BASE/api/stories/$ID/timeline" | jq '.'
fi

