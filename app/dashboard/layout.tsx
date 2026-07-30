'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Sparkles, 
  MessageSquare, 
  Layers, 
  Settings, 
  LogOut, 
  Building2, 
  Plus, 
  CheckCircle2,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [workspace, setWorkspace] = useState({ name: 'Acme Workspace', company: 'Acme Corp' });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('active_workspace');
      if (stored) {
        try {
          setWorkspace(JSON.parse(stored));
        } catch (e) {}
      }
    }
  }, []);

  const handleLogout = () => {
    router.push('/login');
  };

  const navItems = [
    { name: 'AI Chat Workspace', href: '/dashboard', icon: MessageSquare },
    { name: 'Connected Apps', href: '/dashboard/settings', icon: Layers },
    { name: 'Workspace Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between p-4 z-20 backdrop-blur-xl shrink-0">
        <div>
          {/* Logo & Workspace Title */}
          <div className="flex items-center space-x-3 px-2 py-3 mb-4 border-b border-slate-800/80">
            <div className="w-9 h-9 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-red-500 shadow-md shadow-red-500/10 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <h2 className="font-semibold text-sm text-white truncate">{workspace.name}</h2>
              <span className="text-xs text-slate-400 truncate block">{workspace.company}</span>
            </div>
          </div>

          {/* New Chat Button */}
          <Link
            href="/dashboard"
            className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 rounded-xl font-medium text-xs transition-all mb-6 group cursor-pointer"
          >
            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
            <span>New Conversation</span>
          </Link>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-slate-800 text-white font-semibold shadow-sm border border-slate-700/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-red-400' : 'text-slate-500'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Footer */}
        <div className="pt-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center space-x-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                JD
              </div>
              <div className="overflow-hidden text-xs">
                <p className="text-slate-200 font-medium truncate">Jane Doe</p>
                <p className="text-slate-500 text-[10px] truncate">jane@company.com</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-950">
        {/* Top Navbar */}
        <header className="h-14 border-b border-slate-800/80 bg-slate-900/40 px-6 flex items-center justify-between backdrop-blur-md shrink-0">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Building2 className="w-4 h-4 text-slate-500" />
            <span>{workspace.company}</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-slate-200 font-medium">Enterprise AI Workspace</span>
          </div>

          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Groq AI + Hybrid Search</span>
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
