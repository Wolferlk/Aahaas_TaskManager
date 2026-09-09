'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Sparkles, TrendingUp, TrendingDown, Settings2, Users } from 'lucide-react';
import { fetcher, apiPost, apiPut, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProgressRing, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Input, Label, Select, FieldError } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useSession } from '@/hooks/useSession';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface PerfLine {
  dimension: string;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
  explanation: string;
}

interface TeamRow {
  id: number;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  team_name: string | null;
  score: number;
  tasks_completed: number;
  tasks_assigned: number;
  tasks_overdue: number;
  deadline_met_rate: number;
  daily_updates_submitted: number;
}

interface PerfData {
  user: { id: number; full_name: string };
  period: { year: number; month: number; label: string };
  metrics: Record<string, number>;
  score: number;
  previous_score: number;
  delta: number;
  breakdown: PerfLine[];
  weights: Record<string, number>;
  ai_analysis: { strengths: string[]; improvements: string[]; summary: string } | null;
  people: Array<{ id: number; full_name: string; role: string; team_name: string | null }>;
  team: TeamRow[];
  can_view_others: boolean;
}

export default function PerformancePage() {
  const { can, user } = useSession();
  const [configOpen, setConfigOpen] = useState(false);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Whose numbers are on screen. Managers and Leaders can point this at anyone
  // they supervise; for everyone else it stays on themselves.
  const [viewingId, setViewingId] = useState<string>('');

  const { data, isLoading, mutate } = useSWR<PerfData>(
    `/api/tm/performance?year=${year}&month=${month}${viewingId ? `&user_id=${viewingId}` : ''}`,
    fetcher,
  );
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const viewingSelf = !viewingId || Number(viewingId) === user?.id;

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiPost('/api/tm/performance', viewingSelf ? {} : { user_id: Number(viewingId), year, month });
      toast({ kind: res.ai_used ? 'success' : 'warning', title: res.ai_used ? 'Analysis generated' : res.message });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not generate analysis' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={data ? `${data.user.full_name} · ${data.period.label}` : 'This month'}
        actions={
          <div className="flex items-center gap-2">
            {data?.can_view_others && data.people.length > 1 && (
              <Select
                aria-label="Whose performance to show"
                value={viewingId || String(user?.id ?? '')}
                onChange={(e) => setViewingId(e.target.value)}
                className="!h-9 !w-auto text-sm"
              >
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                    {p.id === user?.id ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            )}
            {can('tm.performance.configure') && (
              <Button size="sm" variant="secondary" onClick={() => setConfigOpen(true)}>
                <Settings2 className="h-4 w-4" /> Configure weights
              </Button>
            )}
          </div>
        }
      />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}
        {data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardContent className="flex flex-col items-center p-6 text-center">
                <ProgressRing value={data.score} size={120} stroke={10}>
                  <div>
                    <p className="text-3xl font-bold text-ink">{Math.round(data.score)}</p>
                    <p className="text-[10px] text-faint">/ 100</p>
                  </div>
                </ProgressRing>
                <div className={cn('mt-3 flex items-center gap-1 text-sm font-medium', data.delta >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                  {data.delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {Math.abs(data.delta)} vs last month
                </div>
                <div className="mt-6 grid w-full grid-cols-2 gap-3 text-left">
                  <Stat label="Completed" value={data.metrics.tasks_completed} />
                  <Stat label="Assigned" value={data.metrics.tasks_assigned} />
                  <Stat label="Deadlines met" value={`${Math.round(data.metrics.deadline_met_rate)}%`} />
                  <Stat label="Overdue" value={data.metrics.tasks_overdue} />
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>How this score is calculated</CardTitle></CardHeader>
              <CardContent className="space-y-4 pt-0">
                {data.breakdown.map((line) => (
                  <div key={line.dimension}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-ink">{line.label}</span>
                      <span className="text-muted">{Math.round(line.normalized)}/100 × {line.weight}%</span>
                    </div>
                    <ProgressBar value={line.normalized} className="mt-1.5" />
                    <p className="mt-1 text-xs text-muted">{line.explanation}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-brand" /> AI Analysis</CardTitle>
                <Button size="sm" variant="secondary" onClick={generate} loading={generating}>Generate</Button>
              </CardHeader>
              <CardContent className="pt-0">
                {!data.ai_analysis ? (
                  <p className="text-sm text-muted">No analysis generated yet for this period. Click Generate to create one from your recorded metrics.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Strengths</p>
                      <ul className="space-y-1 text-sm text-ink">
                        {data.ai_analysis.strengths.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Areas to improve</p>
                      <ul className="space-y-1 text-sm text-ink">
                        {data.ai_analysis.improvements.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                    <div className="sm:col-span-2 rounded-xl bg-brand-soft/50 p-3.5 text-sm text-ink">{data.ai_analysis.summary}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {data.can_view_others && data.team.length > 0 && (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-muted" /> Team performance · {data.period.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                          <th className="px-5 py-2 font-semibold">Person</th>
                          <th className="px-3 py-2 text-right font-semibold">Score</th>
                          <th className="px-3 py-2 text-right font-semibold">Assigned</th>
                          <th className="px-3 py-2 text-right font-semibold">Completed</th>
                          <th className="px-3 py-2 text-right font-semibold">Overdue</th>
                          <th className="px-3 py-2 text-right font-semibold">Deadlines met</th>
                          <th className="px-5 py-2 text-right font-semibold">Updates</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {data.team.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => setViewingId(String(row.id))}
                            className={cn(
                              'cursor-pointer transition-colors hover:bg-line/20',
                              row.id === data.user.id && 'bg-brand-soft/40',
                            )}
                          >
                            <td className="px-5 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Avatar name={row.full_name} src={row.avatar_url} size="xs" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink">{row.full_name}</p>
                                  <p className="truncate text-[11px] text-faint">
                                    {row.job_title ?? row.team_name ?? '—'}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-ink">{Math.round(row.score)}</td>
                            <td className="px-3 py-2.5 text-right text-muted">{row.tasks_assigned}</td>
                            <td className="px-3 py-2.5 text-right text-muted">{row.tasks_completed}</td>
                            <td className={cn('px-3 py-2.5 text-right', row.tasks_overdue > 0 ? 'text-red-500' : 'text-muted')}>
                              {row.tasks_overdue}
                            </td>
                            <td className="px-3 py-2.5 text-right text-muted">{Math.round(row.deadline_met_rate)}%</td>
                            <td className="px-5 py-2.5 text-right text-muted">{row.daily_updates_submitted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="px-5 py-3 text-xs text-faint">Select a row to open that person&apos;s full breakdown.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </PageBody>
      {data && <WeightsModal open={configOpen} onClose={() => setConfigOpen(false)} weights={data.weights} onSaved={() => mutate()} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-line/20 p-3">
      <p className="text-lg font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-faint">{label}</p>
    </div>
  );
}

function WeightsModal({ open, onClose, weights, onSaved }: { open: boolean; onClose: () => void; weights: Record<string, number>; onSaved: () => void }) {
  const [values, setValues] = useState(weights);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const total = Object.values(values).reduce((a, b) => a + Number(b || 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPut('/api/tm/performance/config', values);
      toast({ kind: 'success', title: 'Weights updated' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save weights.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Configure performance weights">
      <OverlayHeader title="Performance Weights" subtitle="Must total 100%" onClose={onClose} />
      <form onSubmit={submit} className="space-y-3 p-6">
        {Object.entries(values).map(([key, v]) => (
          <div key={key} className="flex items-center gap-3">
            <Label className="mb-0 flex-1 capitalize">{key.replace(/_/g, ' ')}</Label>
            <Input
              type="number"
              min="0"
              max="100"
              value={v}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
              className="!w-20"
            />
            <span className="text-sm text-muted">%</span>
          </div>
        ))}
        <p className={cn('text-sm font-medium', total === 100 ? 'text-emerald-500' : 'text-red-500')}>Total: {total}%</p>
        <FieldError>{error}</FieldError>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={total !== 100}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
