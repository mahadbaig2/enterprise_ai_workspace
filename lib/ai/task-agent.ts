import { generateGroqCompletion } from './groq';

export interface JiraTask {
  key: string;
  summary: string;
  status: 'To Do' | 'In Progress' | 'In Review' | 'Done';
  assignee: string;
  priority: 'Low' | 'Medium' | 'High' | 'Highest';
  url: string;
}

export interface TaskAgentResult {
  action: 'READ' | 'CREATE' | 'UPDATE';
  answer: string;
  tasks?: JiraTask[];
  updatedTask?: JiraTask;
}

// Sample mock state for live interactive demonstration
const mockTasksStore: JiraTask[] = [
  {
    key: 'PROJ-101',
    summary: 'Implement OAuth authentication for Jira integration',
    status: 'In Progress',
    assignee: 'Current User',
    priority: 'High',
    url: 'https://atlassian.net/browse/PROJ-101',
  },
  {
    key: 'PROJ-102',
    summary: 'Fix layout misalignment on mobile chat view',
    status: 'To Do',
    assignee: 'Current User',
    priority: 'Medium',
    url: 'https://atlassian.net/browse/PROJ-102',
  },
  {
    key: 'PROJ-103',
    summary: 'Configure Supabase pgvector hybrid search index',
    status: 'Done',
    assignee: 'Current User',
    priority: 'High',
    url: 'https://atlassian.net/browse/PROJ-103',
  },
];

export async function processTaskQuery(
  userQuery: string,
  intent: 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE'
): Promise<TaskAgentResult> {
  
  if (intent === 'TASK_UPDATE') {
    // Extract ticket key if present in string (e.g., PROJ-101, ABC-123)
    const keyMatch = userQuery.match(/([A-Z]+-[0-9]+)/i);
    const key = keyMatch ? keyMatch[1].toUpperCase() : 'PROJ-101';
    
    let target = mockTasksStore.find(t => t.key.toUpperCase() === key);
    if (!target) {
      target = mockTasksStore[0];
    }
    
    // Update target status to Done or specified status
    target.status = 'Done';

    const systemPrompt = `You are the Jira Task Agent. Generate a polite, structured confirmation confirming that Jira issue ${target.key} status was updated to Done.`;
    const summary = await generateGroqCompletion(systemPrompt, userQuery);

    return {
      action: 'UPDATE',
      answer: summary || `✅ Jira ticket **${target.key}** (*${target.summary}*) has been marked as **Done**.`,
      updatedTask: target,
    };
  }

  if (intent === 'TASK_CREATE') {
    const newKey = `PROJ-${Math.floor(100 + Math.random() * 900)}`;
    const newTask: JiraTask = {
      key: newKey,
      summary: userQuery.replace(/create|ticket|jira|bug/gi, '').trim() || 'New Issue',
      status: 'To Do',
      assignee: 'Current User',
      priority: 'High',
      url: `https://atlassian.net/browse/${newKey}`,
    };
    mockTasksStore.unshift(newTask);

    return {
      action: 'CREATE',
      answer: `🚀 Created Jira ticket **${newTask.key}**: "${newTask.summary}" assigned to you.`,
      updatedTask: newTask,
    };
  }

  // TASK_QUERY (Default)
  const systemPrompt = `You are the Task Agent of Enterprise AI Workspace.
Summarize the following Jira tasks clearly for the user in bullet points with status badges.
TASKS:
${JSON.stringify(mockTasksStore, null, 2)}`;

  const completion = await generateGroqCompletion(systemPrompt, userQuery);

  const formattedAnswer = completion || 
    `Here are your current assigned Jira tasks:\n\n` +
    mockTasksStore.map(t => `- **[${t.key}]** ${t.summary} \`[Status: ${t.status}]\``).join('\n');

  return {
    action: 'READ',
    answer: formattedAnswer,
    tasks: mockTasksStore,
  };
}
