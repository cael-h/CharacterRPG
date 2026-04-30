from fastapi import APIRouter, HTTPException

from backend.app.models.setup import (
    CampaignSetupRequest,
    CampaignSetupResponse,
    CampaignSetupReviewRequest,
    CampaignSetupReviewResponse,
)
from backend.app.services.setup_assistant import generate_setup_response, review_setup_draft


router = APIRouter(prefix="/setup", tags=["setup"])


@router.post(
    "/respond",
    response_model=CampaignSetupResponse,
    operation_id="respondCampaignSetup",
    summary="Brainstorm or refine a campaign setup draft before bootstrapping.",
)
def respond_setup(request: CampaignSetupRequest) -> CampaignSetupResponse:
    try:
        return generate_setup_response(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post(
    "/review",
    response_model=CampaignSetupReviewResponse,
    operation_id="reviewCampaignSetupDraft",
    summary="Preview and validate a campaign setup draft before bootstrapping.",
)
def review_setup(request: CampaignSetupReviewRequest) -> CampaignSetupReviewResponse:
    return review_setup_draft(request)
