import { NextResponse } from 'next/server';
import { classifyIntent } from '@/lib/ai/workflow-agent';
import { processKnowledgeQuery } from '@/lib/ai/knowledge-agent';
import { processTaskQuery } from '@/lib/ai/task-agent';

export async function POST(req: Request) {
  try {
    const { prompt, workspaceId } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // 1. Workflow Agent Routing
    const routingResult = await classifyIntent(prompt);

    let responseData: any = {
      routing: routingResult,
      content: '',
      citations: [],
      tasks: [],
    };

    // 2. Delegate to Target Agent
    if (routingResult.targetAgent === 'task') {
      const taskResult = await processTaskQuery(prompt, routingResult.intent as any);
      responseData.content = taskResult.answer;
      responseData.tasks = taskResult.tasks || (taskResult.updatedTask ? [taskResult.updatedTask] : []);
    } else {
      // Default to Knowledge Agent
      const knowledgeResult = await processKnowledgeQuery(prompt, workspaceId);
      responseData.content = knowledgeResult.answer;
      responseData.citations = knowledgeResult.citations;
    }

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
