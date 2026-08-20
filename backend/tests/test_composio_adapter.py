import os
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.lib.composio import ComposioClient, ProxyResponse


class ComposioAdapterTests(unittest.TestCase):
    def test_diagnostics_do_not_expose_secret_values(self):
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "secret", "COMPOSIO_JIRA_AUTH_CONFIG_ID": "ac_secret"}):
            client = ComposioClient()
            diagnostics = client.diagnostics()
        self.assertTrue(diagnostics["api_key_configured"])
        self.assertTrue(diagnostics["jira_auth_configured"])
        self.assertNotIn("secret", str(diagnostics))

    def test_proxy_normalizes_sdk_response(self):
        client = ComposioClient()
        sdk_client = Mock()
        sdk_client.tools.proxy.return_value = Mock(status=200, data={"accountId": "safe"}, headers={"x-trace": "id"})
        client._client = sdk_client
        response = client.proxy_request(endpoint="/rest/api/3/myself", method="GET", connected_account_id="ca_test")
        self.assertIsInstance(response, ProxyResponse)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["accountId"], "safe")

    def test_proxy_rejects_upstream_errors_with_safe_detail(self):
        client = ComposioClient()
        sdk_client = Mock()
        sdk_client.tools.proxy.return_value = Mock(status=403, data={"errorMessages": ["Forbidden"]}, headers={})
        client._client = sdk_client
        with self.assertRaises(HTTPException) as context:
            client.proxy_request(endpoint="/rest/api/3/myself?private=value", method="GET", connected_account_id="ca_test")
        self.assertEqual(context.exception.status_code, 502)
        self.assertNotIn("private=value", str(context.exception.detail))
        self.assertIn("Forbidden", str(context.exception.detail))


if __name__ == "__main__":
    unittest.main()
