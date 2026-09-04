'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Clock, Bot, Play, AlertTriangle, CheckCircle2, Terminal } from 'lucide-react';
import { fetcher, apiPost, apiPut, ApiClientError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/format';

interface AutoConfig {
  enabled: boolean;
  hour: number;
  minute: number;
  notify_user: boolean;
  notify_when_empty: boolean;
  max_users: number;
}

interface AutoRun {
  run_key: string;
  run_date: string;
  trigger_source: string;
  users_considered: number;
  users_submitted: number;
  users_skipped: number;
  users_failed: number;
  commits_used: number;
  duration_ms: number | null;
  created_at: string;
}

interface AutoData {
  config: AutoConfig;
  date: string;
  cron_secret_configured: boolean;
  outstanding: number;
  runs: AutoRun[];
}

const SETTING_KEY = 'daily_update_auto_submit';

/**
 * Manager control for the Daily Update cut-off.
 *
 * The sweep is disclosed here rather than hidden: what time it runs, how many
 * people it would file for right now, and every run it has made.
 */
export function AutoSubmitSettings() {
  const { data, isLoading, mutate } = useSWR<AutoData>('/api/tm/cron/daily-update', fetcher);
  const [config, setConfig] = useState<AutoConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (data?.config) setConfig(data.config);
  }, [data?.config]);

  const save = async (next: AutoConfig) => {
    setConfig(next);
    setSaving(true);
    try {
      await apiPut('/api/tm/settings', { key: SETTING_KEY, value: next });
      toast({ kind: 'success', title: 'Saved' });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await apiPost('/api/tm/cron/daily-update', {});
      toast({
        kind: res.ran ? 'success' : 'warning',
        title: res.ran
          ? `${res.submitted} filed, ${res.skipped} skipped, ${res.failed} failed.`
          : (res.reason ?? 'Nothing to do.'),
      });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'The run could not start.' });
    } finally {
      setRunning(false);
    }
  };

  if (isLoading || !config) return <Skeleton className="h-96" />;

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Bot className="h-4 w-4 text-muted" /> Automatic daily update
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm text-muted">
            When the cut-off passes and someone has not submitted their daily update, their GitHub commits for
            that day are read and filed as their update. An existing draft is kept and added to, a day with no
            commits is left alone, and every automatic update is marked for the author to review.
          </p>

          <label className="flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => save({ ...config, enabled: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            Turn on automatic submission
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Cut-off hour</Label>
              <Select
                value={String(config.hour)}
                onChange={(e) => save({ ...config, hour: Number(e.target.value) })}
                className="!h-9 text-sm"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{pad(h)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Minute</Label>
              <Select
                value={String(config.minute)}
                onChange={(e) => save({ ...config, minute: Number(e.target.value) })}
                className="!h-9 text-sm"
              >
                {[0, 15, 30, 45].map((m) => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Max people per run</Label>
              <Input
                type="number"
                min="1"
                max="2000"
                value={config.max_users}
                onChange={(e) => setConfig({ ...config, max_users: Number(e.target.value) })}
                onBlur={() => save(config)}
                className="!h-9 text-sm"
              />
            </div>
            <div className="flex items-end">
              <p className="pb-2 text-xs text-faint">Server local time</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={config.notify_user}
                onChange={(e) => save({ ...config, notify_user: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Notify the author when an update is filed for them
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={config.notify_when_empty}
                onChange={(e) => save({ ...config, notify_when_empty: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Notify people who had no commits, so the gap is visible
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-line/20 px-3.5 py-3">
            <Clock className="h-4 w-4 shrink-0 text-muted" />
            <span className="text-sm text-muted">
              Next cut-off {pad(config.hour)}:{pad(config.minute)} ·{' '}
              <strong className="text-ink">{data?.outstanding ?? 0}</strong> {data?.outstanding === 1 ? 'person has' : 'people have'}{' '}
              not submitted for {data?.date}
            </span>
            <Button size="sm" variant="secondary" onClick={runNow} loading={running} disabled={saving}>
              <Play className="h-3.5 w-3.5" /> Run now
            </Button>
          </div>

          {!data?.cron_secret_configured && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The app&apos;s own timer runs the sweep. To drive it from an external scheduler instead, set{' '}
                <code className="font-mono">TM_CRON_SECRET</code> and call{' '}
                <code className="font-mono">POST /api/tm/cron/daily-update</code> with it.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-muted" /> Recent runs
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!data?.runs.length && <p className="text-sm text-muted">No automatic run has happened yet.</p>}
          <div className="space-y-2">
            {data?.runs.map((run) => (
              <div key={run.run_key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-xs">
                {run.users_failed ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                )}
                <span className="font-medium text-ink">{run.run_date}</span>
                <span className="rounded-full bg-line/40 px-2 py-0.5 text-faint">{run.trigger_source}</span>
                <span className="text-muted">
                  {run.users_submitted} filed · {run.users_skipped} skipped
                  {run.users_failed ? ` · ${run.users_failed} failed` : ''} · {run.commits_used} commits
                </span>
                <span className="ml-auto text-faint">{fmtDateTime(run.created_at)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
