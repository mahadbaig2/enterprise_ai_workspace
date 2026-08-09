'use client';

import { useMemo, useState } from 'react';
import { Loader2, Plug } from 'lucide-react';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useIntegrations } from '@/hooks/use-integrations';
import { integrationCards } from '@/lib/integrations';

function StatusBadge({
  status,
  email,
  error,
}: {
  status: string;
  email?: string | null;
  error?: string | null;
}) {
  if (status === 'connected') {
    return (
      <div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
          Connected
        </span>
        {email && <p className="mt-2 text-xs text-slate-500">{email}</p>}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div>
        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
          Error
        </span>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
      Not connected
    </span>
  );
}

export default function IntegrationsPage() {
  const { integrations, loading, error, pendingProvider, connect, disconnect } =
    useIntegrations();
  const [disconnectProvider, setDisconnectProvider] = useState<string | null>(null);

  const integrationsByProvider = useMemo(
    () => new Map(integrations.map((integration) => [integration.provider, integration])),
    [integrations]
  );
  const selectedMeta = integrationCards.find(
    (integration) => integration.provider === disconnectProvider
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Plug className="h-5 w-5" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Connected Apps</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Connect your tools to let the AI search and act across your workspace.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {integrationCards.map((meta) => {
              const integration = integrationsByProvider.get(meta.provider);
              const status = integration?.status ?? 'disconnected';
              const pending = pendingProvider === meta.provider;
              const connected = status === 'connected';

              return (
                <div
                  key={meta.provider}
                  className="rounded-lg border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-md text-sm font-bold ${meta.color}`}
                    >
                      {meta.initials}
                    </div>
                    <StatusBadge
                      status={status}
                      email={integration?.connected_account_email}
                      error={integration?.error_message}
                    />
                  </div>

                  <h2 className="mt-4 text-base font-semibold">{meta.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{meta.description}</p>

                  <Button
                    variant={connected ? 'outline' : 'default'}
                    onClick={() =>
                      connected
                        ? setDisconnectProvider(meta.provider)
                        : connect(meta.provider)
                    }
                    disabled={pending}
                    className={
                      connected
                        ? 'mt-5 w-full border-red-200 text-red-700 hover:bg-red-50'
                        : 'mt-5 w-full'
                    }
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                    {connected ? 'Disconnect' : status === 'error' ? 'Reconnect' : 'Connect'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog
        open={Boolean(disconnectProvider && selectedMeta)}
        title={`Disconnect ${selectedMeta?.name ?? 'integration'}?`}
        description={`Are you sure you want to disconnect ${selectedMeta?.name ?? 'this provider'}? The AI will no longer have access to your ${selectedMeta?.name ?? 'provider'} data.`}
        confirmLabel="Disconnect"
        onCancel={() => setDisconnectProvider(null)}
        onConfirm={() => {
          if (disconnectProvider) disconnect(disconnectProvider);
          setDisconnectProvider(null);
        }}
      />
    </div>
  );
}
