from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str


class PathStatusResponse(BaseModel):
    status: str
    path: str
