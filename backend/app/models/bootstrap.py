from pydantic import BaseModel, Field

from backend.app.models.character import CharacterProfile
from backend.app.models.faction import FactionState
from backend.app.models.quest import QuestState
from backend.app.models.scenario import ScenarioState
from backend.app.models.story import StoryThread
from backend.app.models.world_state import WorldState


class PlayerCharacterInput(BaseModel):
    name: str | None = None
    concept: str | None = None
    goals: list[str] = Field(default_factory=list)
    edges: list[str] = Field(default_factory=list)
    complications: list[str] = Field(default_factory=list)


class CampaignBootstrapRequest(BaseModel):
    story_name: str | None = None
    preset_name: str | None = None
    setting: str | None = None
    genre_vibe: str | None = None
    tone: str | None = None
    themes: list[str] = Field(default_factory=list)
    context_summary: str | None = None
    play_preferences: list[str] = Field(default_factory=list)
    lore_text: str | None = None
    lore_paths: list[str] = Field(default_factory=list)
    allow_inference: bool = True
    player_character: PlayerCharacterInput = Field(default_factory=PlayerCharacterInput)


class CampaignBundle(BaseModel):
    world_state: WorldState
    scenario: ScenarioState
    factions: list[FactionState] = Field(default_factory=list)
    event_queue: list[str] = Field(default_factory=list)
    relationship_graph: dict[str, dict[str, str]] = Field(default_factory=dict)
    rpg_characters: list[CharacterProfile] = Field(default_factory=list)
    quests: list[QuestState] = Field(default_factory=list)
    story_threads: list[StoryThread] = Field(default_factory=list)
    timeline: list[str] = Field(default_factory=list)
    recap: str = ""


class CampaignBootstrapSummary(BaseModel):
    title: str
    premise: str
    opening_hook: str
    starter_quests: list[str] = Field(default_factory=list)
    inferred_fields: list[str] = Field(default_factory=list)
    lore_sources: list[str] = Field(default_factory=list)


class CampaignBootstrapResponse(BaseModel):
    campaign_id: str
    summary: CampaignBootstrapSummary
    files_written: list[str] = Field(default_factory=list)
