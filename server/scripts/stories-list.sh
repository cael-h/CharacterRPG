#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:4000}"
curl -s "$BASE/api/stories" | jq -r '.[] | "\(.id)\t\(.name)\t\(.sessions|length) sessions\tparticipants: \(.participants|map(.name)|join(", "))"'

