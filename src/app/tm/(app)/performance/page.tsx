'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Sparkles, TrendingUp, TrendingDown, Settings2 } from 'lucide-react';
import { fetcher, apiPost, apiPut, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ProgressRing, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Input, Label, FieldError } from '@/components/ui/Field';
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
}

export default function PerformancePage() {
  const { can } = useSession();
  const [configOpen, setConfigOpen] = useState(false);
  const now = new Date();
  const { data, isLoading, mutate } = useSWR<PerfData>(`/api/tm/performance?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, fetcher);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiPost('/api/tm/performance', {});
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
        subtitle={data ? data.period.label : 'This month'}
        actions={can('tm.performance.configure') && (
          <Button size="sm" variant="secondary" onClick={() => setConfigOpen(true)}>
            <Settings2 className="h-4 w-4" /> Configure weights
          </Button>
        )}
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
