'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Bell, Check } from 'lucide-react';
import { fetcher, apiPost } from '@/lib/client';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useSession } from '@/hooks/useSession';

interface Notif {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  actor_name: string | null;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { unreadNotifications, refresh } = useSession();

  const { data, mutate } = useSWR<{ notifications: Notif[]; unread: number }>(
    open ? '/api/tm/notifications?limit=20' : null,
    fetcher,
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const markAllRead = async () => {
    await apiPost('/api/tm/notifications', { action: 'read_all' });
    mutate();
    refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring relative flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line/30 hover:text-ink"
        aria-label="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadNotifications > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />
        )}
      </button>

      {open && (
        <div className="animate-scale-in absolute right-0 top-full z-30 mt-2 w-[22rem] origin-top-right rounded-2xl border border-line bg-elevated shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {!!data?.unread && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data && <div className="p-4 text-sm text-muted">Loading...</div>}
            {data?.notifications.length === 0 && (
              <div className="p-6 text-center text-sm text-muted">You&apos;re all caught up.</div>
            )}
            {data?.notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? '/tm/notifications'}
                onClick={() => setOpen(false)}
                className={cn('block border-b border-line/60 px-4 py-3 text-sm hover:bg-line/20 last:border-0', !n.read_at && 'bg-brand-soft/40')}
              >
                <div className="flex items-start gap-2">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', !n.read_at ? 'bg-brand' : 'bg-transparent')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">{n.title}</p>
                    {n.body && <p className="mt-0.5 truncate text-xs text-muted">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-faint">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Link
            href="/tm/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-4 py-2.5 text-center text-xs font-medium text-brand hover:bg-line/20"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
