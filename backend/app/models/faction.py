from pydantic import BaseModel, Field


class FactionState(BaseModel):
    name: str
    goal: str
    tension: int = Field(default=0, ge=0, le=10)
    next_action: str = "Observe the situation."
    last_outcome: str | None = None
