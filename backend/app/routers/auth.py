from fastapi import APIRouter, Depends
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser

router = APIRouter()


@router.get("/me", response_model=CurrentUser)
def get_me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """
    Returns the currently authenticated user's profile.
    Requires a valid Supabase JWT in the Authorization: Bearer header.
    """
    return current_user
