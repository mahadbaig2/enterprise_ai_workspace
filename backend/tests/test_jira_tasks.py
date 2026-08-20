import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.tasks import _project_key, _search_jira


class JiraTaskHelpersTests(unittest.TestCase):
    def test_project_key_rejects_numeric_project_ids(self):
        with self.assertRaises(HTTPException):
            _project_key("10000")

    def test_project_key_normalizes_valid_keys(self):
        self.assertEqual(_project_key(" kan "), "KAN")

    @patch("app.routers.tasks.composio_client.proxy_request")
    def test_unscoped_search_uses_assigned_user_jql(self, proxy_request):
        proxy_request.return_value = {"issues": []}
        _search_jira("connected-account")
        body = proxy_request.call_args.kwargs["body"]
        self.assertEqual(
            body["jql"],
            "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
        )

    @patch("app.routers.tasks.composio_client.proxy_request")
    def test_project_search_remains_assigned_and_scoped(self, proxy_request):
        proxy_request.return_value = {"issues": []}
        _search_jira("connected-account", "KAN")
        body = proxy_request.call_args.kwargs["body"]
        self.assertEqual(
            body["jql"],
            "project = KAN AND assignee = currentUser() ORDER BY updated DESC",
        )


if __name__ == "__main__":
    unittest.main()
