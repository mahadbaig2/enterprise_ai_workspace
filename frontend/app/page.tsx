'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { 
  Sparkles, 
  ArrowRight, 
  ShieldCheck, 
  CheckSquare, 
  Bot,
  Database,
  Cpu
} from 'lucide-react';

export default function LandingPage() {
  const { user, loading, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-red-600/10 blur-[150px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header Navigation */}
      <header className="h-20 border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-xl px-8 flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 shadow-lg shadow-red-500/10">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-white text-lg tracking-tight">Enterprise AI Workspace</span>
            <span className="text-[10px] text-red-400 font-mono block -mt-1 uppercase">Groq + Supabase Hybrid MVP</span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {loading ? (
            <div className="w-20 h-8 bg-slate-800/50 animate-pulse rounded-lg" />
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="px-4 py-2 text-slate-300 hover:text-white font-medium text-sm transition-colors"
              >
                Dashboard
              </Link>
              <button
                onClick={() => signOut('global')}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-sm rounded-xl border border-slate-700 transition-all cursor-pointer"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-4 py-2 text-slate-300 hover:text-white font-medium text-sm transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-red-600/20 transition-all cursor-pointer"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Hero Content */}
      <main className="max-w-5xl mx-auto px-6 py-20 text-center z-10 my-auto">
        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-red-600/10 border border-red-500/20 text-red-400 text-xs font-semibold mb-6">
          <Cpu className="w-4 h-4 animate-pulse text-red-400" />
          <span>Powered by Groq Inference & Supabase pgvector + FTS</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
          Interact with Enterprise Systems <br />
          <span className="bg-gradient-to-r from-red-500 via-rose-400 to-amber-300 bg-clip-text text-transparent">
            Through Natural Language
          </span>
        </h1>

        <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Search company knowledge across Google Drive & Notion, ask questions with grounded citations, and perform Jira ticket operations without leaving your chat.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          {loading ? (
            <div className="w-48 h-14 bg-slate-900/50 animate-pulse rounded-2xl" />
          ) : user ? (
            <>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold text-base rounded-2xl shadow-xl shadow-red-600/25 transition-all flex items-center justify-center space-x-3 group cursor-pointer"
              >
                <span>Launch AI Workspace</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button
                onClick={() => signOut('global')}
                className="w-full sm:w-auto px-8 py-4 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 font-semibold text-base rounded-2xl transition-all cursor-pointer"
              >
                Sign Out of All Sessions
              </button>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-semibold text-base rounded-2xl shadow-xl shadow-red-600/25 transition-all flex items-center justify-center space-x-3 group cursor-pointer"
              >
                <span>Launch AI Workspace</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto px-8 py-4 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-800 font-semibold text-base rounded-2xl transition-all cursor-pointer"
              >
                Password Sign In
              </Link>
            </>
          )}
        </div>

        {/* Core Pillars Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 text-left">
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-xl bg-red-600/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4">
              <Database className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Knowledge Agent</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Executes Supabase pgvector semantic retrieval and Postgres Full-Text Search with inline grounded citations.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4">
              <CheckSquare className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Task Agent</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Queries assigned Jira issues, creates new tickets, and updates issue status directly in conversation.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-xl">
            <div className="w-10 h-10 rounded-xl bg-amber-600/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-4">
              <Bot className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Workflow Agent</h3>
            <p className="text-slate-400 text-xs leading-relaxed">
              Intelligently classifies user intent and seamlessly routes requests to specialized enterprise agents.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-16 border-t border-slate-800/80 bg-slate-900/40 px-8 flex items-center justify-between text-xs text-slate-500 z-10">
        <span>© 2026 Enterprise AI Workspace — GIKI Capstone MVP</span>
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Supabase Auth & Composio Integrations</span>
        </div>
      </footer>
    </div>
  );
}
