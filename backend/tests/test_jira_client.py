from types import SimpleNamespace

from app.lib import jira


def test_jira_client_uses_rest_v3_and_basic_auth(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://example.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "user@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "redacted-test-token")
    captured = {}

    class Response:
        status_code = 200
        is_error = False
        content = b'{"accountId":"abc"}'

        def json(self):
            return {"accountId": "abc"}

    def request(method, url, **kwargs):
        captured.update({"method": method, "url": url, **kwargs})
        return Response()

    monkeypatch.setattr(jira.httpx, "request", request)
    result = jira.JiraClient().myself()
    assert result["accountId"] == "abc"
    assert captured["method"] == "GET"
    assert captured["url"] == "https://example.atlassian.net/rest/api/3/myself"
    assert isinstance(captured["auth"], jira.httpx.BasicAuth)


def test_jira_error_is_redacted(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://example.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "user@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "redacted-test-token")

    class Response:
        status_code = 401
        is_error = True
        content = b'{"errorMessages":["Unauthorized"]}'

        def json(self):
            return {"errorMessages": ["Unauthorized"]}

    monkeypatch.setattr(jira.httpx, "request", lambda *args, **kwargs: Response())
    try:
        jira.JiraClient().myself()
    except jira.JiraApiError as exc:
        assert exc.message == "Unauthorized"
        assert "redacted-test-token" not in str(exc)
    else:
        raise AssertionError("Expected JiraApiError")
