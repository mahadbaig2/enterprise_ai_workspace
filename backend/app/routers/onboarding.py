from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from postgrest.exceptions import APIError

from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.onboarding import OnboardingResponse, OnboardingUpdateRequest
from app.utils.supabase_client import get_admin_client

router = APIRouter()


def _is_missing_onboarding_table(exc: APIError) -> bool:
    return "PGRST205" in str(exc) and "public.onboarding" in str(exc)


def _raise_missing_onboarding_table() -> None:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "The public.onboarding table is missing from Supabase. "
            "Apply the onboarding section from supabase/schema.sql and restart the API."
        ),
    )


def _row_to_response(row: dict) -> OnboardingResponse:
    return OnboardingResponse(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        current_step=row["current_step"],
        completed=row["completed"],
        completed_at=row.get("completed_at"),
    )


def _resolve_workspace_id(current_user: CurrentUser) -> str:
    db = get_admin_client()
    result = (
        db.table("workspaces")
        .select("id")
        .eq("owner_id", current_user.id)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No workspace found for this user.",
        )

    return str(result.data[0]["id"])


def _create_onboarding_row(workspace_id: str) -> OnboardingResponse:
    db = get_admin_client()
    try:
        result = (
            db.table("onboarding")
            .insert(
                {
                    "workspace_id": workspace_id,
                    "current_step": 1,
                    "completed": False,
                }
            )
            .execute()
        )
    except APIError as exc:
        if _is_missing_onboarding_table(exc):
            _raise_missing_onboarding_table()
        raise

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initialize onboarding for this workspace.",
        )

    return _row_to_response(result.data[0])


@router.get("", response_model=OnboardingResponse)
def get_onboarding(
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    workspace_id = _resolve_workspace_id(current_user)
    db = get_admin_client()

    try:
        result = (
            db.table("onboarding")
            .select("*")
            .eq("workspace_id", workspace_id)
            .limit(1)
            .execute()
        )
    except APIError as exc:
        if _is_missing_onboarding_table(exc):
            _raise_missing_onboarding_table()
        raise

    if not result.data:
        return _create_onboarding_row(workspace_id)

    return _row_to_response(result.data[0])


@router.patch("", response_model=OnboardingResponse)
def update_onboarding(
    payload: OnboardingUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingResponse:
    workspace_id = _resolve_workspace_id(current_user)
    db = get_admin_client()

    update_data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if payload.current_step is not None:
        update_data["current_step"] = payload.current_step

    if payload.completed is not None:
        update_data["completed"] = payload.completed
        if payload.completed:
            update_data["completed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            db.table("onboarding")
            .update(update_data)
            .eq("workspace_id", workspace_id)
            .execute()
        )
    except APIError as exc:
        if _is_missing_onboarding_table(exc):
            _raise_missing_onboarding_table()
        raise

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No onboarding row found for this workspace.",
        )

    return _row_to_response(result.data[0])
