'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Select, Input } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton, Divider } from '@/components/ui/Misc';
import { StatusBadge } from '@/components/ui/Badge';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/hooks/useSession';
import { History } from 'lucide-react';

interface UpdateItem {
  id: number;
  daily_update_id: number;
  title: string;
  status: string | null;
  hours: string | null;
  task_number: string | null;
  project_name: string | null;
}

interface UpdateRow {
  id: number;
  update_date: string;
  status: string;
  total_hours: string | null;
  summary: string | null;
  full_name: string;
  avatar_url: string | null;
  team_name: string | null;
  department_name: string | null;
}

export default function DailyUpdateHistoryPage() {
  const { user } = useSession();
  const [scope, setScope] = useState(user?.role === 'EMPLOYEE' ? 'mine' : 'team');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams({
    ...(scope === 'team' ? { scope: 'team' } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: '60',
  });

  const { data, isLoading } = useSWR<{ updates: UpdateRow[]; items: UpdateItem[] }>(`/api/tm/daily-updates?${params}`, fetcher);

  return (
    <>
      <PageHeader title="Daily Update History" subtitle="A timeline of recorded work" />
      <PageBody className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {user?.role !== 'EMPLOYEE' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Scope</label>
                <Select value={scope} onChange={(e) => setScope(e.target.value)} className="!h-9 !w-auto text-sm">
                  <option value="mine">My updates</option>
                  <option value="team">Team</option>
                </Select>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!h-9 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!h-9 text-sm" />
            </div>
          </CardContent>
        </Card>

        {isLoading && <Skeleton className="h-96" />}
        {data && data.updates.length === 0 && <EmptyState icon={History} title="No updates in this range" />}

        <div className="relative space-y-0 pl-6">
          {data?.updates.map((u, i) => {
            const items = data.items.filter((it) => it.daily_update_id === u.id);
            return (
              <div key={u.id} className="relative pb-6">
                {i < data.updates.length - 1 && <div className="absolute -left-[19px] top-8 h-full w-px bg-line" />}
                <div className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand-soft" />
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.full_name} src={u.avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{u.full_name}</p>
                        <p className="text-xs text-faint">{fmtDate(u.update_date, { weekday: 'long', month: 'short', day: 'numeric' })} · {u.team_name ?? u.department_name ?? '—'}</p>
                      </div>
                      {u.total_hours && <span className="shrink-0 text-xs text-muted">{u.total_hours}h</span>}
                    </div>
                    {u.summary && <p className="mt-2 text-sm text-muted">{u.summary}</p>}
                    {items.length > 0 && (
                      <>
                        <Divider className="my-3" />
                        <div className="space-y-1.5">
                          {items.map((it) => (
                            <div key={it.id} className="flex items-center gap-2 text-xs">
                              {it.status && <StatusBadge status={it.status as never} />}
                              <span className="min-w-0 flex-1 truncate text-ink">{it.title}</span>
                              {it.task_number && <span className="shrink-0 text-faint">{it.task_number}</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
