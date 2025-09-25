#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:4000}"
ID="${ID:-}"
if [ -z "$ID" ]; then echo "Usage: ID=<story_id> npm run api:story:get" >&2; exit 1; fi
curl -s "$BASE/api/stories/$ID" | jq '.'

