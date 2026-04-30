from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from backend.app.models.bootstrap import (
    CampaignBootstrapRequest,
    CampaignBootstrapSummary,
    CampaignBundle,
)


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


class CampaignSetupReviewRequest(BaseModel):
    draft: CampaignBootstrapRequest = Field(default_factory=CampaignBootstrapRequest)


class CampaignSetupReviewFinding(BaseModel):
    severity: Literal["info", "warning", "critical"]
    field: str
    message: str


class CampaignSetupReviewResponse(BaseModel):
    ready_to_bootstrap: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    campaign_id: str | None = None
    summary: CampaignBootstrapSummary | None = None
    preview: CampaignBundle | None = None
    findings: list[CampaignSetupReviewFinding] = Field(default_factory=list)
    lore_sources: list[str] = Field(default_factory=list)
