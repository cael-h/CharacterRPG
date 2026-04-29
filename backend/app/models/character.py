from pydantic import BaseModel, Field


class CharacterProfile(BaseModel):
    name: str
    role: str
    public_summary: str
    goals: list[str] = Field(default_factory=list)
    traits: list[str] = Field(default_factory=list)
