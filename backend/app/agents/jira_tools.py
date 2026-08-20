from __future__ import annotations

import re
import os
from typing import Any

from fastapi import HTTPException

from app.lib.jira import JiraApiError, get_jira_client
from app.models.tasks import JiraTask
from app.utils.supabase_client import get_admin_client

ISSUE_KEY = re.compile(r"^[A-Z][A-Z0-9_]*-[1-9][0-9]*$")
PROJECT_KEY = re.compile(r"^[A-Z][A-Z0-9_]{1,9}$")


def workspace_id_for_user(user_id: str) -> str:
    result = get_admin_client().table("workspaces").select("id").eq("owner_id", user_id).limit(1).execute()
    if not result.data:
        raise HTTPException(404, "No workspace found for this user.")
    return str(result.data[0]["id"])


def connection_for_workspace(workspace_id: str):
    # Workspace resolution remains mandatory even though the REST credentials
    # are server-side configuration rather than a browser-supplied token.
    if not workspace_id:
        raise HTTPException(400, "A workspace is required for Jira operations.")
    return get_jira_client()


def search_assigned(workspace_id: str, project_key: str | None = None) -> list[JiraTask]:
    client = connection_for_workspace(workspace_id)
    project = normalize_project_key(project_key) if project_key else None
    clauses = ["assignee = currentUser()", "statusCategory != Done"]
    if project:
        clauses.insert(0, f"project = {project}")
    jql = " AND ".join(clauses) + " ORDER BY updated DESC"
    try:
        return [_task(issue) for issue in client.search(jql, fields=["summary", "status", "priority", "assignee", "updated", "duedate", "project", "issuetype"])]
    except JiraApiError as exc:
        raise HTTPException(502, f"Jira {exc.method} {exc.path} failed ({exc.status_code}): {exc.message}") from exc


def list_projects(workspace_id: str) -> list[dict[str, Any]]:
    try:
        return get_jira_client().projects()
    except JiraApiError as exc:
        raise HTTPException(502, f"Jira {exc.method} {exc.path} failed ({exc.status_code}): {exc.message}") from exc


def create_issue(workspace_id: str, *, summary: str, project_key: str, description: str = "", issue_type: str = "Task", priority: str = "Medium") -> JiraTask:
    project = normalize_project_key(project_key)
    client = connection_for_workspace(workspace_id)
    fields: dict[str, Any] = {"project": {"key": project}, "summary": summary, "issuetype": {"name": issue_type}, "priority": {"name": priority}}
    if description:
        fields["description"] = {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": description}]}]}
    try:
        payload = client.create_issue(fields)
    except JiraApiError as exc:
        raise HTTPException(502, f"Jira {exc.method} {exc.path} failed ({exc.status_code}): {exc.message}") from exc
    if not payload.get("key"):
        raise HTTPException(502, "Jira did not return a created issue key.")
    task = JiraTask(key=payload["key"], summary=summary, priority=priority, url=issue_url(payload["key"], payload.get("self")), metadata={"project_key": project, "issue_type": issue_type})
    save_task(workspace_id, task)
    return task


def normalize_project_key(value: str) -> str:
    project = value.strip().upper()
    if project.isdigit():
        raise HTTPException(400, "Jira project key is required; numeric project IDs cannot be used as keys.")
    if not PROJECT_KEY.fullmatch(project):
        raise HTTPException(400, "Invalid Jira project key.")
    return project


def save_task(workspace_id: str, task: JiraTask) -> None:
    get_admin_client().table("jira_issues").upsert({"workspace_id": workspace_id, "issue_key": task.key, "summary": task.summary, "status": task.status, "priority": task.priority, "assignee_email": task.assignee, "url": task.url, "metadata": task.metadata}, on_conflict="workspace_id,issue_key").execute()


def issue_url(key: str, api_url: str | None = None) -> str | None:
    base_url = os.getenv("JIRA_BASE_URL", "").strip().rstrip("/")
    if base_url:
        return f"{base_url}/browse/{key}"
    if api_url and "/rest/api/" in api_url:
        return api_url.split("/rest/api/", 1)[0].rstrip("/") + f"/browse/{key}"
    return api_url


def _task(issue: dict[str, Any]) -> JiraTask:
    fields = issue.get("fields", {}) or {}
    assignee = fields.get("assignee") or {}
    key = issue.get("key", "")
    return JiraTask(key=key, summary=fields.get("summary") or key or "Untitled issue", status=(fields.get("status") or {}).get("name"), assignee=assignee.get("displayName") or assignee.get("emailAddress"), priority=(fields.get("priority") or {}).get("name"), url=issue_url(key, issue.get("self")), metadata={"fields": fields})
