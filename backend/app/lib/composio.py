from __future__ import annotations

import os
import re
import uuid
import logging
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from typing import Any

from fastapi import HTTPException, status

try:
    from composio import Composio
except ImportError:  # pragma: no cover - exercised by configuration tests
    Composio = None


JIRA_APP = "JIRA"
_SAFE_TEXT = re.compile(r"[^\w .:/-]+")
_SENSITIVE_TEXT = re.compile(r"(?i)(bearer\s+|api[_-]?key[=: ]+|access[_-]?token[=: ]+|secret[=: ]+|ak_[A-Za-z0-9_-]+|gsk_[A-Za-z0-9_-]+)[^\s,;]+")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProxyResponse:
    status_code: int
    data: Any = None
    headers: dict[str, str] = field(default_factory=dict)


class ComposioClient:
    """Small adapter for the Composio 0.20.x API used by this service."""

    def __init__(self) -> None:
        self._client: Any | None = None

    def get_client(self) -> Any:
        if self._client is None:
            if Composio is None:
                raise HTTPException(503, "The Composio SDK is not installed on the backend.")
            api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
            if not api_key:
                raise HTTPException(503, "COMPOSIO_API_KEY is missing from the backend configuration.")
            self._client = Composio(api_key=api_key)
        return self._client

    def diagnostics(self) -> dict[str, Any]:
        client = None
        methods = {"client": False, "connected_accounts": False, "tools_proxy": False}
        try:
            client = self.get_client()
            methods = {
                "client": True,
                "connected_accounts": hasattr(client, "connected_accounts"),
                "tools_proxy": callable(getattr(getattr(client, "tools", None), "proxy", None)),
            }
        except HTTPException:
            pass
        return {
            "composio_version": _sdk_version(),
            "methods": methods,
            "api_key_configured": bool(os.getenv("COMPOSIO_API_KEY", "").strip()),
            "jira_auth_configured": bool(os.getenv("COMPOSIO_JIRA_AUTH_CONFIG_ID", "").strip()),
            "frontend_url_configured": bool(os.getenv("FRONTEND_URL", "").strip()),
        }

    def create_connection_link(self, *, entity_id: str, app_name: str, callback_url: str) -> Any:
        auth_config_id = _auth_config_id(app_name)
        if not callback_url.startswith(("http://", "https://")):
            raise HTTPException(503, "FRONTEND_URL must produce an absolute OAuth callback URL.")
        accounts = getattr(self.get_client(), "connected_accounts", None)
        link = getattr(accounts, "link", None)
        if not callable(link):
            raise HTTPException(503, "The installed Composio SDK does not expose connected_accounts.link.")
        try:
            return link(user_id=entity_id, auth_config_id=auth_config_id, callback_url=callback_url)
        except Exception as exc:
            raise _composio_error("oauth_link", exc) from exc

    def get_connection(self, *, entity_id: str, app_name: str, connection_id: str | None = None) -> Any | None:
        accounts = getattr(self.get_client(), "connected_accounts", None)
        if accounts is None:
            raise HTTPException(503, "The installed Composio SDK does not expose connected_accounts.")
        try:
            connection = accounts.get(connection_id) if connection_id else None
            if connection is None:
                response = accounts.list(
                    user_ids=[entity_id],
                    auth_config_ids=[_auth_config_id(app_name)],
                    toolkit_slugs=[app_name.lower()],
                    statuses=["ACTIVE"],
                    limit=10,
                )
                items = getattr(response, "items", None) or getattr(response, "data", None) or []
                connection = items[0] if items else None
            if connection is not None and str(getattr(connection, "user_id", entity_id)) != entity_id:
                raise HTTPException(403, "The Composio connection does not belong to this workspace.")
            return connection
        except HTTPException:
            raise
        except Exception as exc:
            raise _composio_error("connection_lookup", exc) from exc

    def assert_connection_active(self, *, entity_id: str, app_name: str, connection_id: str | None = None) -> Any:
        connection = self.get_connection(entity_id=entity_id, app_name=app_name, connection_id=connection_id)
        if connection is None:
            raise HTTPException(404, "No Composio connection was found for this workspace.")
        state = str(getattr(connection, "status", "")).upper()
        if state != "ACTIVE":
            reason = _safe_text_value(getattr(connection, "status_reason", None))
            raise HTTPException(409, {"category": "connection_inactive", "message": "The Jira connection is not active.", "status": state or "UNKNOWN", "reason": reason})
        return connection

    def proxy_request(self, *, endpoint: str, method: str, connected_account_id: str, body: Any = None, parameters: list[dict[str, str]] | None = None) -> ProxyResponse:
        proxy = getattr(getattr(self.get_client(), "tools", None), "proxy", None)
        if not callable(proxy):
            raise HTTPException(503, {"category": "sdk_api_missing", "message": "The installed Composio SDK does not expose tools.proxy.", "version": _sdk_version()})
        correlation_id = uuid.uuid4().hex
        try:
            response = proxy(endpoint=endpoint, method=method.upper(), body=body, connected_account_id=connected_account_id, parameters=parameters)
        except Exception as exc:
            logger.warning("Composio proxy request failed", extra={"category": "proxy_request", "endpoint": _safe_endpoint(endpoint), "method": method.upper(), "correlation_id": correlation_id, "error_type": type(exc).__name__})
            raise _composio_error("proxy_request", exc, correlation_id=correlation_id, endpoint=endpoint, method=method) from exc
        if isinstance(response, dict):
            status_code = int(response.get("status", response.get("status_code", 0)) or 0)
            data = response.get("data", response.get("body", response))
            headers = dict(response.get("headers") or {})
        else:
            status_code = int(getattr(response, "status", getattr(response, "status_code", 0)) or 0)
            data = getattr(response, "data", None)
            headers = dict(getattr(response, "headers", None) or {})
        result = ProxyResponse(status_code=status_code, data=data, headers=headers)
        if status_code >= 400:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, {"category": "jira_api_error", "message": _jira_error_message(data), "upstream_status": status_code, "endpoint": _safe_endpoint(endpoint), "method": method.upper(), "correlation_id": correlation_id})
        return result

    def revoke_connection(self, *, connection_id: str) -> None:
        if not connection_id:
            return
        try:
            self.get_client().connected_accounts.delete(connection_id, revoke_on_delete=True)
        except Exception as exc:
            raise _composio_error("connection_revoke", exc) from exc


def _sdk_version() -> str:
    try:
        return version("composio")
    except PackageNotFoundError:
        return "not installed"


def _auth_config_id(app_name: str) -> str:
    value = os.getenv(f"COMPOSIO_{app_name.upper()}_AUTH_CONFIG_ID", "").strip()
    if not value:
        raise HTTPException(503, f"COMPOSIO_{app_name.upper()}_AUTH_CONFIG_ID is missing from the backend configuration.")
    return value


def _safe_endpoint(endpoint: str) -> str:
    return endpoint.split("?", 1)[0]


def _safe_text_value(value: Any) -> str:
    redacted = _SENSITIVE_TEXT.sub("[REDACTED]", str(value or ""))
    return _SAFE_TEXT.sub("", redacted)[:300]


def _jira_error_message(data: Any) -> str:
    if isinstance(data, dict):
        messages = data.get("errorMessages") or []
        errors = data.get("errors") or {}
        parts = [str(item) for item in messages if item]
        if isinstance(errors, dict):
            parts.extend(f"{key}: {value}" for key, value in errors.items() if value)
        if data.get("message"):
            parts.append(str(data["message"]))
        if parts:
            return _safe_text_value("; ".join(parts))
    return "Jira or Composio rejected the request."


def _composio_error(category: str, exc: Exception, *, correlation_id: str | None = None, endpoint: str | None = None, method: str | None = None) -> HTTPException:
    detail: dict[str, Any] = {"category": category, "message": _safe_text_value(exc)}
    if correlation_id:
        detail["correlation_id"] = correlation_id
    if endpoint:
        detail["endpoint"] = _safe_endpoint(endpoint)
    if method:
        detail["method"] = method.upper()
    return HTTPException(502, detail)


composio_client = ComposioClient()
