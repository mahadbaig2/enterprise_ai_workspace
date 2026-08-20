import unittest
from unittest.mock import Mock, patch

from app.routers.integrations import _get_active_connection, _normalize_connection_id


class IntegrationHelperTests(unittest.TestCase):
    def test_callback_identifier_normalization_order(self):
        self.assertEqual(_normalize_connection_id(None, "", "ca_callback", "ca_fallback"), "ca_callback")

    @patch("app.routers.integrations.time.sleep")
    @patch("app.routers.integrations.composio_client.get_connection")
    def test_activation_polling_stops_when_connection_is_active(self, get_connection, sleep):
        initializing = Mock(status="INITIALIZING")
        active = Mock(status="ACTIVE", id="ca_active", user_id="workspace")
        get_connection.side_effect = [initializing, active]
        result = _get_active_connection("workspace", "jira", "ca_active")
        self.assertIs(result, active)
        self.assertEqual(get_connection.call_count, 2)
        sleep.assert_called_once()


if __name__ == "__main__":
    unittest.main()
