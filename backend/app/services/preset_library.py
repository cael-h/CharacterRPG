from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from backend.app.config import PROJECT_ROOT


PRESET_LIBRARY_PATH = PROJECT_ROOT / "gpt_builder" / "knowledge" / "rpg_presets.yaml"


@lru_cache(maxsize=1)
def load_preset_library(path: Path = PRESET_LIBRARY_PATH) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return {
        "defaults": dict(payload.get("defaults", {})),
        "presets": dict(payload.get("presets", {})),
    }


def get_preset_defaults() -> dict[str, Any]:
    return dict(load_preset_library()["defaults"])


def get_named_preset(name: str | None) -> dict[str, Any]:
    if not name:
        return {}

    preset_name = name.strip()
    if not preset_name:
        return {}

    presets = load_preset_library()["presets"]
    try:
        return dict(presets[preset_name])
    except KeyError as exc:
        available = ", ".join(sorted(presets))
        raise ValueError(
            f"Unknown preset_name '{preset_name}'. Available presets: {available}"
        ) from exc
