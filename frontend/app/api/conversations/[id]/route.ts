import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Context = { params: Promise<{ id: string }> };

async function authClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return { supabase, auth: data };
}

export async function GET(_request: Request, context: Context) {
  const { supabase, auth } = await authClient();
  if (!auth.session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const { data: conversation, error } = await supabase.from('conversations').select('id,workspace_id,title,created_at,updated_at').eq('id', id).single();
  if (error || !conversation) return NextResponse.json({ error: error?.message || 'Conversation not found' }, { status: 404 });
  const { data: messages, error: messageError } = await supabase.from('messages').select('id,sender,agent_type,content,citations,metadata,created_at').eq('conversation_id', id).order('created_at', { ascending: true });
  if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });
  return NextResponse.json({ conversation, messages: messages || [] });
}

export async function DELETE(_request: Request, context: Context) {
  const { supabase, auth } = await authClient();
  if (!auth.session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
