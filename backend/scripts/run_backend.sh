#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/../.."
exec uvicorn backend.app.main:app --host "${CHARACTERRPG_HOST:-127.0.0.1}" --port "${CHARACTERRPG_PORT:-4100}" --reload
