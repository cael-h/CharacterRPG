from __future__ import annotations

from datetime import UTC, datetime

import yaml

from backend.app.config import settings


def index_drive_folder(folder_id: str | None = None) -> dict[str, str]:
    resolved_folder_id = folder_id or settings.google_drive_folder_id
    if not resolved_folder_id:
        raise ValueError("A Google Drive folder id is required before indexing can run.")

    settings.ensure_directories()
    manifest_path = settings.vector_index_dir / "index_manifest.yaml"
    manifest = {
        "status": "pending_external_integration",
        "folder_id": resolved_folder_id,
        "indexed_at": datetime.now(UTC).isoformat(),
        "notes": (
            "Repository initialized. Real Google Drive indexing is blocked until "
            "credentials and the on-device RAG dependency stack are validated."
        ),
    }
    manifest_path.write_text(yaml.safe_dump(manifest, sort_keys=False), encoding="utf-8")
    return manifest
