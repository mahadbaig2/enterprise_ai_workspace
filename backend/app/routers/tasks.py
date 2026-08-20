import json
import os
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from app.lib.composio import composio_client
from app.middleware.auth import get_current_user
from app.models.auth import CurrentUser
from app.models.tasks import JiraTask, JiraTaskCreateRequest, JiraTaskListResponse, JiraTaskResponse, JiraTaskUpdateRequest, JiraProject, JiraProjectListResponse
from app.services.jira import DEFAULT_JIRA_PROJECT_ID, DEFAULT_JIRA_PROJECT_KEY
from app.utils.supabase_client import get_admin_client

router = APIRouter()

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
    data = response.get("data", response) if isinstance(response, dict) else getattr(response, "data", response)
    if isinstance(data, str):
        try: return json.loads(data)
        except json.JSONDecodeError: return data
    return data

def _headers(*items: tuple[str, str]) -> list[dict[str, str]]:
    return [{"name": n, "value": v, "type": "header"} for n, v in items]

def _task(issue: dict[str, Any]) -> JiraTask:
    issue = issue if isinstance(issue, dict) else {}
    f = issue.get("fields", {}) or {}
    if isinstance(f, str):
        try: f = json.loads(f)
        except json.JSONDecodeError: f = {}
    if not isinstance(f, dict): f = {}
    status = f.get("status") if isinstance(f.get("status"), dict) else {}
    priority = f.get("priority") if isinstance(f.get("priority"), dict) else {}
    assignee = f.get("assignee") if isinstance(f.get("assignee"), dict) else {}
    return JiraTask(key=issue.get("key", ""), summary=f.get("summary") or issue.get("key", "Untitled issue"),
        status=status.get("name") or (f.get("status") if isinstance(f.get("status"), str) else None), assignee=assignee.get("displayName") or assignee.get("emailAddress"),
        priority=priority.get("name") or (f.get("priority") if isinstance(f.get("priority"), str) else None), url=issue.get("self"), metadata={"fields": f})

def _save(workspace_id: str, task: JiraTask) -> None:
    get_admin_client().table("jira_issues").upsert({"workspace_id": workspace_id, "issue_key": task.key, "summary": task.summary, "status": task.status, "priority": task.priority, "assignee_email": task.assignee, "url": task.url, "metadata": task.metadata}, on_conflict="workspace_id,issue_key").execute()

@router.get("", response_model=JiraTaskListResponse)
def list_tasks(user: CurrentUser = Depends(get_current_user)) -> JiraTaskListResponse:
    workspace_id = _workspace_id(user)
    rows = get_admin_client().table("jira_issues").select("issue_key,summary,status,priority,assignee_email,url,metadata").eq("workspace_id", workspace_id).order("updated_at", desc=True).limit(50).execute().data or []
    return JiraTaskListResponse(tasks=[JiraTask(key=r["issue_key"], summary=r.get("summary") or r["issue_key"], status=r.get("status"), priority=r.get("priority"), assignee=r.get("assignee_email"), url=r.get("url"), metadata=r.get("metadata") or {}) for r in rows])

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
    connection_id = _connection(_workspace_id(user))
    jql = f"project = {project_key.strip().upper()} ORDER BY updated DESC" if project_key else "project IS NOT EMPTY ORDER BY updated DESC"
    payload = _data(composio_client.proxy_request(
        endpoint="/rest/api/3/search",
        method="POST",
        connected_account_id=connection_id,
        body={"jql": jql, "maxResults": 100, "fields": ["summary", "status", "priority", "assignee", "updated"]},
        parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")),
    )) or {}
    issues = payload.get("issues", []) if isinstance(payload, dict) else []
    return JiraTaskListResponse(tasks=[_task(issue) for issue in issues])

@router.post("", response_model=JiraTaskResponse)
def create_task(payload: JiraTaskCreateRequest, user: CurrentUser = Depends(get_current_user)) -> JiraTaskResponse:
    workspace_id = _workspace_id(user); connection_id = _connection(workspace_id); project = (payload.project_key or DEFAULT_JIRA_PROJECT_KEY).strip().upper()
    project_ref = {"key": project} if payload.project_key else {"id": DEFAULT_JIRA_PROJECT_ID}
    fields: dict[str, Any] = {"project": project_ref, "summary": payload.summary, "issuetype": {"name": payload.issue_type}, "priority": {"name": payload.priority}}
    if payload.description: fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": payload.description}]}]}
    created = _data(composio_client.proxy_request(endpoint="/rest/api/3/issue", method="POST", connected_account_id=connection_id, body={"fields": fields}, parameters=_headers(("Accept", "application/json"), ("Content-Type", "application/json")))) or {}
    if not created.get("key"): raise HTTPException(502, "Jira did not return a created issue key.")
    issue = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{created['key']}?fields=summary,status,priority,assignee", method="GET", connected_account_id=connection_id, parameters=_headers(("Accept", "application/json")))) or {}
    task = _task(issue) if issue.get("key") else JiraTask(key=created["key"], summary=payload.summary, status="To Do", priority=payload.priority, url=created.get("self"), metadata={"issue_type": payload.issue_type}); _save(workspace_id, task)
    return JiraTaskResponse(task=task)

@router.patch("/{issue_key}", response_model=JiraTaskResponse)
def update_task(issue_key: str, payload: JiraTaskUpdateRequest, user: CurrentUser = Depends(get_current_user)) -> JiraTaskResponse:
    workspace_id = _workspace_id(user); connection_id = _connection(workspace_id); fields: dict[str, Any] = {}
    if payload.summary is not None: fields["summary"] = payload.summary
    if payload.priority is not None: fields["priority"] = {"name": payload.priority}
    if payload.description is not None: fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": payload.description}]}]}
    if fields: composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{issue_key}", method="PUT", connected_account_id=connection_id, body={"fields": fields}, parameters=_headers(("Content-Type", "application/json")))
    if payload.status:
        transitions = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{issue_key}/transitions", method="GET", connected_account_id=connection_id)) or {}
        target = next((x for x in transitions.get("transitions", []) if (x.get("to") or {}).get("name", "").lower() == payload.status.lower()), None)
        if not target: raise HTTPException(400, f"Jira has no transition to status '{payload.status}'.")
        composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{issue_key}/transitions", method="POST", connected_account_id=connection_id, body={"transition": {"id": target["id"]}}, parameters=_headers(("Content-Type", "application/json")))
    issue = _data(composio_client.proxy_request(endpoint=f"/rest/api/3/issue/{issue_key}?fields=summary,status,priority,assignee", method="GET", connected_account_id=connection_id)) or {}
    task = _task(issue); _save(workspace_id, task); return JiraTaskResponse(task=task)
