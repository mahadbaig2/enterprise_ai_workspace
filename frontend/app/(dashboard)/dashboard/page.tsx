'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileText, Loader2, LogOut, Menu, MessageSquarePlus, Plug, Send, Sparkles, Trash2, X } from 'lucide-react';

type Conversation = { id: string; title: string; updated_at: string };
type Citation = { id: string; title: string; source: string; url?: string; snippet: string };
type Message = { id: string; sender: 'user' | 'agent'; content: string; citations?: Citation[] };
type Result = { routing: { targetAgent: string }; content: string; citations: Citation[]; tasks: unknown[] };

function MarkdownText({ content }: { content: string }) {
  return <div className="space-y-2 text-sm leading-6 text-slate-200">{content.split('\n').map((line, index) => {
    if (!line.trim()) return <div key={index} className="h-1" />;
    if (line.startsWith('# ')) return <h2 key={index} className="text-lg font-semibold text-white">{line.slice(2)}</h2>;
    if (line.startsWith('## ')) return <h3 key={index} className="text-base font-semibold text-white">{line.slice(3)}</h3>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <p key={index} className="pl-4">{line.slice(2)}</p>;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return <p key={index}>{parts.map((part, partIndex) => part.startsWith('**') ? <strong key={partIndex} className="font-semibold text-white">{part.slice(2, -2)}</strong> : <span key={partIndex}>{part}</span>)}</p>;
  })}</div>;
}

function Citations({ items }: { items: Citation[] }) {
  if (!items?.length) return null;
  return <div className="mt-4 grid gap-2 sm:grid-cols-2">{items.slice(0, 4).map((item) => <a key={item.id} href={item.url || '#'} target={item.url ? '_blank' : undefined} rel="noreferrer" className="rounded-lg border border-slate-700 bg-slate-950 p-3 hover:border-red-500/60"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-red-300"><FileText className="h-3.5 w-3.5" />{item.source.replace('_', ' ')}</div><p className="mt-1 truncate text-xs font-semibold text-slate-200">{item.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.snippet}</p></a>)}</div>;
}

export default function DashboardPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { workspace, loading: workspaceLoading } = useWorkspace();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadConversations() {
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (response.ok) setConversations((await response.json()).conversations || []);
  }

  async function loadConversation(id: string) {
    const response = await fetch('/api/conversations/' + id, { cache: 'no-store' });
    if (!response.ok) return;
    const body = await response.json();
    setConversationId(id);
    setMessages((body.messages || []).map((item: Message) => ({ ...item, sender: item.sender === 'user' ? 'user' : 'agent' })));
    setMenuOpen(false);
  }

  function newConversation() {
    setConversationId(undefined);
    setMessages([]);
    setMenuOpen(false);
  }

  async function deleteConversation(id: string) {
    await fetch('/api/conversations/' + id, { method: 'DELETE' });
    if (conversationId === id) newConversation();
    await loadConversations();
  }

  async function ensureConversation(firstPrompt: string) {
    if (conversationId || !workspace?.id) return conversationId;
    const response = await fetch('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: workspace.id, title: firstPrompt }) });
    if (!response.ok) return undefined;
    const id = (await response.json()).conversation.id as string;
    setConversationId(id);
    return id;
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy || !workspace?.id) return;
    const id = await ensureConversation(text);
    setPrompt('');
    setBusy(true);
    setMessages((current) => [...current, { id: 'user-' + Date.now(), sender: 'user', content: text }]);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, workspaceId: workspace.id, stream: true }) });
      if (!response.ok || !response.body) throw new Error('Chat request failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      let result: Partial<Result> = {};
      while (true) {
        const read = await reader.read();
        if (read.done) break;
        buffer += decoder.decode(read.value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          if (!event.startsWith('data: ')) continue;
          const raw = event.slice(6);
          if (raw === '[DONE]') continue;
          const data = JSON.parse(raw) as { type: string; data?: Partial<Result>; content?: string };
          if (data.type === 'meta') result = data.data || {};
          if (data.type === 'delta') {
            answer += data.content || '';
            setMessages((current) => [...current.filter((item) => item.id !== 'streaming'), { id: 'streaming', sender: 'agent', content: answer, citations: result.citations || [] }]);
          }
        }
      }
      const finalResult = { routing: result.routing || { targetAgent: 'knowledge' }, content: answer, citations: result.citations || [], tasks: result.tasks || [] };
      setMessages((current) => [...current.filter((item) => item.id !== 'streaming'), { id: 'agent-' + Date.now(), sender: 'agent', content: answer, citations: finalResult.citations }]);
      if (id) await fetch('/api/conversations/' + id + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, ...finalResult }) });
      await loadConversations();
    } catch (error) {
      setMessages((current) => [...current, { id: 'error-' + Date.now(), sender: 'agent', content: error instanceof Error ? error.message : 'Unable to complete the request.' }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (!authLoading) void loadConversations(); }, [authLoading]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  if (authLoading || workspaceLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return <div className="flex min-h-screen bg-slate-950 text-slate-100">
    <aside className={(menuOpen ? 'fixed inset-y-0 left-0 z-20 flex w-80' : 'hidden') + ' flex-col border-r border-slate-800 bg-slate-900 md:relative md:flex'}>
      <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/20 text-red-300"><Sparkles className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{workspace?.name || 'Workspace'}</p><p className="truncate text-[10px] text-slate-500">{user?.email}</p></div></div><button aria-label="Close menu" title="Close menu" className="text-slate-500 md:hidden" onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></button></div>
      <div className="p-3"><button onClick={newConversation} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm hover:border-red-500/60"><MessageSquarePlus className="h-4 w-4" />New conversation</button></div>
      <div className="flex-1 overflow-y-auto px-2">{conversations.map((item) => <div key={item.id} className="group flex items-center rounded-lg hover:bg-slate-800"><button onClick={() => void loadConversation(item.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-slate-300">{item.title}</button><button aria-label="Delete conversation" title="Delete conversation" onClick={() => void deleteConversation(item.id)} className="mr-2 hidden text-slate-500 hover:text-red-400 group-hover:block"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
      <div className="border-t border-slate-800 p-3"><Link href="/integrations" className="mb-3 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"><Plug className="h-3.5 w-3.5" />Connected apps</Link><button onClick={signOut} className="flex items-center gap-2 text-xs text-slate-500 hover:text-red-400"><LogOut className="h-3.5 w-3.5" />Sign out</button></div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-800 px-4 md:px-8"><div className="flex items-center gap-3"><button aria-label="Open menu" title="Open menu" className="text-slate-400 md:hidden" onClick={() => setMenuOpen(true)}><Menu className="h-5 w-5" /></button><div><p className="text-[10px] uppercase tracking-wider text-red-300">Enterprise AI Workspace</p><h1 className="text-lg font-semibold text-white">{conversationId ? 'Conversation' : 'New conversation'}</h1></div></div><Link href="/integrations" className="hidden items-center gap-2 text-xs text-slate-400 hover:text-white sm:flex"><Plug className="h-4 w-4" />Manage integrations</Link></header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        {!messages.length ? <div className="flex min-h-[55vh] flex-col items-center justify-center text-center"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300"><Sparkles className="h-7 w-7" /></div><h2 className="text-2xl font-semibold text-white">Ask your workspace</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Search connected knowledge, review Jira work, or ask a general question.</p><div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-3">{['What is in our connected knowledge base?', 'Show my assigned Jira tasks', 'What can you help me with?'].map((item) => <button key={item} onClick={() => setPrompt(item)} className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-left text-xs text-slate-400 hover:border-red-500/50 hover:text-slate-200">{item}</button>)}</div></div> : messages.map((message) => <article key={message.id} className={message.sender === 'user' ? 'mb-6 flex justify-end' : 'mb-8'}><div className={message.sender === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-red-600 px-4 py-3 text-sm text-white' : 'max-w-[90%]'}>{message.sender === 'user' ? <p className="whitespace-pre-wrap">{message.content}</p> : <><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-red-300"><Sparkles className="h-3 w-3" />Workspace Agent</div><MarkdownText content={message.content} /><Citations items={message.citations || []} /></>}</div></article>)}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Working across connected tools</div>}
      </div></div>
      <form onSubmit={(event) => void sendMessage(event)} className="border-t border-slate-800 bg-slate-950 p-4 md:px-8"><div className="mx-auto flex max-w-4xl items-end gap-3 rounded-xl border border-slate-700 bg-slate-900 p-2 focus-within:border-red-500/70"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask about your workspace..." rows={1} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-600" /><button aria-label="Send message" title="Send message" disabled={busy || !prompt.trim()} className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"><Send className="h-4 w-4" /></button></div></form>
    </main>
  </div>;
}
