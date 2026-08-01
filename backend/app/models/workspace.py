from datetime import datetime
from pydantic import BaseModel


class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    slug: str
    owner_id: str
    created_at: datetime
