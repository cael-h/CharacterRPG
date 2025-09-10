#!/usr/bin/env bash
# Helper functions for working with a single character (default: Olive)

# Config (override in your shell before sourcing if desired)
: "${BASE:=http://localhost:4000}"
: "${CH_NAME:=Olive}"
: "${SHORT:=/home/kmhughe1/MyCharacters/Olive/Olive_short.md}"
: "${LONG_MD:=/home/kmhughe1/MyCharacters/Olive/Character_Olive.md}"
: "${LONG_PDF:=/home/kmhughe1/MyCharacters/Olive/Character_Olive.pdf}"

char_id() { curl -s "$BASE/api/characters" | jq -r --arg n "$CH_NAME" '.[]|select(.name==$n)|.id'; }
ensure_char() {
  local id=$(char_id)
  if [ -z "$id" ] || [ "$id" = null ]; then
    id=$(curl -sX POST "$BASE/api/characters" -H 'Content-Type: application/json' \
      -d '{"name":"'"$CH_NAME"'","system_prompt":""}' | jq -r .id)
  fi
  echo "$id"
}

import_base() { # usage: import_base <file.md>
  local id=$(ensure_char)
  curl -sX POST "$BASE/api/characters/$id/import-base" -F file=@"$1" | jq
}

upload_doc() { # usage: upload_doc <file>
  local id=$(ensure_char)
  curl -sX POST "$BASE/api/characters/$id/docs" -F file=@"$1" | jq
}

sync_bundle() {
  local id=$(ensure_char)
  curl -sX POST "$BASE/api/characters/$id/sync-files" | jq
}

save_profile() {
  local id=$(ensure_char)
  curl -sX POST "$BASE/api/characters/$id/save-profile" | jq
}

start_session() { # usage: SID=$(start_session [provider] [model])
  local id=$(ensure_char) prov=${1:-openai} mdl=${2:-gpt-5-nano}
  curl -sX POST "$BASE/api/sessions" -H 'Content-Type: application/json' \
    -d '{"title":"'"$CH_NAME"' Test","provider":"'"$prov"'","participants":[{"id":"'"$id"'"}]}' | jq -r .id
}

say() { # usage: say "message" [provider] [model]
  local msg="$1" prov=${2:-openai} mdl=${3:-gpt-5-nano}
  local id=$(ensure_char)
  if [ -z "${SID:-}" ]; then
    echo "SID is not set. Start a session: SID=\$(start_session)" >&2; return 1
  fi
  curl -sX POST "$BASE/api/convo/turn" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg sid "$SID" --arg name "$CH_NAME" --arg msg "$msg" --arg prov "$prov" --arg mdl "$mdl" '{
      session_id:$sid,
      player_text:$msg,
      characters:[{name:$name, system_prompt:""}],
      provider:$prov,
      model:$mdl,
      useRag:true,
      reviewer_provider:"openai",
      reviewer_model:"gpt-5-nano",
      style_short:true
    }')" | jq
}

echo "Loaded helpers for CH_NAME=$CH_NAME BASE=$BASE"
echo "Commands: ensure_char, import_base <file>, upload_doc <file>, sync_bundle, save_profile, start_session [prov] [model], say \"msg\" [prov] [model]"
