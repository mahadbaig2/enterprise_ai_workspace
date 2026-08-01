'use client';

import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Sparkles, LogOut, Loader2, Building2, Layers } from 'lucide-react';

export default function DashboardPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { workspace, loading: workspaceLoading } = useWorkspace();

  const loading = authLoading || workspaceLoading;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-red-600/8 blur-[160px] rounded-full pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-600/8 blur-[140px] rounded-full pointer-events-none" />

      {/* Top bar */}
      <header className="h-14 border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md px-6 flex items-center justify-between relative z-10">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">{workspace?.name ?? 'Enterprise AI Workspace'}</span>
            <span className="text-[10px] text-slate-500 block -mt-0.5 font-mono">{workspace?.slug}</span>
          </div>
        </div>

        <button
          onClick={signOut}
          className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors cursor-pointer group"
        >
          <LogOut className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
          <span>Sign Out</span>
        </button>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-6 py-12 relative z-10">
        {/* Welcome */}
        <div className="mb-10">
          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Dashboard</p>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            {workspace?.name ?? 'Your Workspace'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Welcome back, <span className="text-slate-200">{user?.email}</span>
          </p>
        </div>

        {/* Workspace info card */}
        <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800/80 backdrop-blur-md mb-6 flex items-center space-x-4">
          <div className="w-10 h-10 rounded-xl bg-red-600/15 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-semibold text-white truncate">{workspace?.name}</p>
            <p className="text-xs text-slate-500 font-mono truncate">{workspace?.slug}</p>
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
              Active
            </span>
          </div>
        </div>

        {/* Integrations placeholder */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
          <div className="flex items-center space-x-2 mb-3">
            <Layers className="w-4 h-4 text-slate-500" />
            <p className="text-sm font-semibold text-slate-300">Integrations</p>
          </div>
          <p className="text-sm text-slate-500">
            Your integrations will appear here. Connect Google Drive, Notion, and Jira to start syncing your enterprise knowledge.
          </p>
        </div>
      </main>
    </div>
  );
}
