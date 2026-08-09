import { generateGroqCompletion } from './groq';

export interface JiraTask { key: string; summary: string; status?: string | null; assignee?: string | null; priority?: string | null; url?: string | null; metadata?: Record<string, unknown>; }
export interface JiraProject { key: string; name: string; project_type?: string | null; url?: string | null; }
export interface TaskAgentResult { action: 'READ' | 'CREATE' | 'UPDATE'; answer: string; tasks?: JiraTask[]; updatedTask?: JiraTask; }

async function taskRequest(path: string, authorization: string, init?: RequestInit) {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: authorization, ...(init?.headers || {}) }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || 'Jira task request failed');
  return body;
}

function requestedProjectKey(query: string): string | undefined {
  const issueKey = query.match(/\b([A-Z][A-Z0-9]+)-\d+\b/i)?.[1];
  const explicit = query.match(/\b(?:in|project)\s+([A-Z][A-Z0-9]+)\b/i)?.[1];
  return (explicit || issueKey)?.toUpperCase();
}

export async function processTaskQuery(userQuery: string, intent: 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE', authorization?: string): Promise<TaskAgentResult> {
  if (!authorization) return { action: 'READ', answer: 'Please sign in before using Jira task actions.' };
  try {
    if (intent === 'TASK_QUERY') {
      const projectKey = requestedProjectKey(userQuery);
      const tasks = (await taskRequest(projectKey ? '/tasks/issues?project_key=' + encodeURIComponent(projectKey) : '/tasks', authorization)).tasks as JiraTask[];
      const completion = await generateGroqCompletion('Summarize only these assigned Jira issues accurately. Do not invent issues.\n' + JSON.stringify(tasks), userQuery);
      return { action: 'READ', answer: completion || (tasks.length ? 'Here are your assigned Jira tasks:\n\n' + tasks.map(t => '- **[' + t.key + ']** ' + t.summary + ' _' + (t.status || 'Unknown') + '_').join('\n') : 'No assigned Jira issues were found.'), tasks };
    }
    if (intent === 'TASK_CREATE') {
      let projectKey = requestedProjectKey(userQuery);
      if (!projectKey) {
        const projects = (await taskRequest('/tasks/projects', authorization)).projects as JiraProject[];
        if (projects.length === 1) projectKey = projects[0].key;
        else {
          const choices = projects.slice(0, 20).map(p => '**' + p.key + '** - ' + p.name).join('\n');
          return { action: 'CREATE', answer: projects.length ? 'Which Jira project should receive this ticket? Reply with its project key.\n\n' + choices : 'No Jira projects are available to your connected account.' };
        }
      }
      const summary = userQuery.replace(/create|new|ticket|jira|bug|task/gi, '').replace(/\b(?:in|project)\s+[A-Z][A-Z0-9]+\b/gi, '').replace(/\s+/g, ' ').trim() || 'New issue';
      const task = (await taskRequest('/tasks', authorization, { method: 'POST', body: JSON.stringify({ summary, description: userQuery, project_key: projectKey }) })).task as JiraTask;
      return { action: 'CREATE', answer: 'Created Jira ticket **' + task.key + '** in project **' + projectKey + '**: ' + task.summary + '.', updatedTask: task, tasks: [task] };
    }
    const key = userQuery.match(/([A-Z][A-Z0-9]+-\d+)/i)?.[1]?.toUpperCase();
    if (!key) return { action: 'UPDATE', answer: 'Please include a Jira issue key, such as **PROJ-123**, for the update.' };
    const status = userQuery.match(/(?:to|as|status)\s+(To Do|In Progress|In Review|Done)/i)?.[1] || (/(done|complete|completed|close)/i.test(userQuery) ? 'Done' : '');
    if (!status) return { action: 'UPDATE', answer: 'Please specify a target Jira status, such as **Done** or **In Progress**.' };
    const task = (await taskRequest('/tasks/' + key, authorization, { method: 'PATCH', body: JSON.stringify({ status }) })).task as JiraTask;
    return { action: 'UPDATE', answer: 'Updated Jira ticket **' + task.key + '** to **' + (task.status || status) + '**.', updatedTask: task, tasks: [task] };
  } catch (error) {
    return { action: intent === 'TASK_CREATE' ? 'CREATE' : intent === 'TASK_UPDATE' ? 'UPDATE' : 'READ', answer: error instanceof Error ? error.message : 'Jira task action failed.' };
  }
}
