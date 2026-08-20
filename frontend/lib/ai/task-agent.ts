import { generateGroqCompletion } from './groq';

export interface JiraTask { key: string; summary: string; status?: string | null; assignee?: string | null; priority?: string | null; url?: string | null; metadata?: Record<string, unknown>; }
export interface JiraProposal { action: 'CREATE' | 'UPDATE'; issueKey?: string; summary?: string; description?: string; projectKey?: string; status?: string; priority?: string; }
export interface TaskAgentResult { action: 'READ' | 'CREATE' | 'UPDATE'; answer: string; tasks?: JiraTask[]; updatedTask?: JiraTask; requiresConfirmation?: boolean; proposal?: JiraProposal; }

const DEFAULT_PROJECT_KEY = process.env.NEXT_PUBLIC_DEFAULT_JIRA_PROJECT_KEY || 'KAN';

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

function requestedNumericProjectId(query: string): string | undefined {
  return query.match(/\b(?:in|project)\s+(\d+)\b/i)?.[1];
}

async function contextAwareTitle(request: string, context: string): Promise<string> {
  const generated = await generateGroqCompletion(
    'Create one concise Jira task title. Return only the title, no quotes, markdown, period, or explanation. Use 4-10 words and describe the actual work, not the words create ticket.\nRecent context:\n' + context.slice(-4000),
    request,
  );
  return generated?.split('\n')[0]?.replace(/^['"*]+|['"*.]+$/g, '').trim().slice(0, 120) || '';
}

export async function processTaskQuery(userQuery: string, intent: 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE', authorization?: string, confirmed = false, proposal?: JiraProposal, context = ''): Promise<TaskAgentResult> {
  if (!authorization) return { action: 'READ', answer: 'Please sign in before using Jira task actions.' };
  try {
    if (intent === 'TASK_QUERY') {
      const projectKey = requestedProjectKey(userQuery);
      const tasks = (await taskRequest(projectKey ? '/tasks/issues?project_key=' + encodeURIComponent(projectKey) : '/tasks', authorization)).tasks as JiraTask[];
      const completion = await generateGroqCompletion('Return only a concise clean Markdown answer. Never show reasoning, analysis, drafts, XML think tags, or phrases such as Final Output Generation. Summarize only these Jira issues accurately and do not invent issues.\n' + JSON.stringify(tasks), userQuery);
      return { action: 'READ', answer: completion || (tasks.length ? 'Here are your assigned Jira tasks:\n\n' + tasks.map(t => '- **[' + t.key + ']** ' + t.summary + ' _' + (t.status || 'Unknown') + '_').join('\n') : 'No assigned Jira issues were found.'), tasks };
    }
    if (intent === 'TASK_CREATE') {
      if (requestedNumericProjectId(userQuery)) return { action: 'CREATE', answer: 'Jira requires a project key such as **KAN** here. Numeric project IDs such as **10000** cannot be used as project keys.' };
      let projectKey = requestedProjectKey(userQuery);
      if (!projectKey) {
        const projects = (await taskRequest('/tasks/projects', authorization)).projects as Array<{ key: string; name: string }>;
        const configured = projects.find(project => project.key.toUpperCase() === DEFAULT_PROJECT_KEY.toUpperCase());
        if (configured) projectKey = configured.key;
        else if (projects.length === 1) projectKey = projects[0].key;
        else {
          const choices = projects.slice(0, 20).map(project => '**' + project.key + '** - ' + project.name).join('\n');
          return { action: 'CREATE', answer: projects.length ? 'Which Jira project should receive this ticket? Reply with its project key.\n\n' + choices : 'No accessible Jira projects were returned.' };
        }
      }
      const summary = proposal?.summary || await contextAwareTitle(userQuery, context) || userQuery.replace(/create|new|ticket|jira|bug|task/gi, '').replace(/\b(?:in|project)\s+[A-Z][A-Z0-9]+\b/gi, '').replace(/\s+/g, ' ').trim() || 'New issue';
      if (!confirmed) return { action: 'CREATE', answer: `I’m ready to create **${summary}** in **${projectKey}**. Please confirm this Jira action.`, requiresConfirmation: true, proposal: { action: 'CREATE', summary, description: userQuery, projectKey } };
      const task = (await taskRequest('/tasks', authorization, { method: 'POST', body: JSON.stringify({ summary, description: userQuery, project_key: projectKey }) })).task as JiraTask;
      return { action: 'CREATE', answer: 'Created Jira ticket **' + task.key + '** in project **' + projectKey + '**: ' + task.summary + '.', updatedTask: task, tasks: [task] };
    }
    const key = userQuery.match(/([A-Z][A-Z0-9]+-\d+)/i)?.[1]?.toUpperCase();
    if (!key) return { action: 'UPDATE', answer: 'Please include a Jira issue key, such as **PROJ-123**, for the update.' };
    const status = proposal?.status || userQuery.match(/(?:to|as|status)\s+(To Do|In Progress|In Review|Done)/i)?.[1] || (/(done|complete|completed|close)/i.test(userQuery) ? 'Done' : '');
    if (!status) return { action: 'UPDATE', answer: 'Please specify a target Jira status, such as **Done** or **In Progress**.' };
    if (!confirmed) return { action: 'UPDATE', answer: `I’m ready to update **${key}** to **${status}**. Please confirm this Jira action.`, requiresConfirmation: true, proposal: { action: 'UPDATE', issueKey: key, status } };
    const task = (await taskRequest('/tasks/' + key, authorization, { method: 'PATCH', body: JSON.stringify({ status }) })).task as JiraTask;
    return { action: 'UPDATE', answer: 'Updated Jira ticket **' + task.key + '** to **' + (task.status || status) + '**.', updatedTask: task, tasks: [task] };
  } catch (error) {
    return { action: intent === 'TASK_CREATE' ? 'CREATE' : intent === 'TASK_UPDATE' ? 'UPDATE' : 'READ', answer: error instanceof Error ? error.message : 'Jira task action failed.' };
  }
}
