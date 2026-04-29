from __future__ import annotations

from functools import lru_cache

from backend.app.config import PROJECT_ROOT, settings


LOCAL_PLAY_UI_PATH = PROJECT_ROOT / "backend" / "app" / "ui" / "local_play.html"


@lru_cache(maxsize=4)
def load_local_play_ui(root_path: str | None = None) -> str:
    resolved_root_path = settings.root_path if root_path is None else root_path
    html = LOCAL_PLAY_UI_PATH.read_text(encoding="utf-8")
    return html.replace("__CHARACTERRPG_ROOT_PATH__", resolved_root_path)
