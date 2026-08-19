from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, status

from app.lib.composio import composio_client
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.sync import SyncProviderResult, SyncResponse
from app.services.rag import index_workspace_documents
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
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in items if isinstance(item, dict)).strip()


def _notion_title(page: dict[str, Any]) -> str:
    direct_title = page.get("title")
    if isinstance(direct_title, list):
        title = _plain_text_from_rich_text(direct_title)
        if title:
            return title
    for prop in page.get("properties", {}).values():
        title_items = prop.get("title") if isinstance(prop, dict) else None
        if title_items:
            title = _plain_text_from_rich_text(title_items)
            if title:
                return title
    return page.get("id", "Untitled Notion page")


def _notion_property_text(value: dict[str, Any]) -> str:
    property_type = value.get("type")
    raw = value.get(property_type, []) if property_type else []
    if property_type in {"title", "rich_text"}:
        return _plain_text_from_rich_text(raw)
    if property_type in {"select", "status"}:
        return str((raw or {}).get("name", ""))
    if property_type == "multi_select":
        return ", ".join(item.get("name", "") for item in raw if isinstance(item, dict))
    if property_type == "people":
        return ", ".join(item.get("name") or item.get("email", "") for item in raw if isinstance(item, dict))
    if property_type == "date":
        return str((raw or {}).get("start", ""))
    if property_type == "checkbox":
        return "Yes" if raw else "No"
    if property_type in {"number", "url", "email", "phone_number", "formula", "relation"}:
        return str(raw or "")
    return str(raw or "") if raw else ""


def _notion_properties_text(page: dict[str, Any]) -> str:
    properties = page.get("properties") or {}
    lines = []
    for name, value in properties.items():
        if not isinstance(value, dict):
            continue
        text = _notion_property_text(value)
        if text and name.lower() not in {"title", "name"}:
            lines.append(f"{name}: {text}")
    return "\n".join(lines)


def _notion_block_text(block: dict[str, Any]) -> str | None:
    block_type = block.get("type")
    block_data = block.get(block_type, {}) if block_type else {}
    if not isinstance(block_data, dict):
        return None

    text = _plain_text_from_rich_text(block_data.get("rich_text", []))
    if text:
        return f"{block_type}: {text}" if block_type in {"heading_1", "heading_2", "heading_3", "callout", "quote"} else text

    if block_type == "to_do":
        checked = "x" if block_data.get("checked") else " "
        return f"[{checked}] {_plain_text_from_rich_text(block_data.get('rich_text', []))}"

    return None


def _notion_page_url(page: dict[str, Any]) -> str | None:
    return page.get("url") or page.get("public_url")


def _notion_page_id(page: dict[str, Any]) -> str | None:
    value = page.get("id")
    return str(value) if value else None


def _notion_page_document(
    workspace_id: str,
    page: dict[str, Any],
    content: str,
    *,
    parent_database: str | None = None,
) -> dict[str, Any] | None:
    page_id = _notion_page_id(page)
    if not page_id:
        return None
    title = _notion_title(page)
    properties = _notion_properties_text(page)
    parts = [part for part in (properties, content.strip() or title) if part]
    metadata: dict[str, Any] = {
        "object": page.get("object"),
        "block_count": page.get("_block_count", 0),
    }
    if parent_database:
        metadata["database"] = parent_database
    return {
        "workspace_id": workspace_id,
        "source": "notion",
        "external_id": page_id,
        "title": title,
        "content": "\n".join(parts),
        "url": _notion_page_url(page),
        "metadata": metadata,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _notion_block_lines(block: dict[str, Any], connected_account_id: str) -> list[str]:
    lines: list[str] = []
    if text := _notion_block_text(block):
        lines.append(text)
    if block.get("has_children") and block.get("id"):
        children = _notion_paginated(
            endpoint=f"/v1/blocks/{block['id']}/children",
            method="GET",
            connected_account_id=connected_account_id,
        )
        for child in children:
            lines.extend(_notion_block_lines(child, connected_account_id))
    return lines


def _notion_response_data(response: Any) -> dict[str, Any]:
    data = _proxy_data(response)
    return data if isinstance(data, dict) else {}


def _notion_paginated(
    *,
    endpoint: str,
    method: str,
    connected_account_id: str,
    body: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        request_body = dict(body or {})
        parameters: list[dict[str, str]] = []
        if method == "GET":
            separator = "&" if "?" in endpoint else "?"
            paged_endpoint = f"{endpoint}{separator}page_size=100"
            if cursor:
                paged_endpoint += f"&start_cursor={cursor}"
        else:
            request_body["page_size"] = 100
            if cursor:
                request_body["start_cursor"] = cursor
            paged_endpoint = endpoint
        response = composio_client.proxy_request(
            endpoint=paged_endpoint,
            method=method,
            connected_account_id=connected_account_id,
            body=request_body if method != "GET" else None,
            parameters=_headers(("Notion-Version", "2022-06-28"), ("Content-Type", "application/json")),
        )
        data = _notion_response_data(response)
        batch = data.get("results", [])
        results.extend(item for item in batch if isinstance(item, dict))
        if not data.get("has_more") or not data.get("next_cursor"):
            break
        cursor = str(data["next_cursor"])
    return results


def _notion_collect_page(
    workspace_id: str,
    connected_account_id: str,
    page: dict[str, Any],
    documents: list[dict[str, Any]],
    visited_pages: set[str],
    *,
    parent_database: str | None = None,
) -> None:
    page_id = _notion_page_id(page)
    if not page_id or page_id in visited_pages:
        return
    visited_pages.add(page_id)
    blocks = _notion_paginated(
        endpoint=f"/v1/blocks/{page_id}/children",
        method="GET",
        connected_account_id=connected_account_id,
    )
    lines: list[str] = []
    for block in blocks:
        lines.extend(_notion_block_lines(block, connected_account_id))
        if block.get("type") == "child_page" and block.get("id"):
            child_page_id = str(block["id"])
            child_page = {"id": child_page_id, "object": "page", "properties": {}, "url": None}
            try:
                child_page = _notion_response_data(composio_client.proxy_request(
                    endpoint=f"/v1/pages/{child_page_id}",
                    method="GET",
                    connected_account_id=connected_account_id,
                    parameters=_headers(("Notion-Version", "2022-06-28")),
                )) or child_page
            except Exception:
                pass
            _notion_collect_page(workspace_id, connected_account_id, child_page, documents, visited_pages, parent_database=parent_database)
    page["_block_count"] = len(blocks)
    document = _notion_page_document(workspace_id, page, "\n".join(lines), parent_database=parent_database)
    if document:
        documents.append(document)


def _sync_notion(workspace_id: str, connected_account_id: str) -> SyncProviderResult:
    objects = _notion_paginated(
        endpoint="/v1/search",
        method="POST",
        connected_account_id=connected_account_id,
        body={},
    )
    documents: list[dict[str, Any]] = []
    visited_pages: set[str] = set()
    databases = [item for item in objects if item.get("object") == "database"]
    pages = [item for item in objects if item.get("object") == "page"]
    for page in pages:
        _notion_collect_page(workspace_id, connected_account_id, page, documents, visited_pages)
    database_rows = 0
    for database in databases:
        database_id = _notion_page_id(database)
        if not database_id:
            continue
        database_title = _notion_title(database)
        rows = _notion_paginated(
            endpoint=f"/v1/databases/{database_id}/query",
            method="POST",
            connected_account_id=connected_account_id,
            body={},
        )
        database_rows += len(rows)
        for row in rows:
            _notion_collect_page(workspace_id, connected_account_id, row, documents, visited_pages, parent_database=database_title)

    stored = _upsert_documents(documents)
    db = get_admin_client()
    external_ids = [document["external_id"] for document in documents]
    stale_query = db.table("documents").delete().eq("workspace_id", workspace_id).eq("source", "notion")
    if external_ids:
        stale_query = stale_query.not_.in_("external_id", external_ids)
    stale_query.execute()
    return SyncProviderResult(
        provider="notion",
        status="success",
        retrieved_count=len(objects) + database_rows,
        stored_count=stored,
        message=f"Synchronized {stored} Notion documents from {len(pages)} pages, {len(databases)} databases, and {database_rows} database rows.",
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
    jira_base_url = ""
    if isinstance(profile, dict):
        jira_base_url = str(profile.get("self", "")).split("/rest/api/", 1)[0].rstrip("/")

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
    documents = []
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
                "url": f"{jira_base_url}/browse/{key}" if jira_base_url else issue.get("self"),
                "metadata": {"profile": profile if isinstance(profile, dict) else {}, "fields": fields},
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        documents.append(
            {
                "workspace_id": workspace_id,
                "source": "jira",
                "external_id": key,
                "title": f"{key}: {fields.get('summary') or key}",
                "content": "\n".join(filter(None, [
                    f"Issue key: {key}",
                    f"Summary: {fields.get('summary') or key}",
                    f"Status: {(fields.get('status') or {}).get('name')}",
                    f"Priority: {(fields.get('priority') or {}).get('name')}",
                    f"Assignee: {(fields.get('assignee') or {}).get('displayName') or (fields.get('assignee') or {}).get('emailAddress')}",
                    str(fields.get('description') or ''),
                ])),
                "url": f"{jira_base_url}/browse/{key}" if jira_base_url else issue.get("self"),
                "metadata": {"jira_issue_key": key, "fields": fields},
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
    _upsert_documents(documents)

    return SyncProviderResult(
        provider="jira",
        status="success",
        retrieved_count=len(issues),
        stored_count=stored,
        indexed_count=len(documents),
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
        index_result = index_workspace_documents(workspace_id, provider)
        _finish_sync_run(
            run_id,
            status_value="success",
            retrieved_count=result.retrieved_count,
            stored_count=result.stored_count,
            metadata={"index": index_result.model_dump()},
        )
        get_admin_client().table("integrations").update({
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "last_index_at": datetime.now(timezone.utc).isoformat(),
            "last_sync_status": "success",
            "last_sync_counts": {"retrieved": result.retrieved_count, "stored": result.stored_count, "chunks": index_result.chunks_stored},
            "last_sync_error": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("workspace_id", workspace_id).eq("provider", provider).execute()
        return result.model_copy(update={"indexed_count": index_result.chunks_stored, "message": f"{result.message} Indexed {index_result.chunks_stored} chunks."})
    except Exception as exc:
        _finish_sync_run(
            run_id,
            status_value="error",
            error_message=str(exc),
        )
        get_admin_client().table("integrations").update({
            "last_sync_status": "error",
            "last_sync_error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("workspace_id", workspace_id).eq("provider", provider).execute()
        raise


@router.post("", response_model=SyncResponse)
def sync_all(current_user: CurrentUser = Depends(get_current_user)) -> SyncResponse:
    workspace_id = _resolve_workspace_id(current_user)
    results: list[SyncProviderResult] = []
    for provider in SYNC_PROVIDERS:
        try:
            results.append(_sync_provider(workspace_id, provider))
        except HTTPException as exc:
            results.append(SyncProviderResult(provider=provider, status="error", error_message=str(exc.detail), message=f"{provider} sync failed: {exc.detail}"))
        except Exception as exc:
            results.append(SyncProviderResult(provider=provider, status="error", error_message=str(exc), message=f"{provider} sync failed."))
    overall = "success" if all(item.status == "success" for item in results) else "partial_failure"
    return SyncResponse(workspace_id=workspace_id, status=overall, results=results)


@router.post("/{provider}", response_model=SyncProviderResult)
def sync_one(
    provider: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> SyncProviderResult:
    workspace_id = _resolve_workspace_id(current_user)
    return _sync_provider(workspace_id, provider)
