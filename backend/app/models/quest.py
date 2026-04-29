from pydantic import BaseModel


class QuestState(BaseModel):
    quest_id: str
    title: str
    status: str = "open"
    summary: str
    source_faction: str
    created_turn: int
