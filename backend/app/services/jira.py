import json
import os
from typing import Any

from fastapi import HTTPException, status

from app.lib.composio import composio_client
from app.models.tasks import JiraProject, JiraTask
from app.utils.supabase_client import get_admin_client

DEFAULT_JIRA_PROJECT_KEY = os.getenv("DEFAULT_JIRA_PROJECT_KEY", "KAN").strip().upper()
DEFAULT_JIRA_PROJECT_ID = os.getenv("DEFAULT_JIRA_PROJECT_ID", "10000").strip()


def _data(response: Any) -> Any:
    data = getattr(response, "data", response)
    for _ in range(4):
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                return data
            continue
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
            continue
        break
    return data


def _headers(*items: tuple[str, str]) -> list[dict[str, str]]:
    return [{"name": name, "value": value, "type": "header"} for name, value in items]


def _mapping(value: Any) -> dict[str, Any]:
    parsed = _data(value) if isinstance(value, str) else value
    return parsed if isinstance(parsed, dict) else {}


def connection_id(workspace_id: str) -> str:
    result = (
        get_admin_client()
        .table("integrations")
        .select("status,composio_connection_id")
        .eq("workspace_id", workspace_id)
        .eq("provider", "jira")
        .limit(1)
        .execute()
    )
    if not result.data or result.data[0].get("status") != "connected":
        raise HTTPException(status_code=400, detail="Jira is not connected.")
    value = result.data[0].get("composio_connection_id")
    if not value:
        raise HTTPException(status_code=400, detail="Jira connection id is missing.")
    return str(value)


def issue_to_task(issue: dict[str, Any]) -> JiraTask:
    issue = _mapping(issue)
    fields = _mapping(issue.get("fields"))
    assignee = _mapping(fields.get("assignee"))
    status = _mapping(fields.get("status"))
    priority = _mapping(fields.get("priority"))
    return JiraTask(
        key=issue.get("key", ""),
        summary=fields.get("summary") or issue.get("key", "Untitled issue"),
        status=status.get("name") or (fields.get("status") if isinstance(fields.get("status"), str) else None),
        assignee=assignee.get("displayName") or assignee.get("emailAddress"),
        priority=priority.get("name") or (fields.get("priority") if isinstance(fields.get("priority"), str) else None),
        url=issue.get("self"),
        metadata={"fields": fields},
    )


def search_issues(
    workspace_id: str,
    *,
    jql: str = "project IS NOT EMPTY ORDER BY updated DESC",
    max_results: int = 100,
) -> list[dict[str, Any]]:
    connected_account_id = connection_id(workspace_id)
    issues: list[dict[str, Any]] = []
    start_at = 0
    page_size = min(max(max_results, 1), 100)
    seen_pages: set[tuple[str, ...]] = set()
    page_count = 0
    while True:
        page_count += 1
        if page_count > 50:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Jira pagination exceeded the safe page limit.")
        response = composio_client.proxy_request(
            endpoint="/rest/api/3/search",
            method="POST",
            connected_account_id=connected_account_id,
            body={
                "jql": jql,
                "startAt": start_at,
                "maxResults": page_size,
                "fields": ["summary", "status", "priority", "assignee", "updated", "description"],
            },
            parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")),
        )
        payload = _data(response)
        if not isinstance(payload, dict):
            break
        batch = payload.get("issues", [])
        if not isinstance(batch, list) or not batch:
            break
        page_signature = tuple(str(item.get("key", "")) for item in batch if isinstance(item, dict))
        if page_signature in seen_pages:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Jira returned a duplicate page during synchronization.")
        seen_pages.add(page_signature)
        issues.extend(item for item in batch if isinstance(item, dict))
        total = payload.get("total")
        start_at += len(batch)
        if len(batch) < page_size or (isinstance(total, int) and start_at >= total):
            break
    return issues


def list_projects(workspace_id: str) -> list[JiraProject]:
    response = composio_client.proxy_request(
        endpoint="/rest/api/3/project/search?maxResults=100&orderBy=name",
        method="GET",
        connected_account_id=connection_id(workspace_id),
        parameters=_headers(("Accept", "application/json")),
    )
    payload = _data(response) or {}
    values = payload.get("values", []) if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    return [
        JiraProject(
            key=item.get("key", ""),
            name=item.get("name") or item.get("key", ""),
            project_type=item.get("projectTypeKey"),
            url=item.get("self"),
        )
        for item in values
        if item.get("key")
    ]


def save_task(workspace_id: str, task: JiraTask) -> None:
    get_admin_client().table("jira_issues").upsert(
        {
            "workspace_id": workspace_id,
            "issue_key": task.key,
            "summary": task.summary,
            "status": task.status,
            "priority": task.priority,
            "assignee_email": task.assignee,
            "url": task.url,
            "metadata": task.metadata,
        },
        on_conflict="workspace_id,issue_key",
    ).execute()


def create_issue(workspace_id: str, summary: str, description: str, project_key: str | None = None, issue_type: str = "Task", priority: str = "Medium", project_id: str | None = None) -> JiraTask:
    project = (project_key or DEFAULT_JIRA_PROJECT_KEY).strip().upper()
    project_identifier = (project_id or DEFAULT_JIRA_PROJECT_ID).strip()
    project_ref = {"id": project_identifier} if project == DEFAULT_JIRA_PROJECT_KEY else {"key": project}
    fields: dict[str, Any] = {
        "project": project_ref,
        "summary": summary,
        "issuetype": {"name": issue_type},
        "priority": {"name": priority},
    }
    if description:
        fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": description}]}]}
    try:
        created = _data(composio_client.proxy_request(
            endpoint="/rest/api/3/issue",
            method="POST",
            connected_account_id=connection_id(workspace_id),
            body={"fields": fields},
            parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")),
        ))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jira create request failed: {exc}") from exc
    if not isinstance(created, dict):
        raise HTTPException(status_code=502, detail=f"Jira create returned an unexpected {type(created).__name__} response.")
    if not created.get("key"):
        raise HTTPException(status_code=502, detail="Jira did not return a created issue key.")
    try:
        issue = _data(composio_client.proxy_request(
            endpoint=f"/rest/api/3/issue/{created['key']}?fields=summary,status,priority,assignee,description",
            method="GET",
            connected_account_id=connection_id(workspace_id),
            parameters=_headers(("Accept", "application/json")),
        ))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jira read-back failed for {created['key']}: {exc}") from exc
    if not isinstance(issue, dict):
        raise HTTPException(status_code=502, detail=f"Jira read-back returned an unexpected {type(issue).__name__} response for {created['key']}.")
    task = issue_to_task(issue) if issue.get("key") else JiraTask(key=created["key"], summary=summary, status="To Do", priority=priority, url=created.get("self"), metadata={"issue_type": issue_type})
    try:
        save_task(workspace_id, task)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Jira ticket {task.key} was created, but local save failed: {exc}") from exc
    return task


def update_issue(workspace_id: str, issue_key: str, status_name: str | None = None) -> JiraTask:
    account_id = connection_id(workspace_id)
    if status_name:
        transitions = _data(composio_client.proxy_request(
            endpoint=f"/rest/api/3/issue/{issue_key}/transitions",
            method="GET",
            connected_account_id=account_id,
        )) or {}
        target = next((item for item in transitions.get("transitions", []) if (item.get("to") or {}).get("name", "").lower() == status_name.lower()), None)
        if not target:
            raise HTTPException(status_code=400, detail=f"Jira has no transition to status '{status_name}'.")
        composio_client.proxy_request(
            endpoint=f"/rest/api/3/issue/{issue_key}/transitions",
            method="POST",
            connected_account_id=account_id,
            body={"transition": {"id": target["id"]}},
            parameters=_headers(("Content-Type", "application/json")),
        )
    issue = _data(composio_client.proxy_request(
        endpoint=f"/rest/api/3/issue/{issue_key}?fields=summary,status,priority,assignee",
        method="GET",
        connected_account_id=account_id,
    )) or {}
    task = issue_to_task(issue)
    save_task(workspace_id, task)
    return task
