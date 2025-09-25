#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-4000}"
HOST="${HOST:-localhost}"

curl -sX POST "http://$HOST:$PORT/api/characters/refresh-generic" \
  -H 'Content-Type: application/json' | jq

