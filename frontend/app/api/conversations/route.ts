import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase.from('conversations').select('id,workspace_id,title,created_at,updated_at').order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  const { data, error } = await supabase.from('conversations').insert({
    workspace_id: body.workspaceId,
    user_id: auth.session.user.id,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'New Conversation',
  }).select('id,workspace_id,title,created_at,updated_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data }, { status: 201 });
}
