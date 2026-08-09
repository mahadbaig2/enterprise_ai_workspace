import os
from typing import Any

import httpx
from fastapi import HTTPException, status

os.environ.setdefault("COMPOSIO_CACHE_DIR", r"C:\tmp\composio-cache")

try:
    from composio import Composio
except Exception:  # pragma: no cover - depends on optional SDK installation
    Composio = None

try:
    from composio import App
except Exception:  # pragma: no cover - App exists in older SDKs
    App = None

try:
    from composio import ComposioToolSet
except Exception:  # pragma: no cover - ComposioToolSet exists in older SDKs
    ComposioToolSet = None


class ComposioClientProxy:
    def __init__(self) -> None:
        self._client: Any | None = None

    @property
    def client(self) -> Any:
        if self._client is None:
            client_cls = Composio or ComposioToolSet
            if client_cls is None:
                self._raise_sdk_unavailable()

            api_key = self._api_key()
            self._client = client_cls(api_key=api_key)

        return self._client

    def get_app(self, app_name: str) -> Any:
        if App is not None:
            return getattr(App, app_name)
        return app_name

    def initiate_connection(self, *, entity_id: str, app: Any, redirect_url: str) -> Any:
        app_name = self._app_name(app)
        auth_config_id = self._get_auth_config_id(app_name)

        link_request = self._link_with_sdk(
            user_id=entity_id,
            auth_config_id=auth_config_id,
            callback_url=redirect_url,
        )
        if link_request is not None:
            return link_request

        if hasattr(self.client, "initiate_connection"):
            try:
                return self.client.initiate_connection(
                    entity_id=entity_id,
                    app=app,
                    redirect_url=redirect_url,
                )
            except Exception as exc:
                if not self._is_legacy_oauth_error(exc):
                    raise

        connected_accounts = self._connected_accounts_api()
        if connected_accounts is not None and hasattr(connected_accounts, "initiate"):
            try:
                return connected_accounts.initiate(
                    user_id=entity_id,
                    auth_config_id=auth_config_id,
                    callback_url=redirect_url,
                )
            except Exception as exc:
                if not self._is_legacy_oauth_error(exc):
                    raise

        return self._link_with_httpx(
            user_id=entity_id,
            auth_config_id=auth_config_id,
            callback_url=redirect_url,
        )

    def proxy_request(
        self,
        *,
        endpoint: str,
        method: str,
        connected_account_id: str,
        body: dict[str, Any] | None = None,
        parameters: list[dict[str, str]] | None = None,
    ) -> Any:
        tools = getattr(self.client, "tools", None)
        if tools is None or not hasattr(tools, "proxy"):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The installed Composio SDK does not expose tools.proxy.",
            )

        try:
            return tools.proxy(
                endpoint=endpoint,
                method=method,
                body=body,
                connected_account_id=connected_account_id,
                parameters=parameters,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Composio proxy request failed: {exc}",
            ) from exc

    def get_connection(self, *, entity_id: str, app: Any, connection_id: str) -> Any:
        if hasattr(self.client, "get_entity"):
            entity = self.client.get_entity(entity_id=entity_id)
            return entity.get_connection(app=app)

        connected_accounts = self._connected_accounts_api()
        if connected_accounts is None:
            return None

        if connection_id:
            return connected_accounts.get(connection_id)

        auth_config_id = self._get_auth_config_id(self._app_name(app))
        connections = connected_accounts.list(
            user_ids=[entity_id],
            auth_config_ids=[auth_config_id],
            statuses=["ACTIVE"],
        )
        items = getattr(connections, "items", None) or getattr(connections, "data", None)
        return items[0] if items else None

    def revoke_connection(
        self, *, entity_id: str, app: Any, connection_id: str | None
    ) -> None:
        if hasattr(self.client, "get_entity"):
            entity = self.client.get_entity(entity_id=entity_id)
            if hasattr(entity, "disable_trigger"):
                entity.disable_trigger(app=app)
            return

        connected_accounts = self._connected_accounts_api()
        if connection_id and connected_accounts is not None:
            connected_accounts.delete(
                connection_id,
                revoke_on_delete=True,
            )

    def _link_with_sdk(
        self,
        *,
        user_id: str,
        auth_config_id: str,
        callback_url: str,
    ) -> Any | None:
        connected_accounts = self._connected_accounts_api()
        if connected_accounts is None or not hasattr(connected_accounts, "link"):
            return None

        link = connected_accounts.link
        try:
            return link(
                user_id=user_id,
                auth_config_id=auth_config_id,
                callback_url=callback_url,
            )
        except TypeError:
            try:
                return link(
                    user_id=user_id,
                    auth_config_id=auth_config_id,
                    callbackUrl=callback_url,
                )
            except TypeError:
                return link(user_id=user_id, auth_config_id=auth_config_id)

    def _link_with_httpx(
        self,
        *,
        user_id: str,
        auth_config_id: str,
        callback_url: str,
    ) -> dict[str, Any]:
        try:
            response = httpx.post(
                "https://backend.composio.dev/api/v3/connected_accounts/link",
                headers={
                    "x-api-key": self._api_key(),
                    "Content-Type": "application/json",
                },
                json={
                    "auth_config_id": auth_config_id,
                    "user_id": user_id,
                    "callback_url": callback_url,
                },
                timeout=20,
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            try:
                payload = exc.response.json()
                detail = payload.get("error", {}).get("message", detail)
            except ValueError:
                pass
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Composio link request failed: {detail}",
            ) from exc
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Composio link request failed: {exc}",
            ) from exc

    def _connected_accounts_api(self) -> Any | None:
        return getattr(self.client, "connected_accounts", None) or getattr(
            self.client,
            "connectedAccounts",
            None,
        )

    @staticmethod
    def _is_legacy_oauth_error(exc: Exception) -> bool:
        message = str(exc).lower()
        return "connected_accounts/link" in message or "no longer supported" in message

    @staticmethod
    def _app_name(app: Any) -> str:
        if isinstance(app, str):
            return app.upper()
        value = getattr(app, "value", None)
        if isinstance(value, str):
            return value.upper()
        name = getattr(app, "name", None)
        if isinstance(name, str):
            return name.upper()
        return str(app).rsplit(".", 1)[-1].upper()

    @staticmethod
    def _api_key() -> str:
        api_key = os.getenv("COMPOSIO_API_KEY", "")
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="COMPOSIO_API_KEY is not configured on the backend.",
            )
        return api_key

    @staticmethod
    def _get_auth_config_id(app_name: str) -> str:
        key = f"COMPOSIO_{app_name.upper()}_AUTH_CONFIG_ID"
        auth_config_id = os.getenv(key, "")
        if not auth_config_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"{key} is not configured. Composio Connect Links require "
                    "an auth config id per provider."
                ),
            )
        return auth_config_id

    @staticmethod
    def _raise_sdk_unavailable() -> None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Composio SDK is not installed. Install backend requirements "
                "with: pip install -r backend/requirements.txt"
            ),
        )


composio_client = ComposioClientProxy()
