'use client';

import { useState } from 'react';
import { 
  Layers, 
  CheckCircle2, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  Building2,
  HardDrive,
  BookOpen,
  CheckSquare
} from 'lucide-react';

interface Integration {
  id: string;
  name: string;
  provider: 'google_drive' | 'notion' | 'jira';
  description: string;
  icon: any;
  status: 'connected' | 'disconnected' | 'syncing';
  lastSynced?: string;
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([
    {
      id: '1',
      name: 'Google Drive',
      provider: 'google_drive',
      description: 'Synchronize corporate documents, specs, and PDFs for pgvector & FTS search',
      icon: HardDrive,
      status: 'connected',
      lastSynced: '10 minutes ago',
    },
    {
      id: '2',
      name: 'Notion',
      provider: 'notion',
      description: 'Retrieve company wiki, onboarding docs, and product policies',
      icon: BookOpen,
      status: 'connected',
      lastSynced: '1 hour ago',
    },
    {
      id: '3',
      name: 'Jira Cloud',
      provider: 'jira',
      description: 'Read assigned tickets, create new issues, and update status',
      icon: CheckSquare,
      status: 'connected',
      lastSynced: 'Just now',
    },
  ]);

  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);

  const handleSync = async (provider: string) => {
    setSyncingProvider(provider);
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });

      setIntegrations((prev) =>
        prev.map((item) =>
          item.provider === provider ? { ...item, status: 'connected', lastSynced: 'Just now' } : item
        )
      );
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setSyncingProvider(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center space-x-3">
          <Layers className="w-6 h-6 text-red-500" />
          <span>Enterprise Integrations & Connected Apps</span>
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage your connected Google Drive, Notion, and Jira instances. Data is indexed into Supabase with hybrid search capabilities.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {integrations.map((item) => {
          const Icon = item.icon;
          const isSyncing = syncingProvider === item.provider;

          return (
            <div
              key={item.id}
              className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-between space-x-4 backdrop-blur-xl shadow-xl hover:border-slate-700/80 transition-all"
            >
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-red-400 shrink-0 shadow-inner">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center space-x-3">
                    <h3 className="text-base font-semibold text-white">{item.name}</h3>
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Connected</span>
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mt-1">{item.description}</p>
                  {item.lastSynced && (
                    <p className="text-[10px] text-slate-500 mt-2 font-mono">Last Ingestion Sync: {item.lastSynced}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={() => handleSync(item.provider)}
                  disabled={isSyncing}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl transition-all border border-slate-700/60 flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-red-400' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Re-sync Data'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-400 space-y-2">
        <div className="flex items-center space-x-2 text-slate-200 font-semibold">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Composio Enterprise Security & RLS</span>
        </div>
        <p>
          All enterprise integrations use OAuth 2.0 authorization. Tokens are stored securely in Supabase with Row Level Security (RLS) policies enforcing user workspace isolation.
        </p>
      </div>
    </div>
  );
}
