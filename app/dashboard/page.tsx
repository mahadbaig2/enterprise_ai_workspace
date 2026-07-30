'use client';

import { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Sparkles, 
  Bot, 
  User, 
  FileText, 
  CheckCircle2, 
  ExternalLink, 
  RefreshCw,
  Search,
  CheckSquare,
  ArrowRight,
  ShieldCheck,
  Cpu
} from 'lucide-react';

interface Citation {
  id: string;
  title: string;
  source: 'google_drive' | 'notion' | 'other';
  url?: string;
  snippet: string;
}

interface JiraTask {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  priority: string;
  url: string;
}

interface Message {
  id: string;
  sender: 'user' | 'agent';
  agentType?: 'workflow' | 'knowledge' | 'task';
  content: string;
  citations?: Citation[];
  tasks?: JiraTask[];
  routingInfo?: {
    intent: string;
    reasoning: string;
  };
}

export default function ChatDashboardPage() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      sender: 'agent',
      agentType: 'workflow',
      content: 'Welcome to your **Enterprise AI Workspace**! I am ready to answer document questions via **Supabase Hybrid Search** or execute **Jira tasks** on your behalf.\n\nTry asking one of the prompt starters below:',
    }
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (userPrompt: string) => {
    const text = userPrompt.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content: text,
    };

    setMessages((prev) => [...prev, userMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });

      const data = await res.json();

      const agentMsg: Message = {
        id: `agent-${Date.now()}`,
        sender: 'agent',
        agentType: data.routing?.targetAgent || 'knowledge',
        content: data.content,
        citations: data.citations || [],
        tasks: data.tasks || [],
        routingInfo: {
          intent: data.routing?.intent || 'KNOWLEDGE_QUERY',
          reasoning: data.routing?.reasoning || 'Routed request',
        },
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'agent',
          agentType: 'knowledge',
          content: 'Sorry, I encountered an issue processing your request. Please try again.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const promptStarters = [
    { label: '📋 What tasks are assigned to me?', intent: 'Task Agent' },
    { label: '✅ Mark PROJ-101 as completed', intent: 'Jira Action' },
    { label: '📖 What is our leave policy?', intent: 'Knowledge Agent' },
    { label: '🚨 Create a bug ticket for login UI', intent: 'Task Agent' },
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 relative">
      {/* Scrollable Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-3">
            {/* Agent Routing Tag if present */}
            {msg.routingInfo && (
              <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5 w-fit">
                <Cpu className="w-3.5 h-3.5 text-red-400" />
                <span>Workflow Agent Routed: <span className="text-red-400 font-semibold">{msg.routingInfo.intent}</span></span>
              </div>
            )}

            <div className={`flex items-start space-x-3 ${msg.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
              {/* Avatar */}
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                  msg.sender === 'user'
                    ? 'bg-slate-800 border border-slate-700 text-slate-200'
                    : msg.agentType === 'task'
                    ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-400'
                    : 'bg-red-600/20 border border-red-500/30 text-red-400'
                }`}
              >
                {msg.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Content Bubble */}
              <div
                className={`p-4 rounded-2xl max-w-2xl text-sm leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-red-600 text-white rounded-tr-none shadow-md shadow-red-600/10'
                    : 'bg-slate-900/90 border border-slate-800/90 text-slate-200 rounded-tl-none backdrop-blur-md shadow-xl'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Render Citations if available */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                      <FileText className="w-3.5 h-3.5 text-red-400" />
                      <span>Citations & Grounded Sources ({msg.citations.length})</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {msg.citations.map((cit) => (
                        <a
                          key={cit.id}
                          href={cit.url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-red-500/40 transition-all flex items-start space-x-2 text-xs group"
                        >
                          <div className="p-1 rounded bg-slate-800 text-slate-400 shrink-0">
                            <ExternalLink className="w-3 h-3 group-hover:text-red-400" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="font-medium text-slate-200 truncate group-hover:text-red-300">{cit.title}</p>
                            <p className="text-[10px] text-slate-500 capitalize">{cit.source.replace('_', ' ')}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Render Jira Task Cards if available */}
                {msg.tasks && msg.tasks.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                      <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Jira Enterprise Tickets</span>
                    </p>
                    <div className="space-y-2">
                      {msg.tasks.map((task) => (
                        <div
                          key={task.key}
                          className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between space-x-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-mono font-bold text-red-400">{task.key}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                task.status === 'Done' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                              }`}>
                                {task.status}
                              </span>
                            </div>
                            <p className="text-slate-300 font-medium mt-1">{task.summary}</p>
                          </div>
                          <a
                            href={task.url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-3 text-slate-400 text-xs py-2">
            <div className="w-8 h-8 rounded-xl bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
            <span>Workflow Agent executing Groq inference...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Prompt Starters */}
      {messages.length <= 2 && (
        <div className="max-w-4xl mx-auto w-full px-6 mb-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {promptStarters.map((starter) => (
              <button
                key={starter.label}
                onClick={() => handleSend(starter.label)}
                className="p-3 text-left rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-red-500/30 hover:bg-slate-900 text-xs text-slate-300 transition-all cursor-pointer group"
              >
                <p className="font-medium group-hover:text-red-400">{starter.label}</p>
                <span className="text-[10px] text-slate-500 mt-1 block">{starter.intent}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Box Bar */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/40 backdrop-blur-xl shrink-0">
        <div className="max-w-4xl mx-auto relative flex items-center">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend(prompt)}
            placeholder="Ask company policy or update Jira tickets (e.g. 'What is our leave policy?')..."
            className="w-full pl-4 pr-12 py-3.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm transition-all shadow-inner"
          />
          <button
            onClick={() => handleSend(prompt)}
            disabled={!prompt.trim() || loading}
            className="absolute right-2 p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all disabled:opacity-30 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
