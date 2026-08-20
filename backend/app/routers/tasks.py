import os
import re
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from app.lib.composio import composio_client
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.tasks import JiraTask, JiraTaskCreateRequest, JiraTaskListResponse, JiraTaskResponse, JiraTaskUpdateRequest, JiraProject, JiraProjectListResponse
from app.utils.supabase_client import get_admin_client

router = APIRouter()
ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]+-\d+$")
MAX_SEARCH_RESULTS = 200

def _workspace_id(user: CurrentUser) -> str:
    result = get_admin_client().table("workspaces").select("id").eq("owner_id", user.id).limit(1).execute()
    if not result.data: raise HTTPException(404, "No workspace found for this user.")
    return str(result.data[0]["id"])

def _connection(workspace_id: str) -> str:
    result = get_admin_client().table("integrations").select("status,composio_connection_id").eq("workspace_id", workspace_id).eq("provider", "jira").limit(1).execute()
    if not result.data or result.data[0].get("status") != "connected": raise HTTPException(400, "Jira is not connected.")
    connection_id = result.data[0].get("composio_connection_id")
    if not connection_id: raise HTTPException(400, "Jira connection id is missing.")
    return str(connection_id)

def _data(response: Any) -> Any:
    if isinstance(response, dict): return response.get("data", response)
    return getattr(response, "data", response)

def _headers(*items: tuple[str, str]) -> list[dict[str, str]]:
    return [{"name": n, "value": v, "type": "header"} for n, v in items]

def _task(issue: dict[str, Any]) -> JiraTask:
    f = issue.get("fields", {}) or {}
    key = issue.get("key", "")
    host = os.getenv("JIRA_HOST_URL", "").rstrip("/")
    return JiraTask(key=key, summary=f.get("summary") or key or "Untitled issue",
        status=(f.get("status") or {}).get("name"), assignee=(f.get("assignee") or {}).get("displayName") or (f.get("assignee") or {}).get("emailAddress"),
        priority=(f.get("priority") or {}).get("name"), url=f"{host}/browse/{key}" if host and key else issue.get("self"), metadata={"fields": f})

def _save(workspace_id: str, task: JiraTask) -> None:
    get_admin_client().table("jira_issues").upsert({"workspace_id": workspace_id, "issue_key": task.key, "summary": task.summary, "status": task.status, "priority": task.priority, "assignee_email": task.assignee, "url": task.url, "metadata": task.metadata}, on_conflict="workspace_id,issue_key").execute()

def _cache_tasks(workspace_id: str) -> list[JiraTask]:
    rows = get_admin_client().table("jira_issues").select("issue_key,summary,status,priority,assignee_email,url,metadata").eq("workspace_id", workspace_id).order("updated_at", desc=True).limit(50).execute().data or []
    return [JiraTask(key=r["issue_key"], summary=r.get("summary") or r["issue_key"], status=r.get("status"), priority=r.get("priority"), assignee=r.get("assignee_email"), url=r.get("url"), metadata=r.get("metadata") or {}) for r in rows]

def _project_key(value: str | None) -> str | None:
    project = (value or os.getenv("DEFAULT_JIRA_PROJECT_KEY", "")).strip().upper()
    if not project:
        return None
    if not re.fullmatch(r"[A-Z][A-Z0-9_]+", project):
        raise HTTPException(400, "A Jira project key is required, for example KAN. Numeric project IDs are not valid project keys.")
    return project

def _search_jira(connection_id: str, project_key: str | None = None) -> list[JiraTask]:
    project = _project_key(project_key)
    jql = f"project = {project} AND assignee = currentUser() ORDER BY updated DESC" if project else "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
    fields = ["summary", "status", "priority", "assignee", "updated", "duedate", "project", "issuetype"]
    results: list[JiraTask] = []
    start_at = 0
    while len(results) < MAX_SEARCH_RESULTS:
        payload = _data(composio_client.proxy_request(
            endpoint="/rest/api/3/search",
            method="POST",
            connected_account_id=connection_id,
            body={"jql": jql, "startAt": start_at, "maxResults": min(50, MAX_SEARCH_RESULTS - len(results)), "fields": fields},
            parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")),
        )) or {}
        issues = payload.get("issues", []) if isinstance(payload, dict) else []
        results.extend(_task(issue) for issue in issues)
        if not isinstance(payload, dict) or not issues or len(results) >= int(payload.get("total", len(results))) or len(issues) < 50:
            break
        start_at += len(issues)
    return results[:MAX_SEARCH_RESULTS]

@router.get("", response_model=JiraTaskListResponse)
def list_tasks(user: CurrentUser = Depends(get_current_user)) -> JiraTaskListResponse:
    workspace_id = _workspace_id(user)
    try:
        tasks = _search_jira(_connection(workspace_id), None)
        for task in tasks:
            _save(workspace_id, task)
        return JiraTaskListResponse(tasks=tasks, source="live", stale=False)
    except Exception:
        return JiraTaskListResponse(tasks=_cache_tasks(workspace_id), source="cache", stale=True)

@router.get("/projects", response_model=JiraProjectListResponse)
def list_projects(user: CurrentUser = Depends(get_current_user)) -> JiraProjectListResponse:
    connection_id = _connection(_workspace_id(user))
    payload = _data(composio_client.proxy_request(
        endpoint="/rest/api/3/project/search?maxResults=100&orderBy=name",
        method="GET",
        connected_account_id=connection_id,
        parameters=_headers(("Accept", "application/json")),
    )) or {}
    values = payload.get("values", payload if isinstance(payload, list) else [])
    projects = [JiraProject(
        key=item.get("key", ""),
        name=item.get("name") or item.get("key", ""),
        project_type=item.get("projectTypeKey"),
        url=item.get("self"),
    ) for item in values if item.get("key")]
    return JiraProjectListResponse(projects=projects)

@router.get("/issues", response_model=JiraTaskListResponse)
def search_issues(project_key: str | None = None, user: CurrentUser = Depends(get_current_user)) -> JiraTaskListResponse:
    workspace_id = _workspace_id(user)
    tasks = _search_jira(_connection(workspace_id), project_key)
    for task in tasks:
        _save(workspace_id, task)
    return JiraTaskListResponse(tasks=tasks, source="live", stale=False)

def _assert_project_accessible(connection_id: str, project: str) -> None:
    try:
        composio_client.proxy_request(
            endpoint=f"/rest/api/3/project/{project}?fields=key",
            method="GET",
            connected_account_id=connection_id,
            parameters=_headers(("Accept", "application/json")),
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        if detail.get("upstream_status") == 404:
            raise HTTPException(400, f"Jira project key '{project}' is unknown or inaccessible to the connected account.") from exc
        raise

def _browser_issue_url(issue_key: str, fallback: str | None = None) -> str | None:
    host = os.getenv("JIRA_HOST_URL", "").rstrip("/")
    return f"{host}/browse/{issue_key}" if host else fallback

@router.post("", response_model=JiraTaskResponse)
def create_task(payload: JiraTaskCreateRequest, user: CurrentUser = Depends(get_current_user)) -> JiraTaskResponse:
    workspace_id = _workspace_id(user); connection_id = _connection(workspace_id); project = _project_key(payload.project_key)
    if not project: raise HTTPException(400, "A Jira project key is required to create an issue.")
    _assert_project_accessible(connection_id, project)
    fields: dict[str, Any] = {"project": {"key": project}, "summary": payload.summary, "issuetype": {"name": payload.issue_type}, "priority": {"name": payload.priority}}
    if payload.description: fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": payload.description}]}]}
    created = _data(composio_client.proxy_request(endpoint="/rest/api/3/issue", method="POST", connected_account_id=connection_id, body={"fields": fields}, parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")))) or {}
    if not created.get("key"): raise HTTPException(502, "Jira did not return a created issue key.")
    task = JiraTask(key=created["key"], summary=payload.summary, status="To Do", priority=payload.priority, url=_browser_issue_url(created["key"], created.get("self")), metadata={"issue_type": payload.issue_type}); _save(workspace_id, task)
    return JiraTaskResponse(task=task)

@router.patch("/{issue_key}", response_model=JiraTaskResponse)
def update_task(issue_key: str, payload: JiraTaskUpdateRequest, user: CurrentUser = Depends(get_current_user)) -> JiraTaskResponse:
    workspace_id = _workspace_id(user); connection_id = _connection(workspace_id); fields: dict[str, Any] = {}
    normalized_issue_key = issue_key.strip().upper()
    if not ISSUE_KEY_RE.fullmatch(normalized_issue_key): raise HTTPException(400, "Invalid Jira issue key.")
    issue_before = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{normalized_issue_key}?fields=project", method="GET", connected_account_id=connection_id, parameters=_headers(("Accept", "application/json")))) or {}
    if not (issue_before.get("fields", {}).get("project", {}).get("key") if isinstance(issue_before, dict) else None): raise HTTPException(404, "Jira issue was not found or is not accessible.")
    if payload.summary is not None: fields["summary"] = payload.summary
    if payload.priority is not None: fields["priority"] = {"name": payload.priority}
    if payload.description is not None: fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": payload.description}]}]}
    if fields: composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{normalized_issue_key}", method="PUT", connected_account_id=connection_id, body={"fields": fields}, parameters=_headers(("Content-Type", "application/json")))
    if payload.status:
        transitions = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{normalized_issue_key}/transitions", method="GET", connected_account_id=connection_id)) or {}
        target = next((x for x in transitions.get("transitions", []) if (x.get("to") or {}).get("name", "").lower() == payload.status.lower()), None)
        if not target: raise HTTPException(400, f"Jira has no transition to status '{payload.status}'.")
        composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{normalized_issue_key}/transitions", method="POST", connected_account_id=connection_id, body={"transition": {"id": target["id"]}}, parameters=_headers(("Content-Type", "application/json")))
    issue = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{normalized_issue_key}?fields=summary,status,priority,assignee,project,issuetype", method="GET", connected_account_id=connection_id)) or {}
    task = _task(issue); _save(workspace_id, task); return JiraTaskResponse(task=task)
