'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Download, FileSpreadsheet, RotateCcw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { fetcher } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, FieldError, FieldHint, PasswordInput } from '@/components/ui/Field';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Skeleton } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

interface TableStat {
  table: string;
  label: string;
  rows: number;
  preserved: boolean;
}

interface ResetPreview {
  confirm_phrase: string;
  reset_code_configured: boolean;
  cleared: TableStat[];
  preserved: TableStat[];
  total_cleared_rows: number;
  total_preserved_rows: number;
}

interface ResetSummary {
  mode: 'backup' | 'reset';
  tables_cleared: number;
  rows_cleared: number;
  rows_exported: number;
  sheets: number;
  truncated_sheets: string[];
  detached: string[];
}

const ENDPOINT = '/api/tm/admin/reset';

/**
 * App Data Reset — Manager-only.
 *
 * Clears everything the app produced while running (tasks, projects, daily
 * updates, approvals, notifications, logs) and leaves every account, login and
 * piece of configuration exactly where it was. Nobody is signed out and nobody
 * re-registers.
 *
 * The Excel backup is not optional: the same request that clears the data
 * returns the workbook, so the download always happens and always matches what
 * was removed.
 */
export function AppDataReset() {
  const { data, isLoading, mutate } = useSWR<ResetPreview>(ENDPOINT, fetcher);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'backup' | 'reset'>('reset');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetSummary | null>(null);
  const toast = useToast();

  const phrase = data?.confirm_phrase ?? 'RESET ALL DATA';
  // The server refuses both actions without TM_RESET_CODE, so say so up front
  // rather than letting someone type a code that can never be right.
  const locked = data ? !data.reset_code_configured : false;

  const start = (next: 'backup' | 'reset') => {
    setMode(next);
    setCode('');
    setConfirm('');
    setError(null);
    setResult(null);
    setOpen(true);
  };

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, reset_code: code, confirm }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'The request could not be completed.');
      }

      // Save the workbook before touching any other state — if the browser is
      // going to block the download, the person should see it here and now.
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
        'aahaas-task-manager-backup.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      let summary: ResetSummary | null = null;
      try {
        summary = JSON.parse(res.headers.get('X-Reset-Summary') ?? 'null');
      } catch {
        // A proxy that strips the header costs the confirmation detail, nothing more.
      }
      setResult(summary);
      setCode('');
      setConfirm('');

      toast({
        kind: 'success',
        title: mode === 'reset' ? 'App data reset' : 'Backup downloaded',
        description:
          mode === 'reset'
            ? `${(summary?.rows_cleared ?? 0).toLocaleString()} records cleared. The Excel backup has been saved to your downloads.`
            : 'The Excel workbook has been saved to your downloads.',
      });
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const canRun = code.length > 0 && (mode === 'backup' || confirm.trim().toUpperCase() === phrase);

  return (
    <div className="space-y-4">
      {locked && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Export and reset are switched off because <span className="font-mono">TM_RESET_CODE</span> is not set on
            the server. Add it to the environment and restart the app.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <FileSpreadsheet className="h-4 w-4 text-muted" /> Export all data
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted">
            Downloads one Excel workbook with a separate tab per table — tasks, projects, daily updates, approvals,
            performance, rewards, logs and the rest — plus a Summary tab. Nothing is changed.
          </p>
          <Button className="mt-3" variant="secondary" onClick={() => start('backup')} disabled={locked}>
            <Download className="h-4 w-4" /> Download Excel backup
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <RotateCcw className="h-4 w-4 text-muted" /> Reset app data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-medium">People are never touched.</span> Accounts, passwords, roles, active
              sessions, departments, teams and settings all stay exactly as they are — nobody is signed out and nobody
              has to register again.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Everything the app has produced is permanently deleted and task numbering restarts from one. The Excel
              backup downloaded during the reset is the only copy.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <TableGroup
                tone="danger"
                icon={<Trash2 className="h-4 w-4" />}
                title="Will be cleared"
                total={data?.total_cleared_rows ?? 0}
                stats={data?.cleared ?? []}
              />
              <TableGroup
                tone="safe"
                icon={<Users className="h-4 w-4" />}
                title="Will be kept"
                total={data?.total_preserved_rows ?? 0}
                stats={data?.preserved ?? []}
              />
            </div>
          )}

          <Button variant="danger" onClick={() => start('reset')} disabled={isLoading || locked}>
            <RotateCcw className="h-4 w-4" /> Reset app data
          </Button>
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => !busy && setOpen(false)} className="max-w-md">
        <OverlayHeader
          title={mode === 'reset' ? 'Reset app data' : 'Download Excel backup'}
          onClose={() => !busy && setOpen(false)}
        />
        <div className="space-y-4 p-4">
          {result ? (
            <ResultPanel result={result} onClose={() => setOpen(false)} />
          ) : (
            <>
              {mode === 'reset' && (
                <div className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-600 dark:text-red-400">
                  <p className="font-medium">
                    {(data?.total_cleared_rows ?? 0).toLocaleString()} records across{' '}
                    {(data?.cleared.length ?? 0).toLocaleString()} tables will be permanently deleted.
                  </p>
                  <p className="mt-1">
                    The Excel backup downloads automatically as part of this step. If your browser blocks downloads for
                    this site, allow it first — the file is not recoverable afterwards.
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="reset-code">Reset password</Label>
                <PasswordInput
                  id="reset-code"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <FieldHint>
                  The reset password held on the server. Asked for every time, before anything is exported or
                  deleted.
                </FieldHint>
              </div>

              {mode === 'reset' && (
                <div>
                  <Label htmlFor="reset-phrase">
                    Type <span className="font-mono text-ink">{phrase}</span> to confirm
                  </Label>
                  <Input
                    id="reset-phrase"
                    autoComplete="off"
                    spellCheck={false}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={phrase}
                  />
                </div>
              )}

              <FieldError>{error}</FieldError>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant={mode === 'reset' ? 'danger' : 'primary'}
                  onClick={run}
                  loading={busy}
                  disabled={!canRun}
                >
                  {mode === 'reset' ? 'Download backup and reset' : 'Download backup'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function TableGroup({
  tone,
  icon,
  title,
  total,
  stats,
}: {
  tone: 'danger' | 'safe';
  icon: React.ReactNode;
  title: string;
  total: number;
  stats: TableStat[];
}) {
  const accent = tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400';
  return (
    <div className="rounded-xl border border-line p-3">
      <div className={`flex items-center gap-1.5 text-sm font-medium ${accent}`}>
        {icon}
        {title}
        <span className="ml-auto text-xs font-normal text-muted">{total.toLocaleString()} records</span>
      </div>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1 text-sm">
        {stats.map((s) => (
          <li key={s.table} className="flex items-center justify-between gap-2">
            <span className="truncate text-muted">{s.label}</span>
            <span className="shrink-0 tabular-nums text-ink">{s.rows.toLocaleString()}</span>
          </li>
        ))}
        {!stats.length && <li className="text-muted">Nothing to show.</li>}
      </ul>
    </div>
  );
}

function ResultPanel({ result, onClose }: { result: ResetSummary; onClose: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-400">
        <p className="font-medium">
          {result.mode === 'reset' ? 'App data has been reset.' : 'Backup downloaded.'}
        </p>
        <p className="mt-1">
          {result.rows_exported.toLocaleString()} records were written to {result.sheets} tabs in the Excel workbook
          {result.mode === 'reset'
            ? `, then ${result.rows_cleared.toLocaleString()} records across ${result.tables_cleared} tables were cleared. Every account and login is untouched.`
            : '. Nothing was changed.'}
        </p>
      </div>

      {result.truncated_sheets?.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          These tabs hit the 50,000-row export cap and are partial: {result.truncated_sheets.join(', ')}.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
