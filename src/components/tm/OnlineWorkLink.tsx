'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, CheckCircle2, Link2, Link2Off, RefreshCw } from 'lucide-react';
import { fetcher, apiPost, apiDelete, ApiClientError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, timeAgo } from '@/lib/format';

interface Overview {
  configured: boolean;
  link: {
    ow_email: string | null;
    ow_name: string | null;
    matched_by: 'EMAIL' | 'USERNAME' | 'CODE';
    linked_at: string;
    last_sync_at: string | null;
    sync_count: number;
  } | null;
  days: Array<{
    filing_date: string;
    outcome: 'SYNCED' | 'CONFLICT' | 'DETACHED' | 'SKIPPED';
    detail: string | null;
    ow_state: 'draft' | 'submitted';
    updated_at: string;
  }>;
  synced_days: number;
  conflicts: number;
}

const MATCHED: Record<string, string> = {
  EMAIL: 'matched by email',
  USERNAME: 'matched by username',
  CODE: 'linked with a code',
};

/**
 * Aahaas Online Work, on the profile.
 *
 * Linked: where the days come from and how it was decided, plus any day both
 * systems wrote, with the choice of which one wins. Not linked: a box for the
 * code Online Work shows under My account → Task Manager.
 */
export function OnlineWorkLink() {
  const push = useToast();
  const { data, mutate } = useSWR<Overview>('/api/tm/integrations/online-work', fetcher);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, work: () => Promise<{ message?: string } | undefined>) => {
    setBusy(key);
    try {
      const res = await work();
      if (res?.message) push({ kind: 'success', title: res.message });
      await mutate();
    } catch (err) {
      push({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'That did not work. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  // Typed the way it is shown — ABCD-EFGH — whatever the person pastes.
  const onCode = (raw: string) => {
    const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
  };

  const redeem = () =>
    run('redeem', async () => {
      const res = await apiPost('/api/tm/integrations/online-work', { action: 'redeem', code });
      setCode('');
      return res;
    });

  const resolve = (date: string, choice: 'online_work' | 'task_manager') =>
    run(`${date}:${choice}`, () => apiPost('/api/tm/integrations/online-work', { action: 'resolve', date, choice }));

  const disconnect = () => {
    if (!confirm('Unlink Online Work? Days you save there will stop appearing here until you link again with a code.')) return;
    void run('unlink', async () => {
      await apiDelete('/api/tm/integrations/online-work');
      return { message: 'Online Work unlinked.' };
    });
  };

  if (!data) return null;
  const conflicts = data.days.filter((d) => d.outcome === 'CONFLICT');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Link2 className="h-4 w-4 text-muted" /> Aahaas Online Work
        </CardTitle>
        {data.link && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Linked
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!data.configured && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            The Online Work bridge is not switched on for this server yet (ONLINE_WORK_SYNC_SECRET is not set).
          </p>
        )}

        {data.link ? (
          <>
            <p className="text-sm text-muted">
              Every day you save on Online Work as{' '}
              <span className="font-medium text-ink">{data.link.ow_email ?? data.link.ow_name ?? 'your account'}</span> is
              copied here as your Daily Update — drafts as drafts, submitted days as submitted.
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Days synced" value={String(data.synced_days)} />
              <Stat label="Last sync" value={data.link.last_sync_at ? timeAgo(data.link.last_sync_at) : '—'} />
              <Stat label="Link" value={MATCHED[data.link.matched_by]} small />
            </div>

            {conflicts.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Days both systems wrote — your version here was kept
                </p>
                {conflicts.map((d) => (
                  <div key={d.filing_date} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-sm font-medium text-ink">
                      {fmtDate(d.filing_date, { weekday: 'short', day: 'numeric', month: 'short' })}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{d.detail}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" loading={busy === `${d.filing_date}:task_manager`} onClick={() => resolve(d.filing_date, 'task_manager')}>
                        Keep mine
                      </Button>
                      <Button size="sm" loading={busy === `${d.filing_date}:online_work`} onClick={() => resolve(d.filing_date, 'online_work')}>
                        <RefreshCw className="h-3.5 w-3.5" /> Use Online Work version
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.days.some((d) => d.outcome !== 'CONFLICT') && (
              <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                {data.days
                  .filter((d) => d.outcome !== 'CONFLICT')
                  .slice(0, 6)
                  .map((d) => (
                    <li key={d.filing_date} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-ink">{fmtDate(d.filing_date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="text-xs text-muted">
                        {d.outcome === 'DETACHED' ? 'Kept Task Manager version' : d.ow_state === 'submitted' ? 'Submitted' : 'Draft'} ·{' '}
                        {timeAgo(d.updated_at)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button size="sm" variant="ghost" loading={busy === 'unlink'} onClick={disconnect}>
                <Link2Off className="h-3.5 w-3.5" /> Unlink
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              If your Online Work email matches this account, the link is made by itself the first time you save a day
              there. If it does not, open <span className="font-medium text-ink">Online Work → My account → Task Manager</span>,
              generate a code and enter it here.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.replace('-', '').length === 8) void redeem();
              }}
            >
              <Input
                value={code}
                onChange={(e) => onCode(e.target.value)}
                placeholder="ABCD-EFGH"
                aria-label="Link code from Online Work"
                autoComplete="one-time-code"
                spellCheck={false}
                className="font-mono tracking-[0.2em]"
              />
              <Button type="submit" loading={busy === 'redeem'} disabled={code.replace('-', '').length !== 8}>
                Link
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border border-line px-2 py-2">
      <p className={small ? 'text-xs font-medium text-ink' : 'text-sm font-semibold text-ink'}>{value}</p>
      <p className="text-[10px] text-faint">{label}</p>
    </div>
  );
}
