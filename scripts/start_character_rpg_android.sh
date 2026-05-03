#!/data/data/com.termux/files/usr/bin/sh
set -eu

APP_DIR="${CHARACTERRPG_HOME:-/data/data/com.termux/files/home/projects/CharacterRPG}"
BACKEND_HOST="${CHARACTERRPG_BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${CHARACTERRPG_BACKEND_PORT:-4100}"
FRONTEND_HOST="${CHARACTERRPG_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${CHARACTERRPG_FRONTEND_PORT:-5173}"
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}"

cd "$APP_DIR"
mkdir -p .runtime

is_up() {
  curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

wait_for_url() {
  url="$1"
  attempts="${2:-30}"
  while [ "$attempts" -gt 0 ]; do
    if is_up "$url"; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 1
  done
  return 1
}

notify_failure() {
  message="$1"
  if command -v termux-toast >/dev/null 2>&1; then
    termux-toast "$message"
  else
    echo "$message" >&2
  fi
}

start_backend() {
  if is_up "${BACKEND_URL}/health"; then
    return 0
  fi

  setsid .venv/bin/python -m uvicorn backend.app.main:app \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT" \
    > .runtime/backend.log 2>&1 < /dev/null &
  echo "$!" > .runtime/backend.pid
}

start_frontend() {
  if is_up "$FRONTEND_URL"; then
    return 0
  fi

  cd web
  setsid npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" \
    > ../.runtime/frontend.log 2>&1 < /dev/null &
  echo "$!" > ../.runtime/frontend.pid
  cd ..
}

start_backend
if ! wait_for_url "${BACKEND_URL}/health" 30; then
  notify_failure "CharacterRPG backend did not start"
  exit 1
fi

start_frontend
if ! wait_for_url "$FRONTEND_URL" 30; then
  notify_failure "CharacterRPG frontend did not start"
  exit 1
fi

termux-open-url "$FRONTEND_URL"
