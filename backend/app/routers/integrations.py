import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.lib.composio import composio_client
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.integration import ConnectIntegrationResponse, IntegrationResponse, NotionPreviewResponse
from app.utils.supabase_client import get_admin_client

router = APIRouter()

PROVIDER_TO_COMPOSIO_APP = {
    "google_drive": "GOOGLEDRIVE",
    "notion": "NOTION",
    "jira": "JIRA",
}

PROVIDER_ORDER = ["google_drive", "notion", "jira"]


def _validate_provider(provider: str) -> str:
    if provider not in PROVIDER_TO_COMPOSIO_APP:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration provider not found.",
        )
    return provider


def _get_composio_app(provider: str) -> Any:
    app_name = PROVIDER_TO_COMPOSIO_APP[_validate_provider(provider)]
    try:
        return composio_client.get_app(app_name)
    except AttributeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Composio SDK does not expose App.{app_name}.",
        )


def _row_to_response(row: dict) -> IntegrationResponse:
    return IntegrationResponse(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        provider=row["provider"],
        status=row["status"],
        connected_account_email=row.get("connected_account_email"),
        connected_at=row.get("connected_at"),
        error_message=row.get("error_message"),
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


def _ensure_integration_rows(workspace_id: str) -> None:
    db = get_admin_client()
    existing = (
        db.table("integrations")
        .select("provider")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    existing_providers = {row["provider"] for row in existing.data or []}
    missing = [
        {"workspace_id": workspace_id, "provider": provider, "status": "disconnected"}
        for provider in PROVIDER_ORDER
        if provider not in existing_providers
    ]

    if missing:
        db.table("integrations").insert(missing).execute()


def _get_integration_row(workspace_id: str, provider: str) -> dict:
    _validate_provider(provider)
    _ensure_integration_rows(workspace_id)
    db = get_admin_client()
    result = (
        db.table("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .eq("provider", provider)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integration provider not found.",
        )

    return result.data[0]


def _connection_attr(connection: Any, *names: str) -> Any:
    for name in names:
        if isinstance(connection, dict) and name in connection:
            return connection[name]
        if hasattr(connection, name):
            return getattr(connection, name)
    return None


def _is_connection_active(connection: Any) -> bool:
    status_value = _connection_attr(connection, "status", "state")
    if isinstance(status_value, str):
        return status_value.lower() in {"active", "connected", "enabled", "success"}

    enabled = _connection_attr(connection, "enabled", "is_active", "active")
    if isinstance(enabled, bool):
        return enabled

    return connection is not None


def _proxy_data(response: Any) -> Any:
    if isinstance(response, dict):
        return response.get("data", response)
    return getattr(response, "data", response)


def _notion_title(page: dict) -> str:
    properties = page.get("properties", {})
    for prop in properties.values():
        title_items = prop.get("title") if isinstance(prop, dict) else None
        if title_items:
            title = "".join(
                item.get("plain_text", "")
                for item in title_items
                if isinstance(item, dict)
            ).strip()
            if title:
                return title
    return page.get("id", "Untitled Notion page")


def _rich_text_plain_text(items: list[dict]) -> str:
    return "".join(
        item.get("plain_text", "")
        for item in items
        if isinstance(item, dict)
    ).strip()


def _notion_block_text(block: dict) -> str | None:
    block_type = block.get("type")
    block_data = block.get(block_type, {}) if block_type else {}
    if not isinstance(block_data, dict):
        return None

    text = _rich_text_plain_text(block_data.get("rich_text", []))
    if text:
        return text

    if block_type == "to_do":
        checked = "x" if block_data.get("checked") else " "
        return f"[{checked}] {_rich_text_plain_text(block_data.get('rich_text', []))}"

    return None


def _notion_headers() -> list[dict[str, str]]:
    return [
        {"name": "Notion-Version", "value": "2022-06-28", "type": "header"},
        {"name": "Content-Type", "value": "application/json", "type": "header"},
    ]


def _get_active_connection(
    workspace_id: str,
    provider: str,
    connection_id: str | None,
) -> Any:
    app = _get_composio_app(provider)
    try:
        return composio_client.get_connection(
            entity_id=str(workspace_id),
            app=app,
            connection_id=connection_id or "",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to verify {provider} connection: {exc}",
        )


@router.get("", response_model=list[IntegrationResponse])
def get_integrations(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[IntegrationResponse]:
    workspace_id = _resolve_workspace_id(current_user)
    _ensure_integration_rows(workspace_id)
    db = get_admin_client()

    result = (
        db.table("integrations")
        .select("*")
        .eq("workspace_id", workspace_id)
        .in_("provider", PROVIDER_ORDER)
        .execute()
    )
    rows_by_provider = {row["provider"]: row for row in result.data or []}

    return [
        _row_to_response(rows_by_provider[provider])
        for provider in PROVIDER_ORDER
        if provider in rows_by_provider
    ]


@router.get("/{provider}", response_model=IntegrationResponse)
def get_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> IntegrationResponse:
    workspace_id = _resolve_workspace_id(current_user)
    return _row_to_response(_get_integration_row(workspace_id, provider))


@router.post("/{provider}/connect", response_model=ConnectIntegrationResponse)
def connect_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> ConnectIntegrationResponse:
    workspace_id = _resolve_workspace_id(current_user)
    _get_integration_row(workspace_id, provider)

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    redirect_url = f"{frontend_url}/integrations/callback?provider={provider}"
    app = _get_composio_app(provider)

    try:
        connection_request = composio_client.initiate_connection(
            entity_id=str(workspace_id),
            app=app,
            redirect_url=redirect_url,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to initiate {provider} OAuth connection: {exc}",
        )

    oauth_url = _connection_attr(connection_request, "redirectUrl", "redirect_url")
    if not oauth_url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Composio did not return an OAuth redirect URL.",
        )

    return ConnectIntegrationResponse(redirect_url=oauth_url, provider=provider)


@router.get("/{provider}/callback", response_model=IntegrationResponse)
def integration_callback(
    provider: str,
    connection_id: str | None = Query(default=None),
    connected_account_id: str | None = Query(default=None, alias="connectedAccountId"),
    id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> IntegrationResponse:
    workspace_id = _resolve_workspace_id(current_user)
    _get_integration_row(workspace_id, provider)
    db = get_admin_client()
    resolved_connection_id = connection_id or connected_account_id or id

    try:
        connection = _get_active_connection(workspace_id, provider, resolved_connection_id)
    except HTTPException as exc:
        db.table("integrations").update(
            {
                "status": "error",
                "error_message": str(exc.detail),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("workspace_id", workspace_id).eq("provider", provider).execute()
        raise

    if connection and _is_connection_active(connection):
        composio_connection_id = (
            _connection_attr(connection, "id", "connection_id") or resolved_connection_id
        )
        account_email = _connection_attr(
            connection,
            "account_email",
            "connected_account_email",
            "email",
        )
        result = (
            db.table("integrations")
            .update(
                {
                    "status": "connected",
                    "composio_connection_id": composio_connection_id,
                    "connected_account_email": account_email,
                    "connected_at": datetime.now(timezone.utc).isoformat(),
                    "error_message": None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("workspace_id", workspace_id)
            .eq("provider", provider)
            .execute()
        )
        return _row_to_response(result.data[0])

    db.table("integrations").update(
        {
            "status": "error",
            "error_message": "Connection failed. Please try again.",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("workspace_id", workspace_id).eq("provider", provider).execute()

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Connection failed. Please try again.",
    )


@router.get("/notion/preview", response_model=NotionPreviewResponse)
def preview_notion_page(
    page_id: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> NotionPreviewResponse:
    workspace_id = _resolve_workspace_id(current_user)
    row = _get_integration_row(workspace_id, "notion")
    connected_account_id = row.get("composio_connection_id")

    if row.get("status") != "connected" or not connected_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Notion is not connected yet.",
        )

    selected_page_id = page_id
    page_title = page_id or "Selected Notion page"

    if not selected_page_id:
        search_response = composio_client.proxy_request(
            endpoint="/v1/search",
            method="POST",
            connected_account_id=connected_account_id,
            body={
                "filter": {"property": "object", "value": "page"},
                "page_size": 1,
            },
            parameters=_notion_headers(),
        )
        search_data = _proxy_data(search_response)
        results = search_data.get("results", []) if isinstance(search_data, dict) else []
        if not results:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notion connection works, but no accessible pages were returned.",
            )
        selected_page = results[0]
        selected_page_id = selected_page["id"]
        page_title = _notion_title(selected_page)

    blocks_response = composio_client.proxy_request(
        endpoint=f"/v1/blocks/{selected_page_id}/children?page_size=10",
        method="GET",
        connected_account_id=connected_account_id,
        parameters=_notion_headers(),
    )
    blocks_data = _proxy_data(blocks_response)
    blocks = blocks_data.get("results", []) if isinstance(blocks_data, dict) else []
    preview = [text for block in blocks if (text := _notion_block_text(block))]

    return NotionPreviewResponse(
        provider="notion",
        page_id=selected_page_id,
        page_title=page_title,
        block_count=len(blocks),
        preview=preview[:5],
    )


@router.post("/{provider}/test", response_model=IntegrationResponse)
def test_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> IntegrationResponse:
    workspace_id = _resolve_workspace_id(current_user)
    row = _get_integration_row(workspace_id, provider)

    if row.get("status") != "connected" or not row.get("composio_connection_id"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integration is not connected yet.",
        )

    connection = _get_active_connection(
        workspace_id,
        provider,
        row.get("composio_connection_id"),
    )

    if not _is_connection_active(connection):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Integration credentials are not active. Reconnect this provider.",
        )

    return _row_to_response(row)


@router.delete("/{provider}")
def disconnect_integration(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    workspace_id = _resolve_workspace_id(current_user)
    _get_integration_row(workspace_id, provider)
    db = get_admin_client()

    try:
        row = _get_integration_row(workspace_id, provider)
        composio_client.revoke_connection(
            entity_id=str(workspace_id),
            app=_get_composio_app(provider),
            connection_id=row.get("composio_connection_id"),
        )
    except Exception:
        pass

    db.table("integrations").update(
        {
            "status": "disconnected",
            "composio_connection_id": None,
            "connected_account_email": None,
            "connected_at": None,
            "error_message": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("workspace_id", workspace_id).eq("provider", provider).execute()

    return {"message": "Disconnected successfully"}
