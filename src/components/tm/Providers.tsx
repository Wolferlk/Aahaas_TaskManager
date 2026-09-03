'use client';

import { SWRConfig } from 'swr';
import { fetcher } from '@/lib/client';
import { SessionProvider } from '@/hooks/useSession';
import { ToastProvider } from '@/components/ui/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: false, shouldRetryOnError: false }}>
      <ToastProvider>
        <SessionProvider>{children}</SessionProvider>
      </ToastProvider>
    </SWRConfig>
  );
}
