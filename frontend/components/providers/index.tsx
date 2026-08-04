'use client';

import { ReactNode } from 'react';
import { SessionProvider } from './session-provider';
import { ToastProvider } from '@/hooks/use-toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
