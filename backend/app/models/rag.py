from typing import Any, Literal

from pydantic import BaseModel, Field


RagSource = Literal["google_drive", "notion"]


class RagSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    match_count: int = Field(default=8, ge=1, le=20)
    sources: list[RagSource] | None = None
    metadata: dict[str, Any] | None = None


class RagCitation(BaseModel):
    id: str
    document_id: str
    title: str
    source: str
    url: str | None = None
    snippet: str
    chunk_index: int


class RagSearchResult(BaseModel):
    id: str
    document_id: str
    workspace_id: str
    source: str
    title: str
    content: str
    url: str | None = None
    chunk_index: int
    similarity: float
    fts_rank: float
    rerank_score: float
    metadata: dict[str, Any]


class RagSearchResponse(BaseModel):
    query: str
    results: list[RagSearchResult]
    citations: list[RagCitation]
    reranker: str


class RagIndexRequest(BaseModel):
    source: RagSource | None = None


class RagIndexResponse(BaseModel):
    workspace_id: str
    documents_indexed: int
    chunks_stored: int
    embeddings_stored: int
    embedding_provider: str
