from fastapi import APIRouter, Depends, HTTPException, status
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.workspace import WorkspaceCreate, WorkspaceResponse
from app.utils.slugify import generate_slug
from app.utils.supabase_client import get_admin_client

router = APIRouter()


def _row_to_response(row: dict) -> WorkspaceResponse:
    """Convert a raw Supabase workspace row to WorkspaceResponse."""
    return WorkspaceResponse(
        id=str(row["id"]),
        name=row["name"],
        slug=generate_slug(row["name"]),
        owner_id=str(row["owner_id"]),
        created_at=row["created_at"],
    )


@router.post("", response_model=WorkspaceResponse, status_code=201)
def create_workspace(
    payload: WorkspaceCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkspaceResponse:
    """
    Creates a new workspace for the authenticated user.
    Returns 409 if the user already owns a workspace.
    """
    db = get_admin_client()

    # Check for an existing workspace first to return a clean 409
    existing = (
        db.table("workspaces")
        .select("id")
        .eq("owner_id", current_user.id)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Workspace already exists",
        )

    insert_data = {
        "name": payload.name,
        "company_name": payload.name,  # MVP: company_name mirrors name
        "owner_id": current_user.id,
    }

    try:
        # Ensure the profile exists before creating the workspace. 
        # In a full production app, this might be handled by a Supabase Postgres trigger on auth.users,
        # but handling it here ensures robustness.
        db.table("profiles").upsert({
            "id": current_user.id,
            "email": current_user.email,
        }).execute()
        
        result = db.table("workspaces").insert(insert_data).execute()
    except Exception as exc:
        # Catch any DB-level unique constraint violation as a safety net
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workspace already exists",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {exc}",
        )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Insert succeeded but returned no data.",
        )

    return _row_to_response(result.data[0])


@router.get("", response_model=WorkspaceResponse)
def get_workspace(
    current_user: CurrentUser = Depends(get_current_user),
) -> WorkspaceResponse:
    """
    Returns the workspace owned by the authenticated user.
    Returns 404 if no workspace exists yet.
    """
    db = get_admin_client()

    result = (
        db.table("workspaces")
        .select("*")
        .eq("owner_id", current_user.id)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No workspace found for this user.",
        )

    return _row_to_response(result.data[0])
