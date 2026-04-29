from __future__ import annotations

from backend.app.config import settings


def query_rag(query: str) -> str:
    settings.ensure_directories()
    if not query.strip():
        raise ValueError("Query text must not be empty.")

    manifest_path = settings.vector_index_dir / "index_manifest.yaml"
    if not manifest_path.exists():
        raise RuntimeError(
            "No vector index is available yet. Configure credentials and run "
            "`python scripts/reindex_drive.py --folder-id <id>` first."
        )

    return (
        "RAG integration is not wired to Google Drive yet. The repository has only been "
        "initialized, and the current index manifest marks retrieval as pending."
    )
