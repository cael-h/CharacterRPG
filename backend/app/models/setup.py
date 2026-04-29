from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from backend.app.models.bootstrap import CampaignBootstrapRequest


class SetupChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class CampaignSetupRequest(BaseModel):
    user_message: str = Field(min_length=1)
    conversation: list[SetupChatMessage] = Field(default_factory=list)
    draft: CampaignBootstrapRequest = Field(default_factory=CampaignBootstrapRequest)
    provider: str | None = None
    model: str | None = None
    provider_api_key: str | None = None
    provider_base_url: str | None = None


class CampaignSetupResponse(BaseModel):
    assistant_reply: str
    draft: CampaignBootstrapRequest
    ready_to_bootstrap: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    lore_sources: list[str] = Field(default_factory=list)
