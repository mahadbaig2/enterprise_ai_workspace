from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.utils.supabase_client import get_admin_client

router = APIRouter()


class MemoryInput(BaseModel):
    workspace_id: str
    memory_key: str = Field(min_length=1, max_length=120)
    memory_value: str = Field(min_length=1, max_length=2000)


def _owned_workspace(user: CurrentUser, workspace_id: str) -> str:
    row = get_admin_client().table("workspaces").select("id").eq("id", workspace_id).eq("owner_id", user.id).limit(1).execute()
    if not row.data:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return workspace_id


@router.get("")
def list_memory(workspace_id: str, user: CurrentUser = Depends(get_current_user)):
    workspace_id = _owned_workspace(user, workspace_id)
    result = get_admin_client().table("workspace_memory").select("id,memory_key,memory_value,approved,created_at,updated_at").eq("workspace_id", workspace_id).eq("user_id", user.id).eq("approved", True).order("updated_at", desc=True).execute()
    return {"memory": result.data or []}


@router.post("")
def save_memory(payload: MemoryInput, user: CurrentUser = Depends(get_current_user)):
    workspace_id = _owned_workspace(user, payload.workspace_id)
    result = get_admin_client().table("workspace_memory").upsert({"workspace_id": workspace_id, "user_id": user.id, "memory_key": payload.memory_key.strip(), "memory_value": payload.memory_value.strip(), "approved": True}, on_conflict="workspace_id,user_id,memory_key").execute()
    return {"memory": (result.data or [None])[0]}


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, workspace_id: str, user: CurrentUser = Depends(get_current_user)):
    workspace_id = _owned_workspace(user, workspace_id)
    get_admin_client().table("workspace_memory").delete().eq("id", memory_id).eq("workspace_id", workspace_id).eq("user_id", user.id).execute()
    return {"ok": True}
