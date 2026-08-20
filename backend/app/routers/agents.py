from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agents.graph import run_agent_graph
from app.agents.jira_tools import workspace_id_for_user
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser

router = APIRouter()


class AgentChatRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    context: str = Field(default="", max_length=12000)
    confirmation: dict[str, Any] | None = None


@router.post("/chat")
def agent_chat(payload: AgentChatRequest, user: CurrentUser = Depends(get_current_user)) -> dict[str, Any]:
    workspace_id = workspace_id_for_user(user.id)
    state = run_agent_graph(payload.prompt, workspace_id, payload.confirmation, payload.context)
    return {
        "content": state.get("answer", ""),
        "routing": {"intent": state.get("intent", "WORKSPACE_QUERY"), "targetAgent": state.get("route", "general")},
        "citations": state.get("citations", []),
        "tasks": state.get("tasks", []),
        "retrievalStatus": state.get("retrieval_status"),
        "requiresConfirmation": state.get("requires_confirmation", False),
        "proposal": state.get("proposal"),
    }
