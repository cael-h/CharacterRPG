from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.app.model_utils import model_dump
from backend.app.services.test_runner import (
    FullSimulationResult,
    QuickTestResult,
    run_full_simulation,
    run_quick_tests,
)


router = APIRouter(prefix="/tests", tags=["tests"])


class FullSimulationRequest(BaseModel):
    turns: int = Field(default=20, ge=1, le=500)


@router.post(
    "/run_quick",
    response_model=QuickTestResult,
    operation_id="runQuickDiagnostics",
    summary="Run the deterministic quick diagnostics suite.",
)
def run_quick() -> dict[str, object]:
    result = run_quick_tests()
    return model_dump(result)


@router.post(
    "/run_full",
    response_model=FullSimulationResult,
    operation_id="runFullDiagnostics",
    summary="Run the deterministic full simulation diagnostics suite.",
)
def run_full(request: FullSimulationRequest) -> dict[str, object]:
    result = run_full_simulation(turns=request.turns)
    return model_dump(result)
