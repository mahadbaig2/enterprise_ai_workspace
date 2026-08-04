'use client';

import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  const { workspace, loading } = useWorkspace();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-6">
        <header className="h-8 text-center text-sm text-slate-500">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading workspace
            </span>
          ) : (
            workspace?.name
          )}
        </header>
        <main className="flex flex-1 items-center justify-center py-8">{children}</main>
      </div>
    </div>
  );
}
