import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, "backend")

from app.agents.workspace_graph import _heuristic_intent
from app.services.jira import DEFAULT_JIRA_PROJECT_ID, DEFAULT_JIRA_PROJECT_KEY, create_issue, list_projects, search_issues


class WorkspaceGraphRoutingTests(unittest.TestCase):
    def test_routes_workspace_inventory_to_overview(self):
        self.assertEqual(_heuristic_intent("What is in our connected knowledge base?"), "workspace_overview")

    def test_routes_jira_queries_to_jira_agent(self):
        self.assertEqual(_heuristic_intent("Show me all Jira tickets"), "jira_query")
        self.assertEqual(_heuristic_intent("Create a Jira task for the login bug"), "jira_create")
        self.assertEqual(_heuristic_intent("Update PROJ-123 to Done"), "jira_update")


class JiraPaginationTests(unittest.TestCase):
    def test_default_jira_project(self):
        self.assertEqual(DEFAULT_JIRA_PROJECT_KEY, "KAN")
        self.assertEqual(DEFAULT_JIRA_PROJECT_ID, "10000")

    @patch("app.services.jira.save_task")
    @patch("app.services.jira.connection_id", return_value="connection")
    @patch("app.services.jira.composio_client.proxy_request")
    def test_create_reads_created_issue_back_from_jira(self, proxy_request: Mock, _: Mock, save_task: Mock):
        proxy_request.side_effect = [
            {"data": '{"key": "KAN-1", "self": "https://jira.example/rest/api/3/issue/KAN-1"}'},
            {"data": '{"key": "KAN-1", "self": "https://jira.example/rest/api/3/issue/KAN-1", "fields": "{\\"summary\\": \\"Demo ticket\\", \\"status\\": \\"Open\\", \\"priority\\": \\"High\\"}"}'},
        ]
        task = create_issue("workspace", "Demo ticket", "Description", priority="High")
        create_body = proxy_request.call_args_list[0].kwargs["body"]
        self.assertEqual(create_body["fields"]["project"], {"id": "10000"})
        self.assertEqual(proxy_request.call_args_list[1].kwargs["method"], "GET")
        self.assertEqual((task.key, task.status, task.priority), ("KAN-1", "Open", "High"))
        save_task.assert_called_once()

    @patch("app.services.jira.connection_id", return_value="connection")
    @patch("app.services.jira.composio_client.proxy_request")
    def test_search_issues_reads_all_pages(self, proxy_request: Mock, _: Mock):
        proxy_request.side_effect = [
            {"issues": [{"key": "PROJ-1"}], "total": 2},
            {"issues": [{"key": "PROJ-2"}], "total": 2},
        ]
        issues = search_issues("workspace", max_results=1)
        self.assertEqual([item["key"] for item in issues], ["PROJ-1", "PROJ-2"])
        self.assertEqual(proxy_request.call_count, 2)

    @patch("app.services.jira.connection_id", return_value="connection")
    @patch("app.services.jira.composio_client.proxy_request")
    def test_project_search_accepts_json_string_payload(self, proxy_request: Mock, _: Mock):
        proxy_request.return_value = '{"values": [{"key": "AQL", "name": "AQL"}]}'
        projects = list_projects("workspace")
        self.assertEqual([(item.key, item.name) for item in projects], [("AQL", "AQL")])


if __name__ == "__main__":
    unittest.main()
