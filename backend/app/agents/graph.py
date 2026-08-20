from __future__ import annotations

import json
import os
import re
from typing import Any, Literal, TypedDict

import httpx
from langgraph.graph import END, START, StateGraph

from app.agents.jira_tools import create_issue, list_projects, search_assigned
from app.models.rag import RagSearchRequest
from app.services.rag import search_workspace

Route = Literal["knowledge", "jira", "general"]


class AgentState(TypedDict, total=False):
    query: str
    context: str
    workspace_id: str
    confirmation: dict[str, Any] | None
    route: Route
    intent: str
    answer: str
    citations: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    retrieval_status: str
    requires_confirmation: bool
    proposal: dict[str, Any]


def _supervisor(state: AgentState) -> AgentState:
    query = state["query"]
    decision = _llm_json(f"Classify this workspace request as exactly one route: knowledge, jira, or general. Return JSON with route and intent only. Request: {query}")
    route = decision.get("route") if decision else None
    lower = query.lower()
    task_language = any(word in lower for word in ("jira", "task", "issue", "ticket", "project"))
    # Keep an explicit task request on the Jira path even if an optional
    # classifier model is unavailable or returns an ambiguous route.
    if route not in {"knowledge", "jira", "general"} or task_language:
        route = "jira" if task_language else "knowledge"
    intent = str(decision.get("intent", "WORKSPACE_QUERY")) if decision else "WORKSPACE_QUERY"
    return {"route": route, "intent": intent}


def _knowledge_agent(state: AgentState) -> AgentState:
    result = search_workspace(state["workspace_id"], RagSearchRequest(query=state["query"], match_count=8))
    context = "\n\n".join(f"[{item.title}] {item.content}" for item in result.results)
    prompt = f"""Answer the user using only the workspace context. If it is insufficient, say so.
Return a complete, self-contained, readable Markdown response. Never output internal
field names such as heading_1, heading_2, heading_3, quote, or block_type. Convert
those concepts into normal Markdown headings and blockquotes. Do not stop midway
through a sentence or section; finish every requested part and include actionable
next steps when the user is asking for a script or procedure. Do not reveal hidden
reasoning.
Context:
{context}
User: {state['query']}"""
    answer = _llm_text(prompt) or _readable_retrieval_fallback(state["query"], result.results)
    return {"answer": answer, "citations": [citation.model_dump() for citation in result.citations], "retrieval_status": result.reranker}


def _readable_retrieval_fallback(query: str, results: list[Any]) -> str:
    """Return useful, complete Markdown when the optional LLM is unavailable."""
    if not results:
        return "I couldn't find supporting information in the connected workspace."

    sections: list[str] = [f"## Information related to: {query.strip()}"]
    for result in results[:4]:
        title = str(getattr(result, "title", "Workspace source") or "Workspace source").strip()
        content = re.sub(r"\s+", " ", str(getattr(result, "content", "") or "")).strip()
        if not content:
            continue
        # Chunks can begin or end mid-sentence. Keep only complete sentences
        # so the fallback never presents a visibly broken answer.
        if len(content) > 900:
            content = content[:900]
            boundary = max(content.rfind("."), content.rfind("!"), content.rfind("?"))
            if boundary > 300:
                content = content[: boundary + 1]
        sections.append(f"### {title}\n{content}")
    return "\n\n".join(sections)


def _jira_agent(state: AgentState) -> AgentState:
    query = state["query"]
    confirmation = state.get("confirmation") or {}
    confirmed_proposal = confirmation.get("proposal") or {}
    # Accept proposals from both the current UI contract and older clients.
    # This keeps an in-progress confirmation usable after a frontend refresh.
    if confirmed_proposal.get("operation") == "create" and not confirmed_proposal.get("action"):
        confirmed_proposal = {**confirmed_proposal, "action": "CREATE"}
    lower = query.lower()
    if any(word in lower for word in ("create", "add", "new ticket", "new issue")):
        match = re.search(r"(?:called|titled|summary)\s+['\"]?(.+?)['\"]?$", query, re.I)
        summary = str(confirmed_proposal.get("summary") or (match.group(1).strip() if match else _ticket_summary(query, state.get("context", "")))).strip().rstrip(".")
        if summary.lower() in {"undefined", "null", "none"}:
            summary = _ticket_summary(query, state.get("context", ""))
        project_match = re.search(r"(?:project|under)\s+([A-Za-z][A-Za-z0-9_]*)", query, re.I)
        project = str(confirmed_proposal.get("projectKey") or confirmed_proposal.get("project_key") or (project_match.group(1).upper() if project_match else os.getenv("DEFAULT_JIRA_PROJECT_KEY", "").upper()))
        proposal = {"action": "CREATE", "summary": summary, "description": query, "projectKey": project, "issueType": "Task", "priority": "Medium"}
        if confirmation.get("approved") is not True:
            return {"answer": f"I suggest creating Jira task **{summary}** in project **{project or '[choose a project]'}**. Review the details and use the confirmation button below.", "requires_confirmation": True, "proposal": proposal, "tasks": [{**proposal, "requiresConfirmation": True}]}
        if not project:
            projects = list_projects(state["workspace_id"])
            if len(projects) == 1:
                project = projects[0]["key"]
            else:
                return {"answer": "Which Jira project key should I use?", "requires_confirmation": True, "proposal": proposal, "tasks": [{**proposal, "requiresConfirmation": True}]}
        task = create_issue(state["workspace_id"], summary=summary, project_key=project, description=str(proposal.get("description") or query), issue_type="Task", priority="Medium")
        return {"answer": f"Created Jira task **{task.key}**: [{task.summary}]({task.url})", "tasks": [task.model_dump()]}
    tasks = search_assigned(state["workspace_id"])
    return {"answer": f"I found {len(tasks)} open Jira task(s) assigned to you.", "tasks": [task.model_dump() for task in tasks]}


def _ticket_summary(query: str, context: str = "") -> str:
    """Let the agent turn the conversation request into a concise Jira title."""
    generated = _llm_text(
        "Create one concise Jira task summary from this request. Return only the title, "
        "without quotes, markdown, a period, or explanation. Use 4-10 words. "
        "Reflect the actual work requested, not the words 'create ticket'.\n"
        "Recent conversation context:\n" + context[-4000:] + "\nCurrent request: " + query
    ).strip().splitlines()[0] if os.getenv("GROQ_API_KEY") else ""
    if generated:
        return generated[:120].rstrip(".")
    fallback = re.sub(r"\b(create|add|new|jira|ticket|task|issue|please)\b", "", query, flags=re.I)
    return re.sub(r"\s+", " ", fallback).strip().capitalize()[:120] or "New workspace task"


def _general_agent(state: AgentState) -> AgentState:
    answer = _llm_text("Return a complete, self-contained answer in readable Markdown. Do not use internal labels or reveal hidden reasoning.\nUser: " + state["query"]) or "I can help with your connected workspace, knowledge base, and Jira tasks."
    return {"answer": answer}


def _route(state: AgentState) -> str:
    return state["route"]


def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("supervisor", _supervisor)
    graph.add_node("knowledge", _knowledge_agent)
    graph.add_node("jira", _jira_agent)
    graph.add_node("general", _general_agent)
    graph.add_edge(START, "supervisor")
    graph.add_conditional_edges("supervisor", _route, {"knowledge": "knowledge", "jira": "jira", "general": "general"})
    graph.add_edge("knowledge", END)
    graph.add_edge("jira", END)
    graph.add_edge("general", END)
    return graph.compile()


def run_agent_graph(query: str, workspace_id: str, confirmation: dict[str, Any] | None = None, context: str = "") -> AgentState:
    return build_graph().invoke({"query": query, "workspace_id": workspace_id, "confirmation": confirmation, "context": context})


def _llm_json(prompt: str) -> dict[str, Any]:
    text = _llm_text(prompt)
    if not text:
        return {}
    try:
        return json.loads(re.search(r"\{.*\}", text, re.S).group(0))  # type: ignore[union-attr]
    except (AttributeError, json.JSONDecodeError):
        return {}


def _llm_text(prompt: str) -> str:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key or api_key.startswith("your-"):
        return ""
    try:
        messages: list[dict[str, str]] = [{"role": "user", "content": prompt}]
        answer = ""
        for attempt in range(2):
            response = httpx.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {api_key}"}, json={"model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"), "messages": messages, "temperature": 0.1, "max_tokens": int(os.getenv("AGENT_MAX_OUTPUT_TOKENS", "6000"))}, timeout=60)
            response.raise_for_status()
            choice = response.json()["choices"][0]
            part = str(choice["message"]["content"])
            answer += part
            if choice.get("finish_reason") != "length" or attempt == 1:
                break
            messages.extend([{"role": "assistant", "content": part}, {"role": "user", "content": "Continue exactly where you stopped. Do not repeat any previous text and finish the response completely."}])
        return answer
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return ""
