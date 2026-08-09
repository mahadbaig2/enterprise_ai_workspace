import { Button } from '@/components/ui/button';
import { useIntegrations } from '@/hooks/use-integrations';
import { getIntegrationMeta, IntegrationProvider } from '@/lib/integrations';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

export function ConnectToolsStep({
  provider,
  onNext,
}: {
  provider: IntegrationProvider;
  onNext: () => void;
}) {
  const { integrations, loading, error, pendingProvider, connect, test } = useIntegrations();
  const integration = getIntegrationMeta(provider);
  const row = integrations.find((item) => item.provider === provider);
  const status = row?.status ?? 'disconnected';
  const connected = status === 'connected';
  const pending = pendingProvider === provider;

  if (!integration) return null;

  const Icon = integration.icon;

  return (
    <section className="w-full max-w-2xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          Connect {integration.name}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-600">
          This integration is required before your AI workspace dashboard is unlocked.
        </p>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-md ${integration.color}`}>
            <Icon className="h-6 w-6" />
          </div>
          {connected ? (
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
              {row?.connected_account_email && (
                <p className="mt-2 text-xs text-slate-500">{row.connected_account_email}</p>
              )}
            </div>
          ) : status === 'error' ? (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
              Error
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              Not connected
            </span>
          )}
        </div>

        <h2 className="mt-4 text-base font-semibold text-slate-950">{integration.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{integration.description}</p>
        {row?.error_message && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {row.error_message}
          </p>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Button
            variant={connected ? 'outline' : 'default'}
            onClick={() => connect(provider)}
            disabled={loading || pending}
            className="w-full"
          >
            {pending && !connected && <Loader2 className="h-4 w-4 animate-spin" />}
            {connected ? 'Reconnect' : status === 'error' ? 'Retry Connection' : 'Connect'}
          </Button>
          <Button
            variant="outline"
            onClick={() => test(provider)}
            disabled={loading || pending || !connected}
            className="w-full"
          >
            {pending && connected ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Test Access
          </Button>
        </div>
      </div>

      <div className="mt-8 flex justify-center">
        <Button onClick={onNext} disabled={!connected} className="min-w-32">
          Continue
        </Button>
      </div>
    </section>
  );
}
