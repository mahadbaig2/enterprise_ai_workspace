import pytest
from fastapi import HTTPException

from app.agents import graph
from app.agents import jira_tools


def test_supervisor_falls_back_to_jira_for_task_language(monkeypatch):
    monkeypatch.setattr(graph, "_llm_text", lambda prompt: "")
    state = graph._supervisor({"query": "show my open Jira tasks"})
    assert state["route"] == "jira"


def test_explicit_jira_request_overrides_ambiguous_classifier(monkeypatch):
    monkeypatch.setattr(graph, "_llm_text", lambda prompt: '{"route":"knowledge","intent":"KNOWLEDGE_QUERY"}')
    state = graph._supervisor({"query": "show all my assigned Jira tasks"})
    assert state["route"] == "jira"


def test_numeric_project_id_is_not_accepted_as_key():
    with pytest.raises(HTTPException, match="project key is required"):
        jira_tools.normalize_project_key("10000")


def test_lowercase_project_key_is_normalized():
    assert jira_tools.normalize_project_key("kan") == "KAN"


def test_search_uses_restricted_assigned_jql(monkeypatch):
    captured = {}

    class FakeClient:
        def search(self, jql, *, fields, max_results=50):
            captured["jql"] = jql
            return []

    monkeypatch.setattr(jira_tools, "connection_for_workspace", lambda workspace_id: FakeClient())
    assert jira_tools.search_assigned("workspace") == []
    assert "assignee = currentUser()" in captured["jql"]
    assert "statusCategory != Done" in captured["jql"]
    assert "ORDER BY updated DESC" in captured["jql"]
    assert captured["jql"] != "ORDER BY updated DESC"
