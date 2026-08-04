'use client';

import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  Bot,
  Cloud,
  FileSearch,
  FileText,
  LogOut,
  MailPlus,
  Loader2,
  Search,
  Sparkles,
  TicketCheck,
} from 'lucide-react';

const quickActions = [
  {
    icon: Search,
    title: 'Search your knowledge base',
    description: 'Ask grounded questions after integrations are connected.',
  },
  {
    icon: TicketCheck,
    title: 'Manage Jira tasks',
    description: 'Retrieve, create, and update issues from chat.',
  },
  {
    icon: MailPlus,
    title: 'Draft an email',
    description: 'Prepare email drafts without leaving your workspace.',
  },
];

const connectedApps = [
  { initials: 'GD', name: 'Google Drive', icon: Cloud },
  { initials: 'NO', name: 'Notion', icon: FileText },
  { initials: 'JI', name: 'Jira', icon: TicketCheck },
  { initials: 'GM', name: 'Gmail', icon: MailPlus },
];

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
      <main className="max-w-5xl mx-auto px-6 py-12 relative z-10">
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

        <section className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Bot className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-300">Quick Actions</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <div
                  key={action.title}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-5 opacity-75 backdrop-blur-md"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                      Coming soon
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-200">{action.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{action.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-300">Connected Apps</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {connectedApps.map((app) => {
              const Icon = app.icon;

              return (
                <div
                  key={app.name}
                  className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 backdrop-blur-md"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-200">{app.name}</p>
                      <p className="text-xs text-slate-500">Not connected</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
