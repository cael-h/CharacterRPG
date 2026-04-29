from fastapi import FastAPI

from backend.app.api.campaign import router as campaign_router
from backend.app.api.play import router as play_router
from backend.app.api.providers import router as providers_router
from backend.app.api.retrieval import router as retrieval_router
from backend.app.api.setup import router as setup_router
from backend.app.api.tests import router as tests_router
from backend.app.config import settings
from backend.app.models.api import HealthResponse


settings.ensure_directories()

app = FastAPI(title="CharacterRPG Backend", version="0.1.0", root_path=settings.root_path)
app.include_router(retrieval_router)
app.include_router(setup_router)
app.include_router(campaign_router)
app.include_router(play_router)
app.include_router(providers_router)
app.include_router(tests_router)


@app.get(
    "/health",
    response_model=HealthResponse,
    operation_id="healthCheck",
    summary="Check backend health.",
)
def health() -> HealthResponse:
    return HealthResponse(status="ok")
