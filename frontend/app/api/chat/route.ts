import { NextResponse } from 'next/server';
import { AgentIntent, classifyIntent, WorkflowRoutingResult } from '@/lib/ai/workflow-agent';
import { Citation, processKnowledgeQuery } from '@/lib/ai/knowledge-agent';
import { JiraTask, processTaskQuery } from '@/lib/ai/task-agent';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';

type ChatResponseData = {
  routing: WorkflowRoutingResult;
  content: string;
  citations: Citation[];
  tasks: JiraTask[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Internal Server Error';
}

async function getAuthorizationHeader(req: Request): Promise<string | undefined> {
  const requestHeader = req.headers.get('authorization');
  if (requestHeader) return requestHeader;

  const supabase = await createSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? 'Bearer ' + data.session.access_token : undefined;
}

export async function POST(req: Request) {
  try {
    const { prompt, workspaceId } = (await req.json()) as {
      prompt?: string;
      workspaceId?: string;
    };

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const routingResult = await classifyIntent(prompt);
    const responseData: ChatResponseData = {
      routing: routingResult,
      content: '',
      citations: [],
      tasks: [],
    };

    if (routingResult.targetAgent === 'task') {
      const taskResult = await processTaskQuery(
        prompt,
        routingResult.intent as Extract<AgentIntent, 'TASK_QUERY' | 'TASK_UPDATE' | 'TASK_CREATE'>
      );
      responseData.content = taskResult.answer;
      responseData.tasks = taskResult.tasks || (taskResult.updatedTask ? [taskResult.updatedTask] : []);
    } else {
      const knowledgeResult = await processKnowledgeQuery(
        prompt,
        workspaceId,
        await getAuthorizationHeader(req)
      );
      responseData.content = knowledgeResult.answer;
      responseData.citations = knowledgeResult.citations;
    }

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
