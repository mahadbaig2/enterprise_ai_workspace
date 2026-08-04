from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OnboardingResponse(BaseModel):
    id: str
    workspace_id: str
    current_step: int
    completed: bool
    completed_at: Optional[datetime] = None


class OnboardingUpdateRequest(BaseModel):
    current_step: Optional[int] = None
    completed: Optional[bool] = None
