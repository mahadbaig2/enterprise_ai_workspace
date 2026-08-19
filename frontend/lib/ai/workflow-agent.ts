import { generateGroqCompletion } from './groq';

export type AgentIntent = 'KNOWLEDGE_QUERY' | 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE' | 'GENERAL';
export interface WorkflowRoutingResult { intent: AgentIntent; reasoning: string; targetAgent: 'knowledge' | 'task' | 'general'; }

function heuristic(prompt: string): WorkflowRoutingResult | undefined {
  const lower = prompt.toLowerCase();
  if (/\b(jira|ticket|task|issue)\b/.test(lower) && /\b(notion|drive|document|docs|knowledge|policy|spec)\b/.test(lower)) return { intent: 'KNOWLEDGE_QUERY', targetAgent: 'knowledge', reasoning: 'Detected a cross-source question; unified retrieval includes Jira and documents.' };
  if (/\b(create|new|file|report)\b.*\b(ticket|bug|task|issue)\b/.test(lower)) return { intent: 'TASK_CREATE', targetAgent: 'task', reasoning: 'Detected Jira creation request.' };
  if (/\b(update|change|mark|move|close|complete|status)\b/.test(lower) && /\b(jira|ticket|task|issue|[a-z][a-z0-9]+-\d+)\b/i.test(lower)) return { intent: 'TASK_UPDATE', targetAgent: 'task', reasoning: 'Detected Jira update request.' };
  if (/\b(jira|ticket|task|issue|assigned)\b/.test(lower)) return { intent: 'TASK_QUERY', targetAgent: 'task', reasoning: 'Detected Jira task request.' };
  if (/\b(hi|hello|hey|thanks|thank you)\b/.test(lower) && lower.split(/\s+/).length < 12) return { intent: 'GENERAL', targetAgent: 'general', reasoning: 'Detected conversational request.' };
  return undefined;
}

export async function classifyIntent(prompt: string): Promise<WorkflowRoutingResult> {
  const quick = heuristic(prompt);
  if (quick) return quick;
  const systemPrompt = 'Classify this Enterprise AI Workspace request. Return ONLY JSON with intent (KNOWLEDGE_QUERY, TASK_QUERY, TASK_UPDATE, TASK_CREATE, GENERAL), reasoning, and targetAgent (knowledge, task, general). Use KNOWLEDGE_QUERY for connected company documents, TASK_QUERY for assigned Jira issues, TASK_UPDATE for changing Jira issues, TASK_CREATE for new Jira issues, and GENERAL for greetings or unrelated conversation.';
  const completion = await generateGroqCompletion(systemPrompt, prompt);
  if (completion) {
    try {
      const parsed = JSON.parse(completion.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim());
      const allowed: AgentIntent[] = ['KNOWLEDGE_QUERY', 'TASK_QUERY', 'TASK_UPDATE', 'TASK_CREATE', 'GENERAL'];
      const intent = allowed.includes(parsed.intent) ? parsed.intent : 'KNOWLEDGE_QUERY';
      return { intent, targetAgent: intent === 'GENERAL' ? 'general' : intent.startsWith('TASK_') ? 'task' : 'knowledge', reasoning: parsed.reasoning || 'Classified from the request.' };
    } catch { console.warn('Workflow Agent returned invalid JSON; using knowledge routing.'); }
  }
  return { intent: 'KNOWLEDGE_QUERY', targetAgent: 'knowledge', reasoning: 'Defaulted to connected workspace knowledge.' };
}
