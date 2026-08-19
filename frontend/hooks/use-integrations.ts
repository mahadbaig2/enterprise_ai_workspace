'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  connectIntegration,
  disconnectIntegration,
  getIntegrations,
  Integration,
  testIntegration,
  syncIntegration,
} from '@/lib/api/integrations';

export function useIntegrations() {
  const { session, loading: authLoading } = useAuth();
  const token = session?.access_token;
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;

    try {
      setLoading(true);
      setError(null);
      setIntegrations(await getIntegrations(token));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading || !token) return;
    void Promise.resolve().then(refresh);
  }, [authLoading, refresh, token]);

  const connect = useCallback(
    async (provider: string) => {
      if (!token) {
        setError('You must be signed in to connect an integration.');
        return;
      }

      try {
        setPendingProvider(provider);
        setError(null);
        const response = await connectIntegration(provider, token);
        window.location.href = response.redirect_url;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to connect integration.');
        setPendingProvider(null);
      }
    },
    [token]
  );

  const disconnect = useCallback(
    async (provider: string) => {
      if (!token) {
        setError('You must be signed in to disconnect an integration.');
        return;
      }

      try {
        setPendingProvider(provider);
        setError(null);
        await disconnectIntegration(provider, token);
        await refresh();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to disconnect integration.');
      } finally {
        setPendingProvider(null);
      }
    },
    [refresh, token]
  );

  const test = useCallback(
    async (provider: string) => {
      if (!token) {
        setError('You must be signed in to test an integration.');
        return false;
      }

      try {
        setPendingProvider(provider);
        setError(null);
        await testIntegration(provider, token);
        await refresh();
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to test integration.');
        return false;
      } finally {
        setPendingProvider(null);
      }
    },
    [refresh, token]
  );

  const sync = useCallback(
    async (provider: string) => {
      if (!token) {
        setError('You must be signed in to sync an integration.');
        return false;
      }

      try {
        setPendingProvider(provider);
        setError(null);
        await syncIntegration(provider, token);
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to sync integration.');
        return false;
      } finally {
        setPendingProvider(null);
      }
    },
    [token]
  );

  const connectedProviders = useMemo(
    () =>
      new Set(
        integrations
          .filter((integration) => integration.status === 'connected')
          .map((integration) => integration.provider)
      ),
    [integrations]
  );

  return {
    integrations,
    connectedProviders,
    loading: authLoading || loading,
    error,
    pendingProvider,
    connect,
    disconnect,
    test,
    sync,
    refresh,
  };
}
