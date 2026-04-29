from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.app.config import settings
from backend.app.models.api import PathStatusResponse
from backend.app.models.bootstrap import CampaignBootstrapRequest, CampaignBootstrapResponse, CampaignBundle
from backend.app.models.world_state import WorldState
from backend.app.services.campaign_bootstrap import create_campaign_bootstrap
from backend.app.services.campaign_storage import CampaignStorage


router = APIRouter(prefix="/campaign", tags=["campaign"])
storage = CampaignStorage(settings.campaign_storage_dir)


class TimelineEntryRequest(BaseModel):
    entry: str


class RecapRequest(BaseModel):
    recap: str



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
    "/state",
    response_model=WorldState,
    operation_id="getCampaignState",
    summary="Get the current campaign world state.",
)
def get_world_state(
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> WorldState:
    return _resolve_storage(session_id, campaign_id).load_world_state()


@router.get(
    "/bundle",
    response_model=CampaignBundle,
    operation_id="getCampaignBundle",
    summary="Get the full campaign bundle.",
)
def get_campaign_bundle(
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> CampaignBundle:
    return _resolve_storage(session_id, campaign_id).load_bundle()


@router.post(
    "/bootstrap",
    response_model=CampaignBootstrapResponse,
    operation_id="bootstrapCampaign",
    summary="Create the initial campaign bundle from intake data.",
)
def bootstrap_campaign(request: CampaignBootstrapRequest) -> CampaignBootstrapResponse:
    try:
        return create_campaign_bootstrap(request, storage)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/state",
    response_model=WorldState,
    operation_id="saveCampaignState",
    summary="Replace the current campaign world state.",
)
def save_world_state(
    state: WorldState,
    target_campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> WorldState:
    if session_id:
        effective_campaign_id = target_campaign_id
        if effective_campaign_id is None and state.campaign_id and storage.campaign_exists(state.campaign_id):
            effective_campaign_id = state.campaign_id
        target_storage = _resolve_storage(session_id, effective_campaign_id)
    elif target_campaign_id:
        target_storage = _resolve_storage(None, target_campaign_id)
    elif state.campaign_id and storage.campaign_exists(state.campaign_id):
        target_storage = _resolve_storage(None, state.campaign_id)
    else:
        target_storage = storage
    target_storage.save_world_state(state)
    return state


@router.post(
    "/timeline",
    response_model=PathStatusResponse,
    operation_id="appendCampaignTimeline",
    summary="Append a timeline entry.",
)
def append_timeline(
    request: TimelineEntryRequest,
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> PathStatusResponse:
    path = _resolve_storage(session_id, campaign_id).append_timeline(request.entry)
    return PathStatusResponse(status="ok", path=str(path))


@router.post(
    "/recap",
    response_model=PathStatusResponse,
    operation_id="updateCampaignRecap",
    summary="Replace the current campaign recap.",
)
def update_recap(
    request: RecapRequest,
    campaign_id: str | None = Query(default=None),
    session_id: str | None = Query(default=None),
) -> PathStatusResponse:
    path = _resolve_storage(session_id, campaign_id).update_recap(request.recap)
    return PathStatusResponse(status="ok", path=str(path))
