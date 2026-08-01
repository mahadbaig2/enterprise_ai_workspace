import { generateGroqCompletion } from './groq';

export type AgentIntent = 'KNOWLEDGE_QUERY' | 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE' | 'GENERAL';

export interface WorkflowRoutingResult {
  intent: AgentIntent;
  reasoning: string;
  targetAgent: 'knowledge' | 'task' | 'general';
}

export async function classifyIntent(prompt: string): Promise<WorkflowRoutingResult> {
  const systemPrompt = `You are the Workflow Agent of an Enterprise AI Workspace.
Your job is to analyze user requests and determine which agent should handle it.

Select ONE intent from:
- KNOWLEDGE_QUERY: Searching company docs, policies, specs, leave rules, Google Drive, Notion content.
- TASK_QUERY: Viewing or checking assigned Jira tasks/issues.
- TASK_UPDATE: Modifying, changing status, or updating a Jira ticket (e.g., "Mark ABC-123 completed").
- TASK_CREATE: Creating a new Jira ticket or bug report.
- GENERAL: Conversational greeting or non-enterprise question.

Respond STRICTLY in JSON format with keys:
{
  "intent": "KNOWLEDGE_QUERY" | "TASK_QUERY" | "TASK_UPDATE" | "TASK_CREATE" | "GENERAL",
  "reasoning": "Short explanation",
  "targetAgent": "knowledge" | "task" | "general"
}`;

  const completion = await generateGroqCompletion(systemPrompt, prompt);

  if (completion) {
    try {
      // Clean JSON output in case markdown wrappers are included
      const cleaned = completion.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        intent: parsed.intent || 'KNOWLEDGE_QUERY',
        reasoning: parsed.reasoning || 'Defaulted to knowledge search',
        targetAgent: parsed.targetAgent || 'knowledge',
      };
    } catch (e) {
      console.warn('Failed to parse intent classification JSON from Groq:', e);
    }
  }

  // Smart Heuristic Fallback
  const lower = prompt.toLowerCase();
  if (lower.includes('task') || lower.includes('jira') || lower.includes('ticket') || lower.includes('assigned')) {
    if (lower.includes('mark') || lower.includes('complete') || lower.includes('status') || lower.includes('assign to')) {
      return { intent: 'TASK_UPDATE', reasoning: 'Detected task update keyword', targetAgent: 'task' };
    }
    if (lower.includes('create') || lower.includes('new ticket') || lower.includes('file a bug')) {
      return { intent: 'TASK_CREATE', reasoning: 'Detected task creation keyword', targetAgent: 'task' };
    }
    return { intent: 'TASK_QUERY', reasoning: 'Detected task query keyword', targetAgent: 'task' };
  }

  return { intent: 'KNOWLEDGE_QUERY', reasoning: 'Defaulted to Knowledge Agent', targetAgent: 'knowledge' };
}
