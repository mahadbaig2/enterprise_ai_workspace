'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createWorkspace } from '@/lib/api/workspace';

/** Mirrors the backend generate_slug() for the live preview. */
function clientSlugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
}

export default function CreateWorkspacePage() {
  const router = useRouter();
  const { session } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = clientSlugify(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;

    setLoading(true);
    setError(null);

    try {
      await createWorkspace(name.trim(), session.access_token);
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 relative overflow-hidden font-sans">
      {/* Background glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-600/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-lg bg-slate-900/80 border border-slate-800/80 backdrop-blur-xl p-8 rounded-2xl shadow-2xl z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-600/20 border border-red-500/30 text-red-500 mb-4 shadow-lg shadow-red-500/10">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Create your workspace</h1>
          <p className="text-slate-400 text-sm mt-1">
            Your workspace is where your team's knowledge lives.
          </p>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-950/50 border border-red-800/50 text-red-300 text-sm flex items-start space-x-2">
            <span className="text-red-400 shrink-0 mt-0.5">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Workspace Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm transition-all"
            />
            {/* Live slug preview */}
            <div className="flex items-center space-x-1.5 text-xs text-slate-500">
              <Sparkles className="w-3 h-3 text-red-500/70" />
              <span>
                Your workspace URL:{' '}
                <span className="text-slate-300 font-mono">
                  {slug || 'your-workspace'}
                </span>
              </span>
            </div>
          </div>

          {/* Feature bullets */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            {[
              'Isolated knowledge index for your team',
              'Connect Google Drive, Notion & Jira',
              'AI-powered hybrid search across all sources',
            ].map((feat) => (
              <div key={feat} className="flex items-center space-x-2 text-xs text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>{feat}</span>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full py-3 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-red-600/20 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer group"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Create Workspace</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
