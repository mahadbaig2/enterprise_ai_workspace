import { NextResponse } from 'next/server';
import { AgentIntent, classifyIntent } from '@/lib/ai/workflow-agent';
import { processKnowledgeQuery } from '@/lib/ai/knowledge-agent';
import { processTaskQuery } from '@/lib/ai/task-agent';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

async function token(req: Request) {
  const header = req.headers.get('authorization');
  if (header) return header;
  const supabase = await createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? 'Bearer ' + data.session.access_token : undefined;
}

function sse(data: { conversationId?: string; routing: unknown; content: string; citations: unknown[]; tasks: unknown[]; retrievalStatus?: string }) {
  const encoder = new TextEncoder();
  const SEP = '\n\n';
  const chunks = data.content.match(/.{1,80}(?:\s|$)|.{1,80}/g) || [data.content];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'meta', data: { ...data, content: '' } }) + SEP));
      chunks.forEach((chunk) =>
        controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'delta', content: chunk }) + SEP))
      );
      controller.enqueue(encoder.encode('data: [DONE]' + SEP));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

function sanitizeAssistantContent(value: string): string {
  let content = value.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
  const marker = content.lastIndexOf('[Output]');
  if (marker >= 0) content = content.slice(marker + '[Output]'.length).replace(/^\s*(?:->|:)\s*/, '').trim();
  const quoted = content.match(/^(["'])([\s\S]*)\1$/);
  return (quoted ? quoted[2] : content).trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { prompt?: string; workspaceId?: string; stream?: boolean; context?: string; confirmation?: { approved?: boolean; proposal?: Parameters<typeof processTaskQuery>[4] } };
    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    const routing = await classifyIntent(body.prompt);
    const auth = routing.targetAgent === 'general' ? undefined : await token(req);
  const result: { routing: typeof routing; content: string; citations: unknown[]; tasks: unknown[]; retrievalStatus?: string } = {
      routing,
      content: '',
      citations: [],
      tasks: [],
    };
    if (routing.targetAgent === 'task') {
      // Jira actions use the direct REST agent. The legacy /tasks router is
      // Composio-backed and can report a connected account while creation
      // still fails, so keep reads, proposals, and confirmation on one path.
      const agentResponse = await fetch(`${BACKEND_URL}/agents/chat`, {
        method: 'POST',
        headers: { Authorization: auth || '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: body.prompt, context: body.context || '', confirmation: body.confirmation }),
        cache: 'no-store',
      });
      const agentPayload = await agentResponse.json().catch(() => ({}));
      if (!agentResponse.ok) return NextResponse.json({ error: agentPayload.detail || agentPayload.error || 'Jira agent request failed.' }, { status: agentResponse.status });
      result.content = sanitizeAssistantContent(String(agentPayload.content || ''));
      result.tasks = agentPayload.tasks || [];
      result.citations = agentPayload.citations || [];
      result.retrievalStatus = agentPayload.retrievalStatus;
      if (agentPayload.requiresConfirmation && agentPayload.proposal && !result.tasks.length) result.tasks = [{ ...agentPayload.proposal, requiresConfirmation: true }];
      return body.stream ? sse(result) : NextResponse.json(result);
    }
    if (routing.targetAgent === 'task') {
      const task = await processTaskQuery(
        body.prompt,
        routing.intent as Extract<AgentIntent, 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE'>,
        auth,
        body.confirmation?.approved === true,
        body.confirmation?.proposal,
        body.context || '',
      );
      result.content = sanitizeAssistantContent(task.answer);
      result.tasks = task.tasks || (task.updatedTask ? [task.updatedTask] : []);
      if (task.requiresConfirmation) result.tasks = [{ ...task.proposal, requiresConfirmation: true }];
    } else if (routing.targetAgent === 'general') {
      result.content = 'Hello! How can I help with your connected workspace?';
    } else {
      const knowledge = await processKnowledgeQuery(body.prompt, body.workspaceId, auth, body.context);
      result.content = sanitizeAssistantContent(knowledge.answer);
      result.citations = knowledge.citations;
      result.retrievalStatus = knowledge.retrievalStatus;
    }
    return body.stream ? sse(result) : NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
