from pydantic import BaseModel, Field


class StoryThread(BaseModel):
    thread_id: str
    type: str = "story"
    title: str
    status: str = "active"
    tension: int = Field(default=1, ge=0, le=10)
    summary: str
    current_beat: str
    next_beat: str
    unresolved_question: str | None = None
    created_turn: int = 0
    last_advanced_turn: int = 0
