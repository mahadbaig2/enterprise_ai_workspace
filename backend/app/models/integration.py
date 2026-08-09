from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class IntegrationResponse(BaseModel):
    id: str
    workspace_id: str
    provider: str
    status: str
    connected_account_email: Optional[str] = None
    connected_at: Optional[datetime] = None
    error_message: Optional[str] = None


class ConnectIntegrationResponse(BaseModel):
    redirect_url: str
    provider: str


class NotionPreviewResponse(BaseModel):
    provider: str
    page_id: str
    page_title: str
    block_count: int
    preview: list[str]

