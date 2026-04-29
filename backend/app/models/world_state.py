from pydantic import BaseModel, Field

from backend.app.models.faction import FactionState
from backend.app.models.quest import QuestState


def default_factions() -> list[FactionState]:
    return [
        FactionState(
            name="Cinder Court",
            goal="Expand influence through covert pacts.",
            next_action="Send envoys into the market district.",
        ),
        FactionState(
            name="Verdant Circle",
            goal="Protect the wild border from exploitation.",
            next_action="Watch the old roads for illegal logging.",
        ),
    ]


class WorldState(BaseModel):
    campaign_id: str = "default-campaign"
    turn: int = 0
    current_scene: str = "The campaign is ready to begin."
    location: str = "starting_region"
    time_of_day: str = "day"
    world_pressure: int = Field(default=1, ge=0, le=10)
    pressure_clock: int = Field(default=0, ge=0, le=6)
    factions: list[FactionState] = Field(default_factory=default_factions)
    active_quests: list[QuestState] = Field(default_factory=list)
    pending_events: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
