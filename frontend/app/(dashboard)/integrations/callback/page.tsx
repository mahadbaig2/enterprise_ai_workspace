'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { syncIntegration, verifyIntegrationCallback } from '@/lib/api/integrations';
import { getIntegrationMeta } from '@/lib/integrations';

type CallbackState = 'verifying' | 'success' | 'error';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const [state, setState] = useState<CallbackState>('verifying');
  const [message, setMessage] = useState('Verifying your connection...');
  const verificationStarted = useRef(false);

  const provider = searchParams.get('provider') ?? '';
  const connectionId =
    searchParams.get('connection_id') ??
    searchParams.get('connectedAccountId') ??
    searchParams.get('connected_account_id') ??
    searchParams.get('id');
  const providerName = useMemo(
    () => getIntegrationMeta(provider)?.name ?? 'Integration',
    [provider]
  );

  useEffect(() => {
    if (authLoading) return;

    if (!session?.access_token || !provider) {
      void Promise.resolve().then(() => {
        setState('error');
        setMessage(!session?.access_token ? 'Your session expired. Please sign in and reconnect Jira.' : 'Missing integration provider in callback.');
      });
      return;
    }

    let cancelled = false;
    if (verificationStarted.current) return;
    verificationStarted.current = true;

    const verify = async () => {
      try {
        await verifyIntegrationCallback(provider, connectionId, session.access_token);
        if (cancelled) return;
        setState('success');
        setMessage(`${providerName} connected. Syncing your workspace...`);
        if (provider !== 'jira') {
          try {
            await syncIntegration(provider, session.access_token);
          } catch (syncError) {
            console.warn('Initial integration sync failed:', syncError);
          }
        }
        if (cancelled) return;
        setMessage(`${providerName} connected successfully!`);
        window.setTimeout(() => router.push('/integrations'), 2000);
      } catch (error) {
        if (cancelled) return;
        console.warn('Integration callback verification failed', {
          provider,
          callbackIdPresent: Boolean(connectionId),
          message: error instanceof Error ? error.message : 'Connection verification failed.',
        });
        setState('error');
        setMessage(error instanceof Error ? error.message : 'Connection verification failed.');
      }
    };

    verify();

    return () => {
      cancelled = true;
    };
  }, [authLoading, connectionId, provider, providerName, router, session?.access_token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
      {state === 'verifying' && <Loader2 className="h-10 w-10 animate-spin text-slate-500" />}
      {state === 'success' && <CheckCircle2 className="h-12 w-12 text-emerald-600" />}
      {state === 'error' && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-xl font-semibold text-red-700">
          !
        </div>
      )}

      <h1 className="mt-6 text-2xl font-bold tracking-tight">{message}</h1>
      {state === 'error' && (
        <Button onClick={() => router.push('/integrations')} className="mt-6">
          Back to Integrations
        </Button>
      )}
    </main>
  );
}

function CallbackFallback() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-slate-500" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">Verifying your connection...</h1>
    </main>
  );
}

export default function IntegrationsCallbackPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <Suspense fallback={<CallbackFallback />}>
        <CallbackContent />
      </Suspense>
    </div>
  );
}
