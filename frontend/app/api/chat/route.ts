import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@/lib/supabase/server';

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
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'meta', data: { ...data, content: '' } }) + SEP));
      // The answer is already complete before this response is created. Send it
      // as one delta so line breaks and trailing text cannot be lost by a second
      // client-side chunk parser.
      controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'delta', content: data.content }) + SEP));
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
    const body = await req.json() as { prompt?: string; stream?: boolean; context?: string; confirmation?: { approved?: boolean; proposal?: Record<string, unknown> } };
    if (!body.prompt || typeof body.prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }
    const auth = await token(req);
    if (!auth) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    const backendResponse = await fetch(backendUrl + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ prompt: body.prompt, context: body.context || '', confirmation: body.confirmation || null }),
      cache: 'no-store',
    });
    const rawResult = await backendResponse.text();
    let result: { detail?: string; error?: string; [key: string]: unknown };
    try {
      result = JSON.parse(rawResult) as typeof result;
    } catch {
      result = { error: `Agent service returned an invalid response (HTTP ${backendResponse.status}). ${rawResult.slice(0, 300)}` };
    }
    if (!backendResponse.ok) return NextResponse.json({ error: result.detail || result.error || 'Agent request failed.' }, { status: backendResponse.status });
    return body.stream ? sse(result) : NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
