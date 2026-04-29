from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SessionReviewRequest(BaseModel):
    campaign_id: str | None = None
    session_id: str | None = None
    transcript_turns: int = Field(default=20, ge=1, le=200)
    focus_areas: list[str] = Field(default_factory=lambda: [
        "world_state",
        "location",
        "timeline",
        "recap",
        "relationships",
    ])
    user_note: str | None = None
    provider: str | None = None
    model: str | None = None
    provider_api_key: str | None = None
    provider_base_url: str | None = None


class SessionReviewFinding(BaseModel):
    severity: Literal["info", "warning", "critical"]
    artifact: str
    issue: str
    evidence: list[str] = Field(default_factory=list)
    suggested_update: str | None = None


class SessionReviewResponse(BaseModel):
    campaign_id: str = "root"
    session_id: str
    focus_areas: list[str] = Field(default_factory=list)
    assistant_summary: str
    findings: list[SessionReviewFinding] = Field(default_factory=list)
    transcript_entries_analyzed: int = Field(ge=0)
    timeline_entries_analyzed: int = Field(ge=0)
