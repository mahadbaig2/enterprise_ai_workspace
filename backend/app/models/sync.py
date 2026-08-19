from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class SyncProviderResult(BaseModel):
    provider: str
    status: str
    retrieved_count: int
    stored_count: int
    indexed_count: int = 0
    error_message: Optional[str] = None
    message: str


class SyncRunResponse(BaseModel):
    id: str
    workspace_id: str
    provider: str
    status: str
    retrieved_count: int
    stored_count: int
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    metadata: dict[str, Any]


class SyncResponse(BaseModel):
    workspace_id: str
    status: str
    results: list[SyncProviderResult]
