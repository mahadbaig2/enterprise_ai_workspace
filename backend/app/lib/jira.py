"""Authenticated Jira Cloud REST v3 client.

Credentials are read only from the backend environment. They are never
accepted from request payloads and are never included in errors or logs.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, status


@dataclass
class JiraApiError(Exception):
    status_code: int
    method: str
    path: str
    message: str


class JiraClient:
    def __init__(self) -> None:
        base_url = os.getenv("JIRA_BASE_URL", "").strip().rstrip("/")
        email = os.getenv("JIRA_EMAIL", "").strip()
        token = os.getenv("JIRA_API_TOKEN", "").strip()
        if not base_url:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JIRA_BASE_URL is not configured on the backend.")
        if not email:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JIRA_EMAIL is not configured on the backend.")
        if not token:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JIRA_API_TOKEN is not configured on the backend.")
        if not base_url.startswith(("https://", "http://")):
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JIRA_BASE_URL must be an HTTP(S) URL.")
        self.base_url = base_url
        self._auth = httpx.BasicAuth(email, token)

    def request(self, method: str, path: str, *, params: dict[str, Any] | None = None, json: dict[str, Any] | None = None) -> dict[str, Any]:
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self.base_url}{normalized_path}"
        try:
            response = httpx.request(method.upper(), url, auth=self._auth, params=params, json=json, headers={"Accept": "application/json", "Content-Type": "application/json"}, timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=False)
        except httpx.HTTPError as exc:
            raise JiraApiError(503, method.upper(), normalized_path, "Jira could not be reached. Please retry.") from exc
        if response.is_error:
            raise JiraApiError(response.status_code, method.upper(), normalized_path, _safe_error(response))
        if response.status_code == 204 or not response.content:
            return {}
        try:
            payload = response.json()
        except ValueError as exc:
            raise JiraApiError(502, method.upper(), normalized_path, "Jira returned an invalid JSON response.") from exc
        if not isinstance(payload, dict):
            raise JiraApiError(502, method.upper(), normalized_path, "Jira returned an unexpected response shape.")
        return payload

    def myself(self) -> dict[str, Any]:
        return self.request("GET", "/rest/api/3/myself")

    def projects(self) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        start_at = 0
        while True:
            payload = self.request("GET", "/rest/api/3/project/search", params={"startAt": start_at, "maxResults": 50, "orderBy": "name"})
            page = payload.get("values", [])
            values.extend(item for item in page if isinstance(item, dict))
            if payload.get("isLast", True) or not page:
                return values
            start_at += len(page)

    def search(self, jql: str, *, fields: list[str], max_results: int = 50) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        next_page_token: str | None = None
        while True:
            body: dict[str, Any] = {"jql": jql, "maxResults": min(max_results, 100), "fields": fields}
            if next_page_token:
                body["nextPageToken"] = next_page_token
            payload = self.request("POST", "/rest/api/3/search/jql", json=body)
            page = payload.get("issues", [])
            issues.extend(item for item in page if isinstance(item, dict))
            next_page_token = payload.get("nextPageToken")
            if payload.get("isLast", not next_page_token) or not page or not next_page_token or len(issues) >= max_results:
                return issues[:max_results]

    def create_issue(self, fields: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/rest/api/3/issue", json={"fields": fields})

    def update_issue(self, issue_key: str, fields: dict[str, Any]) -> dict[str, Any]:
        return self.request("PUT", f"/rest/api/3/issue/{issue_key}", json={"fields": fields})

    def get_issue(self, issue_key: str) -> dict[str, Any]:
        return self.request("GET", f"/rest/api/3/issue/{issue_key}", params={"fields": "summary,status,priority,assignee,project,issuetype,updated,duedate"})

    def transitions(self, issue_key: str) -> dict[str, Any]:
        return self.request("GET", f"/rest/api/3/issue/{issue_key}/transitions")

    def transition(self, issue_key: str, transition_id: str) -> dict[str, Any]:
        return self.request("POST", f"/rest/api/3/issue/{issue_key}/transitions", json={"transition": {"id": transition_id}})


def _safe_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            messages = payload.get("errorMessages") or []
            if messages:
                return "; ".join(str(message) for message in messages)[:500]
            errors = payload.get("errors") or {}
            if isinstance(errors, dict) and errors:
                return "; ".join(f"{key}: {value}" for key, value in errors.items())[:500]
    except ValueError:
        pass
    return f"Jira returned HTTP {response.status_code}."


def get_jira_client() -> JiraClient:
    return JiraClient()
