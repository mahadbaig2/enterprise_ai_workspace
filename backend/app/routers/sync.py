from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status

from app.lib.composio import composio_client
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.sync import SyncProviderResult, SyncResponse
from app.utils.supabase_client import get_admin_client

router = APIRouter()

SYNC_PROVIDERS = ("google_drive", "notion", "jira")


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


def _proxy_data(response: Any) -> Any:
    if isinstance(response, dict):
        return response.get("data", response)
    return getattr(response, "data", response)


def _headers(*headers: tuple[str, str]) -> list[dict[str, str]]:
    return [
        {"name": name, "value": value, "type": "header"}
        for name, value in headers
    ]


def _get_connected_account_id(workspace_id: str, provider: str) -> str:
    db = get_admin_client()
    result = (
        db.table("integrations")
        .select("status,composio_connection_id")
        .eq("workspace_id", workspace_id)
        .eq("provider", provider)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{provider} integration was not found.",
        )

    row = result.data[0]
    connected_account_id = row.get("composio_connection_id")
    if row.get("status") != "connected" or not connected_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{provider} is not connected.",
        )

    return connected_account_id


def _start_sync_run(workspace_id: str, provider: str) -> str:
    db = get_admin_client()
    result = (
        db.table("sync_runs")
        .insert(
            {
                "workspace_id": workspace_id,
                "provider": provider,
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .execute()
    )
    return str(result.data[0]["id"])


def _finish_sync_run(
    run_id: str,
    *,
    status_value: str,
    retrieved_count: int = 0,
    stored_count: int = 0,
    error_message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db = get_admin_client()
    db.table("sync_runs").update(
        {
            "status": status_value,
            "retrieved_count": retrieved_count,
            "stored_count": stored_count,
            "error_message": error_message,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata or {},
        }
    ).eq("id", run_id).execute()


def _upsert_documents(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0

    db = get_admin_client()
    result = db.table("documents").upsert(
        rows,
        on_conflict="workspace_id,source,external_id",
    ).execute()
    return len(result.data or rows)


def _plain_text_from_rich_text(items: list[dict[str, Any]]) -> str:
    return "".join(
        item.get("plain_text", "")
        for item in items
        if isinstance(item, dict)
    ).strip()


def _notion_title(page: dict[str, Any]) -> str:
    for prop in page.get("properties", {}).values():
        title_items = prop.get("title") if isinstance(prop, dict) else None
        if title_items:
            title = _plain_text_from_rich_text(title_items)
            if title:
                return title
    return page.get("id", "Untitled Notion page")


def _notion_block_text(block: dict[str, Any]) -> str | None:
    block_type = block.get("type")
    block_data = block.get(block_type, {}) if block_type else {}
    if not isinstance(block_data, dict):
        return None

    text = _plain_text_from_rich_text(block_data.get("rich_text", []))
    if text:
        return text

    if block_type == "to_do":
        checked = "x" if block_data.get("checked") else " "
        return f"[{checked}] {_plain_text_from_rich_text(block_data.get('rich_text', []))}"

    return None


def _sync_notion(workspace_id: str, connected_account_id: str) -> SyncProviderResult:
    search_response = composio_client.proxy_request(
        endpoint="/v1/search",
        method="POST",
        connected_account_id=connected_account_id,
        body={"filter": {"property": "object", "value": "page"}, "page_size": 10},
        parameters=_headers(
            ("Notion-Version", "2022-06-28"),
            ("Content-Type", "application/json"),
        ),
    )
    search_data = _proxy_data(search_response)
    pages = search_data.get("results", []) if isinstance(search_data, dict) else []

    documents: list[dict[str, Any]] = []
    for page in pages:
        page_id = page.get("id")
        if not page_id:
            continue

        blocks_response = composio_client.proxy_request(
            endpoint=f"/v1/blocks/{page_id}/children?page_size=50",
            method="GET",
            connected_account_id=connected_account_id,
            parameters=_headers(("Notion-Version", "2022-06-28")),
        )
        blocks_data = _proxy_data(blocks_response)
        blocks = blocks_data.get("results", []) if isinstance(blocks_data, dict) else []
        content_parts = [text for block in blocks if (text := _notion_block_text(block))]
        title = _notion_title(page)
        content = "\n".join(content_parts).strip() or title

        documents.append(
            {
                "workspace_id": workspace_id,
                "source": "notion",
                "external_id": page_id,
                "title": title,
                "content": content,
                "url": page.get("url"),
                "metadata": {"object": page.get("object"), "block_count": len(blocks)},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    stored = _upsert_documents(documents)
    return SyncProviderResult(
        provider="notion",
        status="success",
        retrieved_count=len(pages),
        stored_count=stored,
        message=f"Synchronized {stored} Notion pages.",
    )


def _google_file_text(file: dict[str, Any], connected_account_id: str) -> str:
    file_id = file.get("id")
    mime_type = file.get("mimeType", "")
    name = file.get("name", "Untitled file")

    if not file_id:
        return name

    try:
        if mime_type == "application/vnd.google-apps.document":
            response = composio_client.proxy_request(
                endpoint=f"/drive/v3/files/{file_id}/export?mimeType=text/plain",
                method="GET",
                connected_account_id=connected_account_id,
            )
        elif mime_type.startswith("text/"):
            response = composio_client.proxy_request(
                endpoint=f"/drive/v3/files/{file_id}?alt=media",
                method="GET",
                connected_account_id=connected_account_id,
            )
        else:
            return f"{name}\nGoogle Drive file metadata only. MIME type: {mime_type}"
    except HTTPException:
        return f"{name}\nGoogle Drive file metadata only. MIME type: {mime_type}"

    data = _proxy_data(response)
    if isinstance(data, str):
        return data.strip() or name
    if isinstance(data, dict):
        return str(data.get("text") or data.get("content") or data)[:20000]
    return str(data)[:20000]


def _sync_google_drive(workspace_id: str, connected_account_id: str) -> SyncProviderResult:
    list_response = composio_client.proxy_request(
        endpoint=(
            "/drive/v3/files?pageSize=10&fields=files(id,name,mimeType,webViewLink,modifiedTime)"
            "&q=trashed=false"
        ),
        method="GET",
        connected_account_id=connected_account_id,
    )
    list_data = _proxy_data(list_response)
    files = list_data.get("files", []) if isinstance(list_data, dict) else []

    documents = []
    for file in files:
        file_id = file.get("id")
        if not file_id:
            continue
        documents.append(
            {
                "workspace_id": workspace_id,
                "source": "google_drive",
                "external_id": file_id,
                "title": file.get("name") or "Untitled Google Drive file",
                "content": _google_file_text(file, connected_account_id),
                "url": file.get("webViewLink"),
                "metadata": {
                    "mime_type": file.get("mimeType"),
                    "modified_time": file.get("modifiedTime"),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    stored = _upsert_documents(documents)
    return SyncProviderResult(
        provider="google_drive",
        status="success",
        retrieved_count=len(files),
        stored_count=stored,
        message=f"Synchronized {stored} Google Drive files.",
    )


def _sync_jira(workspace_id: str, connected_account_id: str) -> SyncProviderResult:
    profile_response = composio_client.proxy_request(
        endpoint="/rest/api/3/myself",
        method="GET",
        connected_account_id=connected_account_id,
        parameters=_headers(("Accept", "application/json")),
    )
    profile = _proxy_data(profile_response)

    issues_response = composio_client.proxy_request(
        endpoint="/rest/api/3/search",
        method="POST",
        connected_account_id=connected_account_id,
        body={
            "jql": "assignee = currentUser() ORDER BY updated DESC",
            "maxResults": 10,
            "fields": ["summary", "status", "priority", "assignee", "updated", "description"],
        },
        parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")),
    )
    issue_data = _proxy_data(issues_response)
    issues = issue_data.get("issues", []) if isinstance(issue_data, dict) else []

    rows = []
    for issue in issues:
        fields = issue.get("fields", {})
        key = issue.get("key")
        if not key:
            continue
        rows.append(
            {
                "workspace_id": workspace_id,
                "issue_key": key,
                "summary": fields.get("summary") or key,
                "status": (fields.get("status") or {}).get("name"),
                "priority": (fields.get("priority") or {}).get("name"),
                "assignee_email": (fields.get("assignee") or {}).get("emailAddress"),
                "url": issue.get("self"),
                "metadata": {"profile": profile if isinstance(profile, dict) else {}, "fields": fields},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    stored = 0
    if rows:
        db = get_admin_client()
        result = db.table("jira_issues").upsert(
            rows,
            on_conflict="workspace_id,issue_key",
        ).execute()
        stored = len(result.data or rows)

    return SyncProviderResult(
        provider="jira",
        status="success",
        retrieved_count=len(issues),
        stored_count=stored,
        message=f"Synchronized {stored} Jira issues.",
    )


SYNC_HANDLERS: dict[str, Callable[[str, str], SyncProviderResult]] = {
    "google_drive": _sync_google_drive,
    "notion": _sync_notion,
    "jira": _sync_jira,
}


def _sync_provider(workspace_id: str, provider: str) -> SyncProviderResult:
    if provider not in SYNC_HANDLERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync provider not found.",
        )

    connected_account_id = _get_connected_account_id(workspace_id, provider)
    run_id = _start_sync_run(workspace_id, provider)

    try:
        result = SYNC_HANDLERS[provider](workspace_id, connected_account_id)
        _finish_sync_run(
            run_id,
            status_value="success",
            retrieved_count=result.retrieved_count,
            stored_count=result.stored_count,
        )
        return result
    except Exception as exc:
        _finish_sync_run(
            run_id,
            status_value="error",
            error_message=str(exc),
        )
        raise


@router.post("", response_model=SyncResponse)
def sync_all(current_user: CurrentUser = Depends(get_current_user)) -> SyncResponse:
    workspace_id = _resolve_workspace_id(current_user)
    results = [_sync_provider(workspace_id, provider) for provider in SYNC_PROVIDERS]
    return SyncResponse(workspace_id=workspace_id, status="success", results=results)


@router.post("/{provider}", response_model=SyncProviderResult)
def sync_one(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> SyncProviderResult:
    workspace_id = _resolve_workspace_id(current_user)
    return _sync_provider(workspace_id, provider)
