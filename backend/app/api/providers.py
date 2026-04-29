from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import settings
from backend.app.services.model_providers import (
    ModelMessage,
    ModelProviderError,
    ModelRequest,
    generate_model_text,
)


router = APIRouter(prefix="/providers", tags=["providers"])


class ProviderDescriptor(BaseModel):
    provider: str
    default_model: str
    configured: bool
    notes: str


class ProvidersResponse(BaseModel):
    default_provider: str
    default_model: str
    providers: list[ProviderDescriptor]


class ProviderTestRequest(BaseModel):
    provider: str = Field(default="mock")
    model: str | None = None
    provider_api_key: str | None = None
    provider_base_url: str | None = None
    prompt: str = Field(default="Reply with one short sentence confirming the provider works.")


class ProviderTestResponse(BaseModel):
    provider: str
    model: str
    reply: str


@router.get(
    "",
    response_model=ProvidersResponse,
    operation_id="listModelProviders",
    summary="List configured model providers.",
)
def list_providers() -> ProvidersResponse:
    providers = [
        ProviderDescriptor(
            provider="mock",
            default_model="mock-rpg-model",
            configured=True,
            notes="Deterministic local fallback for development and tests.",
        ),
        ProviderDescriptor(
            provider="openai_responses",
            default_model=settings.default_model,
            configured=bool(settings.openai_api_key),
            notes="Direct OpenAI Responses API adapter.",
        ),
        ProviderDescriptor(
            provider="openai_compatible",
            default_model=settings.default_model,
            configured=bool(settings.openai_compatible_base_url and (settings.openai_compatible_api_key or settings.openai_api_key)),
            notes="Configurable /chat/completions adapter for compatible APIs such as Venice.",
        ),
        ProviderDescriptor(
            provider="ollama",
            default_model=settings.ollama_model,
            configured=True,
            notes=f"Local Ollama adapter at {settings.ollama_base_url}.",
        ),
        ProviderDescriptor(
            provider="huggingface",
            default_model=settings.default_model,
            configured=bool(settings.huggingface_api_key and settings.huggingface_base_url),
            notes="Hugging Face inference endpoint adapter.",
        ),
    ]
    return ProvidersResponse(
        default_provider=settings.default_provider,
        default_model=settings.default_model,
        providers=providers,
    )


@router.post(
    "/test",
    response_model=ProviderTestResponse,
    operation_id="testModelProvider",
    summary="Send a tiny request through a model provider.",
)
def test_provider(request: ProviderTestRequest) -> ProviderTestResponse:
    try:
        response = generate_model_text(
            ModelRequest(
                provider=request.provider,
                model=request.model,
                api_key=request.provider_api_key,
                base_url=request.provider_base_url,
                instructions="You are a concise provider health-check assistant.",
                messages=[ModelMessage(role="user", content=request.prompt)],
            )
        )
    except ModelProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ProviderTestResponse(
        provider=response.provider,
        model=response.model,
        reply=response.text,
    )
