import os
import re
from typing import Any, Literal, TypedDict

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from app.models.rag import RagSearchRequest
from app.services.jira import DEFAULT_JIRA_PROJECT_ID, DEFAULT_JIRA_PROJECT_KEY, create_issue, issue_to_task, list_projects, search_issues, update_issue
from app.services.rag import search_workspace
from app.utils.supabase_client import get_admin_client


Intent = Literal["jira_query", "jira_create", "jira_update", "workspace_overview", "knowledge_query", "general"]


class IntentClassification(BaseModel):
    intent: Intent = Field(description="The single best route for the user request.")


class AgentState(TypedDict, total=False):
    query: str
    context: str
    workspace_id: str
    intent: Intent
    routing: dict[str, str]
    confirmation: dict[str, Any] | None
    content: str
    citations: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    retrieval_status: str
    error: str | None


def _model() -> ChatGroq:
    return ChatGroq(
        api_key=os.getenv("GROQ_API_KEY"),
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        temperature=0.2,
        max_tokens=2048,
    )


def _clean_answer(value: str) -> str:
    return re.sub(r"<(?:think|thinking|analysis)\b[\s\S]*?(?:</(?:think|thinking|analysis)>|$)", "", value, flags=re.IGNORECASE).strip()


def _heuristic_intent(query: str) -> Intent | None:
    lower = query.lower()
    if any(term in lower for term in ("connected knowledge base", "what is connected", "what's connected", "available sources", "knowledge base contents", "what do we have connected")):
        return "workspace_overview"
    if re.search(r"\b(create|new|file|open)\b.*\b(ticket|bug|task|issue)\b", lower):
        return "jira_create"
    if re.search(r"\b(update|change|mark|move|close|complete|status)\b", lower) and re.search(r"\b(jira|ticket|task|issue|[a-z][a-z0-9]+-\d+)\b", lower):
        return "jira_update"
    if re.search(r"\b(jira|ticket|task|issue|assigned)\b", lower):
        return "jira_query"
    if re.search(r"\b(hi|hello|hey|thanks|thank you)\b", lower) and len(lower.split()) < 12:
        return "general"
    return None


def classify_intent(state: AgentState) -> dict[str, Any]:
    intent = _heuristic_intent(state["query"])
    if intent is None:
        try:
            result = _model().with_structured_output(IntentClassification).invoke([
                SystemMessage(content=(
                    "Classify the request into exactly one intent: jira_query, jira_create, jira_update, "
                    "workspace_overview, knowledge_query, or general. Use workspace_overview for questions "
                    "about what sources/documents/data are connected or available. Use jira_query for fetching "
                    "or summarizing Jira issues. Return only the structured classification."
                )),
                HumanMessage(content=state["query"]),
            ])
            intent = result.intent
        except Exception:
            intent = "knowledge_query"
    target = "jira" if intent.startswith("jira_") else "overview" if intent == "workspace_overview" else intent.replace("_query", "")
    return {"intent": intent, "routing": {"intent": intent, "targetAgent": target}}


def _workspace_overview(state: AgentState) -> dict[str, Any]:
    db = get_admin_client()
    integrations = db.table("integrations").select("provider,status,last_sync_at,last_sync_status,last_sync_counts").eq("workspace_id", state["workspace_id"]).execute().data or []
    counts: dict[str, int] = {"google_drive": 0, "notion": 0, "jira": 0}
    titles: dict[str, list[str]] = {key: [] for key in counts}
    total_documents = 0
    for source in counts:
        count_result = db.table("documents").select("id", count="exact", head=True).eq("workspace_id", state["workspace_id"]).eq("source", source).execute()
        counts[source] = count_result.count or 0
        total_documents += counts[source]
        title_rows = db.table("documents").select("title").eq("workspace_id", state["workspace_id"]).eq("source", source).limit(3).execute().data or []
        titles[source] = [row["title"] for row in title_rows if row.get("title")]
    status_by_provider = {row.get("provider"): row for row in integrations}
    lines = ["Your connected workspace knowledge base contains:", ""]
    for source, label in (("google_drive", "Google Drive"), ("notion", "Notion"), ("jira", "Jira")):
        row = status_by_provider.get(source, {})
        status = row.get("status", "not configured")
        count = counts[source]
        sync = row.get("last_sync_status") or "not synced"
        lines.append(f"- **{label}:** {status}; {count} indexed document{'s' if count != 1 else ''}; sync status: {sync}.")
        if titles[source]:
            lines.append("  Examples: " + "; ".join(titles[source]))
    if not total_documents:
        lines.extend(["", "No synced documents are currently indexed. Connect a provider and run synchronization to populate the workspace."])
    return {"content": "\n".join(lines), "citations": [], "retrieval_status": "ok"}


def _knowledge(state: AgentState) -> dict[str, Any]:
    try:
        result = search_workspace(state["workspace_id"], RagSearchRequest(query=state["query"], match_count=8))
        citations = [item.model_dump() for item in result.citations]
        if not result.results:
            return {"content": "I could not find this information in the connected workspace documents.", "citations": [], "retrieval_status": "no_evidence"}
        context = "\n\n".join(f"[Source {index + 1}: {item.title}]\n{item.content}" for index, item in enumerate(result.results))
        response = _model().invoke([
            SystemMessage(content=(
                "Answer directly from the provided workspace context. Synthesize the answer; do not list links "
                "instead of answering. Cite factual claims with [Source X]. Never output private reasoning, "
                "chain-of-thought, or think tags. Return only the final answer.\n\nCONTEXT:\n" + context[:18000]
            )),
            HumanMessage(content=state["query"]),
        ])
        answer = _clean_answer(str(response.content))
        return {"content": answer or "The connected documents did not contain a usable answer.", "citations": citations, "retrieval_status": "ok"}
    except Exception as exc:
        return {"content": "The connected knowledge search is temporarily unavailable.", "citations": [], "retrieval_status": "retrieval_failure", "error": str(exc)}


def _jira(state: AgentState) -> dict[str, Any]:
    intent = state["intent"]
    confirmation = state.get("confirmation") or {}
    proposal = confirmation.get("proposal") or {}
    if intent == "jira_create":
        project = proposal.get("projectKey") or (re.search(r"\b(?:in|project)\s+([A-Z][A-Z0-9]+)\b", state["query"], re.I) or [None, None])[1] or DEFAULT_JIRA_PROJECT_KEY
        if not project:
            projects = list_projects(state["workspace_id"])
            if len(projects) != 1:
                choices = "\n".join(f"- **{item.key}** — {item.name}" for item in projects[:20])
                return {"content": "Which Jira project should receive this ticket? Reply with its project key.\n\n" + (choices or "No Jira projects are available."), "tasks": []}
            project = projects[0].key
        summary = proposal.get("summary") or re.sub(r"\b(create|new|ticket|jira|bug|task)\b", "", state["query"], flags=re.I).strip() or "New issue"
        task_proposal = {"action": "CREATE", "summary": summary, "description": state["query"], "projectKey": project}
        if not confirmation.get("approved"):
            return {"content": f"I’m ready to create **{summary}** in **{project}**. Please confirm this Jira action.", "tasks": [{**task_proposal, "requiresConfirmation": True}]}
        try:
            task = create_issue(state["workspace_id"], summary, state["query"], project, project_id=DEFAULT_JIRA_PROJECT_ID)
        except Exception as exc:
            return {"content": f"I couldn’t create the Jira ticket in **{project}**: {exc}", "tasks": [], "retrieval_status": "action_failed", "error": str(exc)}
        return {"content": f"Created Jira ticket **{task.key}** in project **{project}** and read it back from Jira: {task.summary} ({task.status or 'Unknown'}).", "tasks": [task.model_dump()]}
    if intent == "jira_update":
        key_match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", state["query"], re.I)
        key = proposal.get("issueKey") or (key_match.group(1).upper() if key_match else None)
        status_match = re.search(r"(?:to|as|status)\s+(To Do|In Progress|In Review|Done)", state["query"], re.I)
        status_name = proposal.get("status") or (status_match.group(1) if status_match else None)
        if not key or not status_name:
            return {"content": "Please provide a Jira issue key and target status, such as **PROJ-123** to **Done**.", "tasks": []}
        task_proposal = {"action": "UPDATE", "issueKey": key, "status": status_name}
        if not confirmation.get("approved"):
            return {"content": f"I’m ready to update **{key}** to **{status_name}**. Please confirm this Jira action.", "tasks": [{**task_proposal, "requiresConfirmation": True}]}
        task = update_issue(state["workspace_id"], key, status_name)
        return {"content": f"Updated Jira ticket **{task.key}** to **{task.status or status_name}**.", "tasks": [task.model_dump()]}
    try:
        project_match = re.search(r"\b(?:in|project)\s+([A-Z][A-Z0-9]+)\b", state["query"], re.I)
        jql = f"project = {project_match.group(1).upper()} ORDER BY updated DESC" if project_match else "project IS NOT EMPTY ORDER BY updated DESC"
        issues = search_issues(state["workspace_id"], jql=jql)
        tasks = [issue_to_task(issue).model_dump() for issue in issues]
        if not tasks:
            rows = get_admin_client().table("jira_issues").select("issue_key,summary,status,priority,assignee_email,url,metadata").eq("workspace_id", state["workspace_id"]).order("updated_at", desc=True).limit(100).execute().data or []
            tasks = [{
                "key": row.get("issue_key", ""),
                "summary": row.get("summary") or row.get("issue_key", "Untitled issue"),
                "status": row.get("status"),
                "priority": row.get("priority"),
                "assignee": row.get("assignee_email"),
                "url": row.get("url"),
                "metadata": row.get("metadata") or {},
            } for row in rows]
            if tasks:
                return {"content": "Here are the synchronized Jira issues:\n\n" + "\n".join(f"- **[{task['key']}]** {task['summary']} — {task.get('status') or 'Unknown'}" for task in tasks), "tasks": tasks, "retrieval_status": "ok"}
        if not tasks:
            return {"content": "Jira is connected, but no accessible issues were returned for this request.", "tasks": [], "retrieval_status": "no_evidence"}
        answer = "Here are the accessible Jira issues:\n\n" + "\n".join(f"- **[{task['key']}]** {task['summary']} — {task.get('status') or 'Unknown'}" for task in tasks)
        return {"content": answer, "tasks": tasks, "retrieval_status": "ok"}
    except Exception as exc:
        return {"content": str(exc), "tasks": [], "retrieval_status": "retrieval_failure", "error": str(exc)}


def _general(_: AgentState) -> dict[str, Any]:
    return {"content": "Hello! How can I help with your connected workspace?", "citations": [], "tasks": [], "retrieval_status": "ok"}


def _route(state: AgentState) -> str:
    intent = state["intent"]
    if intent.startswith("jira_"):
        return "jira"
    if intent == "workspace_overview":
        return "overview"
    if intent == "general":
        return "general"
    return "knowledge"


def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", classify_intent)
    builder.add_node("jira", _jira)
    builder.add_node("overview", _workspace_overview)
    builder.add_node("knowledge", _knowledge)
    builder.add_node("general", _general)
    builder.add_edge(START, "classify")
    builder.add_conditional_edges("classify", _route, {"jira": "jira", "overview": "overview", "knowledge": "knowledge", "general": "general"})
    builder.add_edge("jira", END)
    builder.add_edge("overview", END)
    builder.add_edge("knowledge", END)
    builder.add_edge("general", END)
    return builder.compile()


workspace_graph = build_graph()


def run_workspace_graph(query: str, workspace_id: str, context: str = "", confirmation: dict[str, Any] | None = None) -> dict[str, Any]:
    result = workspace_graph.invoke({"query": query, "workspace_id": workspace_id, "context": context, "confirmation": confirmation})
    return {
        "routing": result.get("routing", {"intent": result.get("intent", "knowledge_query"), "targetAgent": "knowledge"}),
        "content": _clean_answer(result.get("content", "")),
        "citations": result.get("citations", []),
        "tasks": result.get("tasks", []),
        "retrievalStatus": result.get("retrieval_status", "ok"),
    }
