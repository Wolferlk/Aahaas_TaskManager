'use client';

import useSWR from 'swr';
import { ShieldCheck, Activity } from 'lucide-react';
import { fetcher } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { Avatar } from '@/components/ui/Avatar';
import { fmtDateTime } from '@/lib/format';

interface AuditRow {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  created_at: string;
}

interface AiUsageRow {
  feature: string;
  calls: number;
  ok: number;
  tokens_in: number;
  tokens_out: number;
}

export default function AdminPage() {
  const { data, isLoading } = useSWR<{ logs: AuditRow[]; total: number; ai_usage: AiUsageRow[] }>(
    '/api/tm/admin/audit?limit=50',
    fetcher,
  );

  return (
    <>
      <PageHeader title="Administration" subtitle="Audit trail and AI usage" />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}
        {data && (
          <>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-muted" /> AI Usage (30 days)</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {data.ai_usage.length === 0 ? (
                  <p className="text-sm text-muted">No AI calls recorded yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {data.ai_usage.map((u) => (
                      <div key={u.feature} className="rounded-xl border border-line p-3">
                        <p className="text-xs font-medium capitalize text-ink">{u.feature.replace(/_/g, ' ')}</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{u.calls}</p>
                        <p className="text-[11px] text-faint">{u.ok}/{u.calls} succeeded</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-muted" /> Audit Log</CardTitle></CardHeader>
              <CardContent className="p-0 pt-0">
                {data.logs.length === 0 ? (
                  <div className="p-5"><EmptyState title="No activity recorded yet" /></div>
                ) : (
                  <div className="divide-y divide-line">
                    {data.logs.map((l) => (
                      <div key={l.id} className="flex items-center gap-3 px-5 py-2.5">
                        <Avatar name={l.full_name} src={l.avatar_url} size="xs" />
                        <p className="min-w-0 flex-1 truncate text-sm text-ink">
                          <span className="font-medium">{l.full_name ?? 'System'}</span>{' '}
                          <span className="text-muted">{l.action.toLowerCase().replace(/_/g, ' ')}</span>
                          {l.entity_type && <span className="text-faint"> · {l.entity_type}#{l.entity_id}</span>}
                        </p>
                        <span className="shrink-0 text-xs text-faint">{fmtDateTime(l.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
