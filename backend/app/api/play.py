from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse

from backend.app.config import settings
from backend.app.models.play import (
    LocalPlayRequest,
    LocalPlayResponse,
    PlayCampaignSummary,
    PlaySessionSummary,
    PlayTranscriptEntry,
    RuntimeSettings,
    RuntimeSettingsRequest,
)
from backend.app.models.review import SessionReviewRequest, SessionReviewResponse
from backend.app.models.transcript_memory import (
    TranscriptMemoryBuildRequest,
    TranscriptMemoryIndexResponse,
    TranscriptMemorySearchRequest,
    TranscriptMemorySearchResponse,
)
from backend.app.services.campaign_storage import CampaignStorage
from backend.app.services.local_play import generate_local_play_response
from backend.app.services.local_play_ui import load_local_play_ui
from backend.app.services.session_review import generate_session_review
from backend.app.services.transcript_memory import build_transcript_memory_index, search_transcript_memory


router = APIRouter(prefix="/play", tags=["play"])
storage = CampaignStorage(settings.campaign_storage_dir)


def _resolve_storage(session_id: str | None, campaign_id: str | None = None) -> CampaignStorage:
    try:
        if session_id:
            return storage.resolve_session_storage(session_id, campaign_id)
        if campaign_id:
            campaign_storage = storage.for_campaign(campaign_id)
            if not campaign_storage.has_bundle():
                raise ValueError(f"Campaign {campaign_id!r} does not exist.")
            return campaign_storage
        return storage
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if 'does not exist' in message else 400
        raise HTTPException(status_code=status_code, detail=message) from exc


@router.get(
    "/ui",
    response_class=HTMLResponse,
    operation_id="getLocalPlayUi",
    summary="Open the local browser UI for private play testing.",
)
def get_play_ui() -> HTMLResponse:
    return HTMLResponse(load_local_play_ui())


@router.get(
    "/campaigns",
    response_model=list[PlayCampaignSummary],
    operation_id="listLocalPlayCampaigns",
    summary="List saved campaigns.",
)
def list_play_campaigns() -> list[PlayCampaignSummary]:
    return storage.list_campaigns()


@router.get(
    "/sessions",
    response_model=list[PlaySessionSummary],
    operation_id="listLocalPlaySessions",
    summary="List saved local play sessions and forks.",
)
def list_play_sessions(campaign_id: str | None = Query(default=None)) -> list[PlaySessionSummary]:
    return storage.list_sessions(campaign_id=campaign_id)


@router.get(
    "/history",
    response_model=list[PlayTranscriptEntry],
    operation_id="getLocalPlayHistory",
    summary="Get recent local play transcript entries.",
)
def get_play_history(
    limit: int = Query(default=20, ge=1, le=1000),
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> list[PlayTranscriptEntry]:
    active_storage = _resolve_storage(session_id, campaign_id)
    return active_storage.load_play_history(limit=limit)


@router.get(
    "/runtime-settings",
    response_model=RuntimeSettings,
    operation_id="getRuntimeSettings",
    summary="Get saved provider/model runtime settings for a campaign or session.",
)
def get_runtime_settings(
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> RuntimeSettings:
    return _resolve_storage(session_id, campaign_id).load_runtime_settings()


@router.post(
    "/runtime-settings",
    response_model=RuntimeSettings,
    operation_id="saveRuntimeSettings",
    summary="Save provider/model runtime settings for a campaign or session.",
)
def save_runtime_settings(request: RuntimeSettingsRequest) -> RuntimeSettings:
    target_storage = _resolve_storage(request.session_id, request.campaign_id)
    runtime_settings = RuntimeSettings(
        provider=request.provider,
        model=request.model,
        include_choices=request.include_choices,
        mature_content_enabled=request.mature_content_enabled,
        notes=request.notes,
    )
    target_storage.save_runtime_settings(runtime_settings)
    return runtime_settings


@router.post(
    "/respond",
    response_model=LocalPlayResponse,
    operation_id="respondLocalPlayTurn",
    summary="Generate the next GM response using the stored campaign bundle and selected model provider.",
)
def respond_play_turn(request: LocalPlayRequest) -> LocalPlayResponse:
    try:
        return generate_local_play_response(request, storage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/review",
    response_model=SessionReviewResponse,
    operation_id="reviewLocalPlaySession",
    summary="Review a saved play session against its transcript and artifacts for continuity issues.",
)
def review_play_session(request: SessionReviewRequest) -> SessionReviewResponse:
    try:
        return generate_session_review(request, storage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/memory/index",
    response_model=TranscriptMemoryIndexResponse,
    operation_id="buildTranscriptMemoryIndex",
    summary="Build or refresh transcript memory sections for a saved session.",
)
def build_play_memory_index(request: TranscriptMemoryBuildRequest) -> TranscriptMemoryIndexResponse:
    try:
        return build_transcript_memory_index(request, storage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/memory/search",
    response_model=TranscriptMemorySearchResponse,
    operation_id="searchTranscriptMemory",
    summary="Search transcript memory sections across campaigns and saved sessions.",
)
def search_play_memory(request: TranscriptMemorySearchRequest) -> TranscriptMemorySearchResponse:
    try:
        return search_transcript_memory(request, storage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
