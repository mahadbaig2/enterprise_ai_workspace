'use client';

import { useRouter } from 'next/navigation';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';

export function useAuth() {
  const router = useRouter();
  const { user, session, loading } = useSession();

  const signOut = async (scope: 'global' | 'local' | 'others' = 'local') => {
    const supabase = createClient();
    await supabase.auth.signOut({ scope });
    router.push('/login');
    router.refresh();
  };

  return { user, session, loading, signOut };
}
