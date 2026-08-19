import { NextResponse } from 'next/server';
import { AgentIntent, classifyIntent } from '@/lib/ai/workflow-agent';
import { processKnowledgeQuery } from '@/lib/ai/knowledge-agent';
import { processTaskQuery } from '@/lib/ai/task-agent';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';

async function token(req: Request) {
  const header = req.headers.get('authorization');
  if (header) return header;
  const supabase = await createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? 'Bearer ' + data.session.access_token : undefined;
}

function sse(data: { conversationId?: string; routing: unknown; content: string; citations: unknown[]; tasks: unknown[] }) {
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

export async function POST(req: Request) {
  try {
    const body = await req.json() as { prompt?: string; workspaceId?: string; stream?: boolean };
    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    const routing = await classifyIntent(body.prompt);
    const auth = routing.targetAgent === 'general' ? undefined : await token(req);
    const result: { routing: typeof routing; content: string; citations: unknown[]; tasks: unknown[] } = {
      routing,
      content: '',
      citations: [],
      tasks: [],
    };
    if (routing.targetAgent === 'task') {
      const task = await processTaskQuery(
        body.prompt,
        routing.intent as Extract<AgentIntent, 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE'>,
        auth
      );
      result.content = task.answer;
      result.tasks = task.tasks || (task.updatedTask ? [task.updatedTask] : []);
    } else if (routing.targetAgent === 'general') {
      result.content = 'Hello! How can I help with your connected workspace?';
    } else {
      const knowledge = await processKnowledgeQuery(body.prompt, body.workspaceId, auth);
      result.content = knowledge.answer;
      result.citations = knowledge.citations;
    }
    return body.stream ? sse(result) : NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
