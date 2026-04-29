from pydantic import BaseModel, Field


class ScenarioState(BaseModel):
    title: str
    premise: str
    setting: str
    genre_vibe: str
    tone: str
    themes: list[str] = Field(default_factory=list)
    play_preferences: list[str] = Field(default_factory=list)
    preset_name: str | None = None
    context_summary: str | None = None
    inferred_fields: list[str] = Field(default_factory=list)
    opening_hook: str
