'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  getOnboarding,
  Onboarding,
  updateOnboarding,
} from '@/lib/api/onboarding';

export function useOnboarding() {
  const { session, loading: authLoading } = useAuth();
  const token = session?.access_token;
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!token) return;

    let cancelled = false;

    const fetchOnboarding = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getOnboarding(token);
        if (!cancelled) setOnboarding(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load onboarding.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOnboarding();

    return () => {
      cancelled = true;
    };
  }, [authLoading, token]);

  const patchOnboarding = useCallback(
    async (data: { current_step?: number; completed?: boolean }) => {
      if (!token) {
        throw new Error('You must be signed in to update onboarding.');
      }

      const updated = await updateOnboarding(token, data);
      setOnboarding(updated);
      return updated;
    },
    [token]
  );

  const updateStep = useCallback(
    (step: number) => patchOnboarding({ current_step: step }),
    [patchOnboarding]
  );

  const completeOnboarding = useCallback(
    () => patchOnboarding({ completed: true }),
    [patchOnboarding]
  );

  return { onboarding, loading: authLoading || loading, error, updateStep, completeOnboarding };
}
