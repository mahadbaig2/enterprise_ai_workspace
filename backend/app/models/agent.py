from typing import Any

from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    prompt: str
    context: str = ""
    confirmation: dict[str, Any] | None = None


class AgentChatResponse(BaseModel):
    routing: dict[str, str]
    content: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    tasks: list[dict[str, Any]] = Field(default_factory=list)
    retrievalStatus: str = "ok"
