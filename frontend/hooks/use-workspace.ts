'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { getWorkspace, Workspace } from '@/lib/api/workspace';

export function useWorkspace() {
  const { session } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchWorkspace = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getWorkspace(session.access_token);
        if (!cancelled) setWorkspace(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load workspace.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchWorkspace();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  return { workspace, loading, error };
}
