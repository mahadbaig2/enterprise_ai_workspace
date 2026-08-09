from fastapi import APIRouter, Depends, HTTPException, status

from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.rag import RagIndexRequest, RagIndexResponse, RagSearchRequest, RagSearchResponse
from app.services.rag import index_workspace_documents, search_workspace
from app.utils.supabase_client import get_admin_client

router = APIRouter()


def _resolve_workspace_id(current_user: CurrentUser) -> str:
    result = get_admin_client().table("workspaces").select("id").eq("owner_id", current_user.id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No workspace found for this user.")
    return str(result.data[0]["id"])


@router.post("/index", response_model=RagIndexResponse)
def index_rag_documents(payload: RagIndexRequest, current_user: CurrentUser = Depends(get_current_user)) -> RagIndexResponse:
    return index_workspace_documents(_resolve_workspace_id(current_user), payload.source)


@router.post("/search", response_model=RagSearchResponse)
def search_rag_documents(payload: RagSearchRequest, current_user: CurrentUser = Depends(get_current_user)) -> RagSearchResponse:
    return search_workspace(_resolve_workspace_id(current_user), payload)
