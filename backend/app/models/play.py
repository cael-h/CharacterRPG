from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PlayTranscriptEntry(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    turn: int = Field(ge=1)
    recorded_at: str


class LocalPlayRequest(BaseModel):
    user_message: str = Field(min_length=1)
    provider: str | None = None
    model: str | None = None
    provider_api_key: str | None = None
    provider_base_url: str | None = None
    max_history_turns: int = Field(default=6, ge=0, le=50)
    persist_transcript: bool = True
    campaign_id: str | None = None
    session_id: str | None = None
    create_session_if_missing: bool = True
    fork_from_session_id: str | None = None
    fork_from_turn: int | None = Field(default=None, ge=0)
    session_title: str | None = None
    include_choices: bool = False


class RuntimeSettings(BaseModel):
    provider: str | None = None
    model: str | None = None
    include_choices: bool = False
    mature_content_enabled: bool = True
    notes: str | None = None


class RuntimeSettingsRequest(RuntimeSettings):
    campaign_id: str | None = None
    session_id: str | None = None


class PlayStateUpdates(BaseModel):
    current_scene: str | None = None
    location: str | None = None
    time_of_day: str | None = None
    world_pressure: int | None = Field(default=None, ge=0, le=10)
    pressure_clock: int | None = Field(default=None, ge=0, le=6)
    notes_append: list[str] = Field(default_factory=list)


class PlayEventQueueUpdates(BaseModel):
    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)


class PlayQuestUpdate(BaseModel):
    quest_id: str | None = None
    title: str | None = None
    status: str | None = None
    summary: str | None = None
    source_faction: str | None = None


class StructuredPlayTurn(BaseModel):
    reply: str = Field(min_length=1)
    state_updates: PlayStateUpdates = Field(default_factory=PlayStateUpdates)
    timeline_entries: list[str] = Field(default_factory=list)
    recap_delta: str | None = None
    quest_updates: list[PlayQuestUpdate] = Field(default_factory=list)
    event_queue_updates: PlayEventQueueUpdates = Field(default_factory=PlayEventQueueUpdates)
    npc_memory_notes: list[str] = Field(default_factory=list)


class LocalPlayResponse(BaseModel):
    campaign_id: str
    session_id: str
    turn: int = Field(ge=0)
    provider: str
    model: str
    reply: str
    transcript_entries_appended: int = Field(ge=0)
    used_history_turns: int = Field(ge=0)


class PlayCampaignSummary(BaseModel):
    campaign_id: str
    title: str | None = None
    storage_dir: str
    session_count: int = Field(ge=0)
    created_at: str
    updated_at: str


class PlaySessionSummary(BaseModel):
    campaign_id: str = "root"
    session_id: str
    title: str | None = None
    parent_session_id: str | None = None
    fork_from_turn: int | None = None
    storage_dir: str
    turn: int = Field(ge=0)
    transcript_entries: int = Field(ge=0)
    created_at: str
    updated_at: str
