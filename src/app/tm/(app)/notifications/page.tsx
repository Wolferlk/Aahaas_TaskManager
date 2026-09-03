'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import { fetcher, apiPost } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { timeAgo } from '@/lib/format';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/cn';

interface Notif {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  actor_name: string | null;
  actor_avatar: string | null;
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading, mutate } = useSWR<{ notifications: Notif[]; unread: number }>(
    `/api/tm/notifications?filter=${filter}`,
    fetcher,
  );
  const { refresh } = useSession();

  const markAllRead = async () => {
    await apiPost('/api/tm/notifications', { action: 'read_all' });
    mutate();
    refresh();
  };

  const markRead = async (id: number) => {
    await apiPost('/api/tm/notifications', { ids: [id] });
    mutate();
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${data?.unread ?? 0} unread`}
        actions={<Button size="sm" variant="secondary" onClick={markAllRead}><Check className="h-4 w-4" /> Mark all read</Button>}
      />
      <div className="px-4 pt-4 sm:px-6">
        <Tabs
          tabs={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'read', label: 'Read' }]}
          active={filter}
          onChange={setFilter}
        />
      </div>
      <PageBody>
        {isLoading && <Skeleton className="h-96" />}
        {data && data.notifications.length === 0 && <EmptyState icon={Bell} title="No notifications" />}
        <div className="space-y-2">
          {data?.notifications.map((n) => (
            <Card key={n.id} className={cn(!n.read_at && 'border-brand/25 bg-brand-soft/20')}>
              <CardContent className="p-4">
                <Link href={n.link ?? '#'} onClick={() => !n.read_at && markRead(n.id)} className="flex items-start gap-3">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', !n.read_at ? 'bg-brand' : 'bg-transparent')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-faint">{timeAgo(n.created_at)}</p>
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}
