from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SHARED_ENV_KEYS = {
    "CHARACTERRPG_MODEL",
    "CHARACTERRPG_PROVIDER",
    "ROLEPLAYGPT_OPENAI_MODEL",
    "CHARACTERRPG_OPENAI_API_KEY",
    "CHARACTERRPG_OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    "CHARACTERRPG_OPENAI_COMPATIBLE_API_KEY",
    "CHARACTERRPG_OPENAI_COMPATIBLE_BASE_URL",
    "CHARACTERRPG_VENICE_API_KEY",
    "CHARACTERRPG_VENICE_KEY",
    "CHARACTERRPG_VENICE_BASE_URL",
    "CHARACTERRPG_VENICE_MODEL",
    "VENICE_API_KEY",
    "VENICE_AI_API_KEY",
    "VENICE_KEY",
    "VENICE_BASE_URL",
    "VENICE_MODEL",
    "CHARACTERRPG_OLLAMA_BASE_URL",
    "CHARACTERRPG_OLLAMA_MODEL",
    "OLLAMA_BASE",
    "OLLAMA_MODEL",
    "CHARACTERRPG_HUGGINGFACE_API_KEY",
    "CHARACTERRPG_HUGGINGFACE_BASE_URL",
    "HF_TOKEN",
}


def _strip_env_value(value: str) -> str:
    raw = value.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {"'", '"'}:
        return raw[1:-1]
    return raw


def _load_env_file(path: Path, allowed_keys: set[str] | None = None) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if allowed_keys is not None and key not in allowed_keys:
            continue
        if key and key not in os.environ:
            os.environ[key] = _strip_env_value(value)


def _normalize_root_path(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw or raw == "/":
        return ""
    return "/" + raw.strip("/")


@dataclass(frozen=True)
class Settings:
    default_provider: str
    default_model: str
    openai_api_key: str | None
    openai_base_url: str
    openai_model: str
    openai_compatible_api_key: str | None
    openai_compatible_base_url: str | None
    venice_api_key: str | None
    venice_base_url: str
    venice_model: str
    ollama_base_url: str
    ollama_model: str
    huggingface_api_key: str | None
    huggingface_base_url: str | None
    google_drive_folder_id: str | None
    google_service_account_file: str | None
    root_path: str
    public_base_url: str | None
    vector_index_dir: Path
    campaign_storage_dir: Path
    dev_test_storage_dir: Path

    @classmethod
    def from_env(cls) -> "Settings":
        default_model = os.getenv("CHARACTERRPG_MODEL") or os.getenv(
            "ROLEPLAYGPT_OPENAI_MODEL", "gpt-4o-mini"
        )
        openai_api_key = (
            os.getenv("CHARACTERRPG_OPENAI_API_KEY")
            or os.getenv("OPENAI_API_KEY")
            or os.getenv("OPENAI_KEY")
        )
        venice_api_key = (
            os.getenv("CHARACTERRPG_VENICE_API_KEY")
            or os.getenv("CHARACTERRPG_VENICE_KEY")
            or os.getenv("VENICE_API_KEY")
            or os.getenv("VENICE_AI_API_KEY")
            or os.getenv("VENICE_KEY")
        )
        venice_base_url = (
            os.getenv("CHARACTERRPG_VENICE_BASE_URL")
            or os.getenv("VENICE_BASE_URL")
            or "https://api.venice.ai/api/v1"
        ).rstrip("/")
        return cls(
            default_provider=os.getenv("CHARACTERRPG_PROVIDER", "mock"),
            default_model=default_model,
            openai_api_key=openai_api_key,
            openai_base_url=(os.getenv("CHARACTERRPG_OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
            openai_model=default_model,
            openai_compatible_api_key=os.getenv("CHARACTERRPG_OPENAI_COMPATIBLE_API_KEY"),
            openai_compatible_base_url=(
                os.getenv("CHARACTERRPG_OPENAI_COMPATIBLE_BASE_URL") or ""
            ).rstrip("/")
            or None,
            venice_api_key=venice_api_key,
            venice_base_url=venice_base_url,
            venice_model=os.getenv("CHARACTERRPG_VENICE_MODEL")
            or os.getenv("VENICE_MODEL")
            or "aion-labs-aion-2-0",
            ollama_base_url=(os.getenv("CHARACTERRPG_OLLAMA_BASE_URL") or os.getenv("OLLAMA_BASE") or "http://localhost:11434").rstrip("/"),
            ollama_model=os.getenv("CHARACTERRPG_OLLAMA_MODEL") or os.getenv("OLLAMA_MODEL", "llama3.1:8b-instruct"),
            huggingface_api_key=os.getenv("CHARACTERRPG_HUGGINGFACE_API_KEY") or os.getenv("HF_TOKEN"),
            huggingface_base_url=(os.getenv("CHARACTERRPG_HUGGINGFACE_BASE_URL") or "").rstrip("/")
            or None,
            google_drive_folder_id=os.getenv("GOOGLE_DRIVE_FOLDER_ID"),
            google_service_account_file=os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE"),
            root_path=_normalize_root_path(os.getenv("CHARACTERRPG_ROOT_PATH")),
            public_base_url=(os.getenv("CHARACTERRPG_PUBLIC_BASE_URL") or "").rstrip("/") or None,
            vector_index_dir=PROJECT_ROOT
            / os.getenv("CHARACTERRPG_VECTOR_INDEX_DIR", "storage/vector_index"),
            campaign_storage_dir=PROJECT_ROOT
            / os.getenv("CHARACTERRPG_STORAGE_DIR", "storage/CharacterRPG_Generated_Files"),
            dev_test_storage_dir=PROJECT_ROOT
            / os.getenv("CHARACTERRPG_TEST_STORAGE_DIR", "storage/CharacterRPG_Dev_Tests"),
        )

    def ensure_directories(self) -> None:
        self.vector_index_dir.mkdir(parents=True, exist_ok=True)
        self.campaign_storage_dir.mkdir(parents=True, exist_ok=True)
        self.dev_test_storage_dir.mkdir(parents=True, exist_ok=True)
        for child in ("test_runs", "test_results", "test_recaps", "test_world_state"):
            (self.dev_test_storage_dir / child).mkdir(parents=True, exist_ok=True)


_load_env_file(PROJECT_ROOT / ".env")
_load_env_file(PROJECT_ROOT / ".env.local")
_load_env_file(PROJECT_ROOT / "backend" / ".env")
_load_env_file(PROJECT_ROOT / "backend" / ".env.local")
_load_env_file(Path.home() / ".env", allowed_keys=SHARED_ENV_KEYS)
settings = Settings.from_env()
