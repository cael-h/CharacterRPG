from __future__ import annotations

from pydantic import BaseModel, Field


class TranscriptMemoryBuildRequest(BaseModel):
    campaign_id: str | None = None
    session_id: str | None = None
    turns_per_section: int = Field(default=3, ge=1, le=20)
    refresh: bool = False
    use_model_metadata: bool = False
    provider: str | None = None
    model: str | None = None
    provider_api_key: str | None = None
    provider_base_url: str | None = None


class TranscriptMemorySection(BaseModel):
    campaign_id: str = "root"
    session_id: str
    section_id: str
    start_turn: int = Field(ge=0)
    end_turn: int = Field(ge=0)
    summary: str
    keywords: list[str] = Field(default_factory=list)
    named_entities: list[str] = Field(default_factory=list)
    relationship_tags: list[str] = Field(default_factory=list)
    scene_tags: list[str] = Field(default_factory=list)
    notable_moments: list[str] = Field(default_factory=list)
    excerpt: str
    transcript_entries: int = Field(ge=0)


class TranscriptMemoryIndexResponse(BaseModel):
    campaign_id: str = "root"
    session_id: str
    sections_indexed: int = Field(ge=0)
    transcript_entries_indexed: int = Field(ge=0)
    storage_path: str
    used_model_metadata: bool = False


class TranscriptMemorySearchRequest(BaseModel):
    query: str = Field(min_length=1)
    campaign_id: str | None = None
    session_id: str | None = None
    include_root: bool = True
    include_sessions: bool = True
    max_results: int = Field(default=8, ge=1, le=50)


class TranscriptMemorySearchHit(BaseModel):
    campaign_id: str = "root"
    session_id: str
    section_id: str
    score: float
    start_turn: int = Field(ge=0)
    end_turn: int = Field(ge=0)
    summary: str
    keywords: list[str] = Field(default_factory=list)
    relationship_tags: list[str] = Field(default_factory=list)
    scene_tags: list[str] = Field(default_factory=list)
    notable_moments: list[str] = Field(default_factory=list)
    excerpt: str
    matched_terms: list[str] = Field(default_factory=list)


class TranscriptMemorySearchResponse(BaseModel):
    query: str
    sessions_considered: list[str] = Field(default_factory=list)
    hits: list[TranscriptMemorySearchHit] = Field(default_factory=list)
