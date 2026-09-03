'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Sparkles, Download, BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';
import { fetcher, apiPost, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

interface ReportsData {
  overview: Record<string, number>;
  by_status: Array<{ status: string; c: number }>;
  by_priority: Array<{ priority: string; c: number }>;
  by_department: Array<{ label: string; total: number; completed: number; overdue: number }>;
  trend: Array<{ day: string; created: number; completed: number }>;
  workload: Array<{ id: number; full_name: string; total: number; completed: number; open: number; overdue: number }>;
  projects: Array<{ id: number; name: string; status: string; total: number; completed: number; overdue: number; blocked: number }>;
}

const PRIORITY_COLORS: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#0ea5e9' };
const BRAND = '#4f46e5';

export default function ReportsPage() {
  const { data, isLoading } = useSWR<ReportsData>('/api/tm/reports', fetcher);
  const [summary, setSummary] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiPost('/api/tm/reports', {});
      setSummary(res.summary);
      if (res.message) toast({ kind: 'warning', title: res.message });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not generate summary' });
    } finally {
      setGenerating(false);
    }
  };

  const exportCsv = (dataset: string) => {
    window.open(`/api/tm/reports/export?dataset=${dataset}`, '_blank');
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Company-wide task and productivity analytics"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => exportCsv('tasks')}><Download className="h-4 w-4" /> Export Tasks</Button>
            <Button size="sm" onClick={generate} loading={generating}><Sparkles className="h-4 w-4" /> Weekly Summary</Button>
          </div>
        }
      />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}

        {summary && (
          <Card className="border-brand/25 bg-brand-soft/30">
            <CardContent className="flex items-start gap-3 p-5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <p className="text-sm text-ink">{summary}</p>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total tasks" value={data.overview.total} />
              <Stat label="Completed" value={data.overview.completed} tone="emerald" />
              <Stat label="Overdue" value={data.overview.overdue} tone="red" />
              <Stat label="Blocked" value={data.overview.blocked} tone="amber" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Task Completion Trend (30 days)</CardTitle></CardHeader>
                <CardContent className="h-64 pt-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.trend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-line" />
                      <XAxis dataKey="day" hide />
                      <YAxis width={28} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="created" stroke="#94a3b8" strokeWidth={2} dot={false} name="Created" />
                      <Line type="monotone" dataKey="completed" stroke={BRAND} strokeWidth={2} dot={false} name="Completed" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Priority Distribution</CardTitle></CardHeader>
                <CardContent className="flex h-64 items-center justify-center pt-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.by_priority} dataKey="c" nameKey="priority" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {data.by_priority.map((p) => <Cell key={p.priority} fill={PRIORITY_COLORS[p.priority] ?? '#94a3b8'} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Department Comparison</CardTitle></CardHeader>
                <CardContent className="h-72 pt-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.by_department}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-line" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis width={28} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" />
                      <Bar dataKey="overdue" fill="#ef4444" radius={[4, 4, 0, 0]} name="Overdue" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><BarChart3 className="h-4 w-4 text-muted" /> Workload Distribution</CardTitle>
                <Button size="sm" variant="secondary" onClick={() => exportCsv('workload')}><Download className="h-3.5 w-3.5" /> Export</Button>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0 pt-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-faint">
                      <th className="px-5 py-2">Person</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Completed</th>
                      <th className="px-3 py-2">Open</th>
                      <th className="px-3 py-2">Overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workload.slice(0, 15).map((w) => (
                      <tr key={w.id} className="border-b border-line/60">
                        <td className="px-5 py-2 text-ink">{w.full_name}</td>
                        <td className="px-3 py-2 text-muted">{w.total}</td>
                        <td className="px-3 py-2 text-emerald-600">{w.completed}</td>
                        <td className="px-3 py-2 text-muted">{w.open}</td>
                        <td className="px-3 py-2 text-red-500">{w.overdue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' | 'red' | 'amber' }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className={`text-2xl font-semibold tabular-nums ${tone === 'emerald' ? 'text-emerald-500' : tone === 'red' ? 'text-red-500' : tone === 'amber' ? 'text-amber-600' : 'text-ink'}`}>
          {value ?? 0}
        </p>
        <p className="text-xs text-muted">{label}</p>
      </CardContent>
    </Card>
  );
}
