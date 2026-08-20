'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { FileText, Loader2, LogOut, Menu, MessageSquarePlus, Plug, Send, Sparkles, Trash2, X } from 'lucide-react';

type Conversation = { id: string; title: string; updated_at: string };
type Citation = { id: string; title: string; source: string; url?: string; snippet: string };
type JiraProposal = { action: 'CREATE' | 'UPDATE'; issueKey?: string; summary?: string; projectKey?: string; status?: string };
type Message = { id: string; sender: 'user' | 'agent'; content: string; citations?: Citation[]; tasks?: unknown[]; retrievalStatus?: string };
type Result = { routing: { targetAgent: string }; content: string; citations: Citation[]; tasks: unknown[] };

const thinkingLabels = ['Thinking...', 'Checking connected knowledge...', 'Composing a grounded answer...'];
const AGENT_REQUEST_TIMEOUT_MS = 45_000;

async function agentFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Jira is taking too long to respond. Check the Jira connection and try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function hideModelReasoning(content: string): string {
  return content.replace(/<(?:think|thinking|analysis)\b[\s\S]*?(?:<\/(?:think|thinking|analysis)>|$)/gi, '').trim();
}

function MarkdownText({ content }: { content: string }) {
  const visibleContent = hideModelReasoning(content);
  return <div className="space-y-2 text-sm leading-6 text-slate-200">{visibleContent.split('\n').map((line, index) => {
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

function ThinkingIndicator({ label }: { label: string }) {
  return <div className="my-2 flex max-w-sm items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-400 shadow-lg shadow-black/10">
    <span className="relative flex h-5 w-5 items-center justify-center text-red-300"><Sparkles className="h-4 w-4 animate-pulse" /><span className="absolute inset-0 rounded-full bg-red-500/20 blur-md" /></span>
    <span>{label}</span>
    <span className="ml-auto flex gap-1" aria-hidden="true"><span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.2s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.1s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-slate-500" /></span>
  </div>;
}

export default function DashboardPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { workspace, loading: workspaceLoading, error: workspaceError } = useWorkspace();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const [busyLabel, setBusyLabel] = useState('Thinking...');
  const [busyKind, setBusyKind] = useState<'chat' | 'action'>('chat');
  const [showThinking, setShowThinking] = useState(false);
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
    if (!text || busy) return;
    const id = await ensureConversation(text);
    setPrompt('');
    setBusy(true);
    setBusyKind('chat');
    setThinkingIndex(0);
    setBusyLabel(thinkingLabels[0]);
    setShowThinking(true);
    setMessages((current) => [...current, { id: 'user-' + Date.now(), sender: 'user', content: text }]);
    try {
      const context = messages.slice(-8).map((item) => `${item.sender}: ${item.content}`).join('\n');
      const response = await agentFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, workspaceId: workspace?.id, context, stream: true }) });
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
            setShowThinking(false);
            answer += data.content || '';
            setMessages((current) => [...current.filter((item) => item.id !== 'streaming'), { id: 'streaming', sender: 'agent', content: answer, citations: result.citations || [] }]);
          }
        }
      }
      const finalResult = { routing: result.routing || { targetAgent: 'knowledge' }, content: answer, citations: result.citations || [], tasks: result.tasks || [] };
      setMessages((current) => [...current.filter((item) => item.id !== 'streaming'), { id: 'agent-' + Date.now(), sender: 'agent', content: answer, citations: finalResult.citations, tasks: finalResult.tasks }]);
      if (id) await fetch('/api/conversations/' + id + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, ...finalResult }) });
      await loadConversations();
    } catch (error) {
      setMessages((current) => [...current, { id: 'error-' + Date.now(), sender: 'agent', content: error instanceof Error ? error.message : 'Unable to complete the request.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmJiraAction(message: Message, proposal: JiraProposal, approved: boolean) {
    if (busy) return;
    setBusy(true);
    setBusyKind('action');
    setBusyLabel(approved ? 'Applying Jira change...' : 'Cancelling Jira change...');
    setShowThinking(true);
    try {
      const response = await agentFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: proposal.action === 'CREATE' ? `Create Jira task ${proposal.summary || ''} in ${proposal.projectKey || ''}` : `Update ${proposal.issueKey || ''} to ${proposal.status || ''}`, workspaceId: workspace?.id, confirmation: { approved, proposal } }) });
      const rawBody = await response.text();
      let body: { content?: string; error?: string } = {};
      try { body = JSON.parse(rawBody) as typeof body; } catch { body.error = rawBody.slice(0, 300); }
      if (!response.ok) throw new Error(body.error || 'Jira confirmation failed');
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, content: approved ? body.content : 'Jira action cancelled. No changes were made.', tasks: [] } : item));
    } catch (error) {
      setMessages((current) => [...current, { id: 'error-' + Date.now(), sender: 'agent', content: error instanceof Error ? error.message : 'Unable to complete Jira action.' }]);
    } finally { setBusy(false); setShowThinking(false); }
  }

  useEffect(() => { if (!authLoading) void loadConversations(); }, [authLoading]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!busy || busyKind !== 'chat') return;
    const timer = window.setInterval(() => setThinkingIndex((current) => (current + 1) % thinkingLabels.length), 2400);
    return () => window.clearInterval(timer);
  }, [busy, busyKind]);
  useEffect(() => {
    if (busyKind === 'chat') setBusyLabel(thinkingLabels[thinkingIndex]);
  }, [busyKind, thinkingIndex]);

  if (authLoading || workspaceLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return <div className="flex min-h-screen bg-slate-950 text-slate-100">
    <aside className={(menuOpen ? 'fixed inset-y-0 left-0 z-20 flex w-80' : 'hidden') + ' flex-col border-r border-slate-800 bg-slate-900 md:relative md:flex'}>
      <div className="flex h-16 items-center justify-between border-b border-slate-800 px-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600/20 text-red-300"><Sparkles className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{workspace?.name || 'Workspace'}</p><p className="truncate text-[10px] text-slate-500">{user?.email}</p></div></div><button aria-label="Close menu" title="Close menu" className="text-slate-500 md:hidden" onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></button></div>
      <div className="p-3"><button onClick={newConversation} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm hover:border-red-500/60"><MessageSquarePlus className="h-4 w-4" />New conversation</button></div>
      <div className="flex-1 overflow-y-auto px-2">{conversations.map((item) => <div key={item.id} className="group flex items-center rounded-lg hover:bg-slate-800"><button onClick={() => void loadConversation(item.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-slate-300">{item.title}</button><button aria-label="Delete conversation" title="Delete conversation" onClick={() => void deleteConversation(item.id)} className="mr-2 hidden text-slate-500 hover:text-red-400 group-hover:block"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
      <div className="border-t border-slate-800 p-3"><Link href="/integrations" className="mb-3 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"><Plug className="h-3.5 w-3.5" />Connected apps</Link><button onClick={() => signOut()} className="flex items-center gap-2 text-xs text-slate-500 hover:text-red-400"><LogOut className="h-3.5 w-3.5" />Sign out</button></div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b border-slate-800 px-4 md:px-8"><div className="flex items-center gap-3"><button aria-label="Open menu" title="Open menu" className="text-slate-400 md:hidden" onClick={() => setMenuOpen(true)}><Menu className="h-5 w-5" /></button><div><p className="text-[10px] uppercase tracking-wider text-red-300">Enterprise AI Workspace</p><h1 className="text-lg font-semibold text-white">{conversationId ? 'Conversation' : 'New conversation'}</h1></div></div><Link href="/integrations" className="hidden items-center gap-2 text-xs text-slate-400 hover:text-white sm:flex"><Plug className="h-4 w-4" />Manage integrations</Link></header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl px-4 py-8 md:px-8">{(workspaceError || !workspace) && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Workspace is unavailable. Basic questions still work; connect or finish setting up a workspace to use connected tools.</div>}
        {!messages.length ? <div className="flex min-h-[55vh] flex-col items-center justify-center text-center"><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300"><Sparkles className="h-7 w-7" /></div><h2 className="text-2xl font-semibold text-white">Ask your workspace</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Search connected knowledge, review Jira work, or ask a general question.</p><div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-3">{['What is in our connected knowledge base?', 'Show my assigned Jira tasks', 'What can you help me with?'].map((item) => <button key={item} onClick={() => setPrompt(item)} className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-left text-xs text-slate-400 hover:border-red-500/50 hover:text-slate-200">{item}</button>)}</div></div> : messages.map((message) => <article key={message.id} className={message.sender === 'user' ? 'mb-6 flex justify-end' : 'mb-8'}><div className={message.sender === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-red-600 px-4 py-3 text-sm text-white' : 'max-w-[90%]'}>{message.sender === 'user' ? <p className="whitespace-pre-wrap">{message.content}</p> : <><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-red-300"><Sparkles className="h-3 w-3" />Workspace Agent</div><MarkdownText content={message.content} /><Citations items={message.citations || []} />{(message.tasks || []).map((task, index) => { const item = task as JiraProposal & { requiresConfirmation?: boolean }; return item.requiresConfirmation ? <div key={index} className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"><p className="font-semibold">Confirm Jira {item.action === 'CREATE' ? 'creation' : 'update'}</p><p className="mt-1">{item.action === 'CREATE' ? `${item.summary} in ${item.projectKey}` : `${item.issueKey} → ${item.status}`}</p><div className="mt-3 flex gap-2"><button onClick={() => void confirmJiraAction(message, item, true)} className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white">Confirm</button><button onClick={() => void confirmJiraAction(message, item, false)} className="rounded border border-slate-600 px-3 py-1.5">Cancel</button></div></div> : null; })}</>}</div></article>)}
        {busy && showThinking && <ThinkingIndicator label={busyLabel} />}
      </div></div>
      <form onSubmit={(event) => void sendMessage(event)} className="border-t border-slate-800 bg-slate-950 p-4 md:px-8"><div className="mx-auto flex max-w-4xl items-end gap-3 rounded-xl border border-slate-700 bg-slate-900 p-2 focus-within:border-red-500/70"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask about your workspace..." rows={1} className="max-h-32 min-h-10 flex-1 resize-none cursor-text bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-slate-600" /><button aria-label="Send message" title="Send message" disabled={busy || !prompt.trim()} className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-40"><Send className="h-4 w-4" /></button></div></form>
    </main>
  </div>;
}
