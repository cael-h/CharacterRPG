from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.services.rag_engine import query_rag


router = APIRouter(tags=["retrieval"])


class RagQueryRequest(BaseModel):
    query: str


class RagQueryResponse(BaseModel):
    result: str


@router.post("/drive-rag-query", response_model=RagQueryResponse)
def drive_rag_query(request: RagQueryRequest) -> RagQueryResponse:
    try:
        return RagQueryResponse(result=query_rag(request.query))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
