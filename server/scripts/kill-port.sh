#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4000}"
echo "Looking for listeners on tcp:$PORT ..." >&2

KILLED=0

if command -v lsof >/dev/null 2>&1; then
  PIDS=$(sudo lsof -t -iTCP:"$PORT" -sTCP:LISTEN || true)
  if [ -n "$PIDS" ]; then
    echo "lsof found: $PIDS" >&2
    sudo kill $PIDS || true
    sleep 0.2
    PIDS2=$(sudo lsof -t -iTCP:"$PORT" -sTCP:LISTEN || true)
    if [ -n "$PIDS2" ]; then
      echo "Force killing: $PIDS2" >&2
      sudo kill -9 $PIDS2 || true
    fi
    KILLED=1
  fi
fi

if [ "$KILLED" -eq 0 ] && command -v fuser >/dev/null 2>&1; then
  echo "Using fuser on $PORT/tcp" >&2
  sudo fuser -k ${PORT}/tcp || true
  KILLED=1
fi

if command -v ss >/dev/null 2>&1; then
  echo "Remaining listeners:" >&2
  ss -ltnp | grep ":$PORT" || true
fi

echo "Done." >&2

