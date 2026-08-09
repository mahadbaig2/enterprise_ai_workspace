import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: Context) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  if (!body.prompt || !body.content) return NextResponse.json({ error: 'prompt and content are required' }, { status: 400 });
  const { error } = await supabase.from('messages').insert([
    { conversation_id: id, sender: 'user', agent_type: 'workflow', content: body.prompt, citations: [], metadata: { routing: body.routing || {} } },
    { conversation_id: id, sender: 'agent', agent_type: body.routing?.targetAgent || 'knowledge', content: body.content, citations: body.citations || [], metadata: { tasks: body.tasks || [] } },
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('conversations').update({ updated_at: new Date().toISOString(), title: body.prompt.trim().slice(0, 80) }).eq('id', id);
  return NextResponse.json({ ok: true });
}
