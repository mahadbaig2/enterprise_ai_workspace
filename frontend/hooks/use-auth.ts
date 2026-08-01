'use client';

import { useRouter } from 'next/navigation';
import { useSession } from '@/components/providers/session-provider';
import { createClient } from '@/lib/supabase/client';

export function useAuth() {
  const router = useRouter();
  const { user, session, loading } = useSession();

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return { user, session, loading, signOut };
}
