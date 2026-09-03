'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Plus, NotebookPen, ArrowRight } from 'lucide-react';
import { fetcher } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { fmtDate } from '@/lib/format';

interface UpdateItem {
  id: number;
  daily_update_id: number;
  title: string;
  status: string | null;
  task_number: string | null;
  project_name: string | null;
}

interface UpdateRow {
  id: number;
  update_date: string;
  status: string;
  total_hours: string | null;
  summary: string | null;
  item_count: number;
}

export default function DailyUpdatesPage() {
  const { data, isLoading } = useSWR<{ updates: UpdateRow[]; items: UpdateItem[] }>('/api/tm/daily-updates?limit=7', fetcher);

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayUpdate = data?.updates.find((u) => u.update_date === todayStr);

  return (
    <>
      <PageHeader
        title="Daily Updates"
        subtitle="Log and review your day-to-day work"
        actions={
          <Link href="/tm/daily-updates/new">
            <Button size="sm"><Plus className="h-4 w-4" /> New Update</Button>
          </Link>
        }
      />
      <PageBody className="space-y-6">
        {!todayUpdate && (
          <Card className="border-brand/25 bg-brand-soft/30">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <NotebookPen className="h-5 w-5 text-brand" />
                <div>
                  <p className="text-sm font-medium text-ink">You haven&apos;t submitted today&apos;s update</p>
                  <p className="text-xs text-muted">Takes less than a minute — paste your notes and let AI structure them.</p>
                </div>
              </div>
              <Link href="/tm/daily-updates/new">
                <Button size="sm">Submit now</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent updates</h2>
          <Link href="/tm/daily-updates/history" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            View full history <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {isLoading && <Skeleton className="h-64" />}

        {data && data.updates.length === 0 && (
          <EmptyState icon={NotebookPen} title="No Daily Update submitted yet" description="Start building your work history." />
        )}

        <div className="space-y-3">
          {data?.updates.map((u) => {
            const items = data.items.filter((i) => i.daily_update_id === u.id);
            return (
              <Card key={u.id}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">{fmtDate(u.update_date, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                    <span className="text-xs text-faint">{u.total_hours ? `${u.total_hours}h logged` : `${u.item_count} items`}</span>
                  </div>
                  {u.summary && <p className="mt-1.5 text-sm text-muted">{u.summary}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {items.slice(0, 6).map((it) => (
                      <span key={it.id} className="rounded-full bg-line/40 px-2.5 py-1 text-xs text-muted">
                        {it.title}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
