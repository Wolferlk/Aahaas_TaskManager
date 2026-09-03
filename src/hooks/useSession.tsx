'use client';

import { createContext, useContext } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client';
import type { Permission } from '@/lib/rbac';
import type { SessionUser } from '@/lib/types';

interface MeResponse {
  user: SessionUser | null;
  permissions?: Permission[];
  unread_notifications?: number;
}

interface SessionContextValue {
  user: SessionUser | null;
  permissions: Permission[];
  unreadNotifications: number;
  loading: boolean;
  can: (p: Permission) => boolean;
  refresh: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading, mutate } = useSWR<MeResponse>('/api/tm/auth/me', fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000,
  });

  const value: SessionContextValue = {
    user: data?.user ?? null,
    permissions: data?.permissions ?? [],
    unreadNotifications: data?.unread_notifications ?? 0,
    loading: isLoading,
    can: (p) => (data?.permissions ?? []).includes(p),
    refresh: () => mutate(),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
