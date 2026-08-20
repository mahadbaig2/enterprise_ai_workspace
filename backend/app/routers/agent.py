from fastapi import APIRouter, Depends, HTTPException

from app.agents.workspace_graph import run_workspace_graph
from app.middleware.auth import get_current_user
from app.models.agent import AgentChatRequest, AgentChatResponse
from app.models.auth import CurrentUser
from app.utils.supabase_client import get_admin_client

router = APIRouter()


def _workspace_id(user: CurrentUser) -> str:
    result = get_admin_client().table("workspaces").select("id").eq("owner_id", user.id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="No workspace found for this user.")
    return str(result.data[0]["id"])


@router.post("/chat", response_model=AgentChatResponse)
def agent_chat(payload: AgentChatRequest, user: CurrentUser = Depends(get_current_user)) -> AgentChatResponse:
    result = run_workspace_graph(
        payload.prompt,
        _workspace_id(user),
        payload.context,
        payload.confirmation,
    )
    return AgentChatResponse(**result)
