'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function CreateWorkspacePage() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Save active workspace locally or in session
    if (typeof window !== 'undefined') {
      localStorage.setItem('active_workspace', JSON.stringify({
        name: workspaceName || 'Acme Workspace',
        company: companyName || 'Acme Corp',
      }));
    }

    setTimeout(() => {
      router.push('/dashboard');
    }, 600);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 relative overflow-hidden">
      {/* Glow Effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-600/10 blur-[140px] rounded-full pointer-events-none" />

      <div className="w-full max-w-lg bg-slate-900/80 border border-slate-800 backdrop-blur-xl p-8 rounded-2xl shadow-2xl z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-600/20 border border-red-500/30 text-red-500 mb-4 shadow-lg shadow-red-500/10">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Create Your Enterprise Workspace</h1>
          <p className="text-slate-400 text-sm mt-1">Set up an isolated environment for your team's knowledge and Jira tasks</p>
        </div>

        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Workspace Name</label>
            <input
              type="text"
              required
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="e.g. Engineering Core"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Company / Organization</label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Technologies"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm transition-all"
            />
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center space-x-2 text-xs text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Isolated Supabase pgvector & FTS document indexes</span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Seamless Composio OAuth for Google Drive, Notion & Jira</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-red-600/20 transition-all flex items-center justify-center space-x-2 group disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'Initializing Workspace...' : 'Launch AI Workspace'}</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </form>
      </div>
    </div>
  );
}
