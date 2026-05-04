#!/data/data/com.termux/files/usr/bin/sh
set -eu

APP_DIR="${CHARACTERRPG_HOME:-/data/data/com.termux/files/home/projects/CharacterRPG}"
SHORTCUT_NAME="${CHARACTERRPG_SHORTCUT_NAME:-CharacterRPG}"
SHORTCUT_DIR="${HOME}/.shortcuts"
TASK_DIR="${HOME}/.shortcuts/tasks"
ICON_DIR="${HOME}/.shortcuts/icons"
ICON_SOURCE="${CHARACTERRPG_SHORTCUT_ICON:-${APP_DIR}/assets/android/CharacterRPG.png}"

mkdir -p "$SHORTCUT_DIR" "$TASK_DIR" "$ICON_DIR"

cp "${APP_DIR}/scripts/start_character_rpg_android.sh" "${SHORTCUT_DIR}/${SHORTCUT_NAME}"
chmod +x "${SHORTCUT_DIR}/${SHORTCUT_NAME}"
cp "${APP_DIR}/scripts/start_character_rpg_android.sh" "${TASK_DIR}/${SHORTCUT_NAME}"
chmod +x "${TASK_DIR}/${SHORTCUT_NAME}"

if [ -f "$ICON_SOURCE" ]; then
  cp "$ICON_SOURCE" "${ICON_DIR}/${SHORTCUT_NAME}.png"
else
  echo "Icon source not found: ${ICON_SOURCE}" >&2
  exit 1
fi

echo "Installed Termux:Widget foreground shortcut: ${SHORTCUT_DIR}/${SHORTCUT_NAME}"
echo "Installed Termux:Widget background task: ${TASK_DIR}/${SHORTCUT_NAME}"
echo "Installed Termux:Widget icon: ${ICON_DIR}/${SHORTCUT_NAME}.png"
