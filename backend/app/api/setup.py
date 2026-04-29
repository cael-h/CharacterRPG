from fastapi import APIRouter, HTTPException

from backend.app.models.setup import CampaignSetupRequest, CampaignSetupResponse
from backend.app.services.setup_assistant import generate_setup_response


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
