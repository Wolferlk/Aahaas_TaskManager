'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Download, FileSpreadsheet,
  FolderKanban, HelpCircle, NotebookPen, UserRound, TrendingDown, TrendingUp, Users, UsersRound,
} from 'lucide-react';
import { fetcher } from '@/lib/client';
import { cn } from '@/lib/cn';
import { useMeta } from '@/hooks/useMeta';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';

interface Kpis {
  active: number;
  created: number;
  completed: number;
  completionRate: number | null;
  onTimeRate: number | null;
  overdue: number;
  carriedOver: number;
  avgCycleDays: number | null;
}

interface Preview {
  month: { key: string; label: string };
  previous: { key: string; label: string };
  kpis: Kpis;
  previous_kpis: Kpis;
  daily: Array<{ day: number; created: number; completed: number }>;
  sheets: {
    tasks: number;
    people: number;
    projects: number;
    teams: number;
    attention: number;
    daily_updates: number | null;
    person_tabs: number;
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

export function MonthlyExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;

  // The year being browsed in the picker is separate from the month chosen.
  const [year, setYear] = useState(thisYear);
  const [selected, setSelected] = useState({ y: thisYear, m: thisMonth });
  const [teamId, setTeamId] = useState('ALL');
  const [projectId, setProjectId] = useState('ALL');
  const [assigneeId, setAssigneeId] = useState('ALL');
  const [dailyUpdates, setDailyUpdates] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const { activeTeams, projects, users } = useMeta();

  const key = monthKey(selected.y, selected.m);
  const query = useMemo(() => {
    const p = new URLSearchParams({
      month: key,
      // Month boundaries are drawn on the viewer's clock, not the server's.
      tz: String(new Date().getTimezoneOffset()),
      daily_updates: dailyUpdates ? '1' : '0',
    });
    if (teamId !== 'ALL') p.set('team_id', teamId);
    if (projectId !== 'ALL') p.set('project_id', projectId);
    if (assigneeId !== 'ALL') p.set('assignee_id', assigneeId);
    return p.toString();
  }, [key, teamId, projectId, assigneeId, dailyUpdates]);

  const { data, isLoading, error } = useSWR<Preview>(
    open ? `/api/tm/reports/monthly?format=json&${query}` : null,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const pick = (y: number, m: number) => {
    setYear(y);
    setSelected({ y, m });
  };
  const lastMonth = thisMonth === 1 ? { y: thisYear - 1, m: 12 } : { y: thisYear, m: thisMonth - 1 };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/tm/reports/monthly?${query}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Could not build the report.');
      }
      const blob = await res.blob();
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `Aahaas-Task-Report-${key}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ kind: 'success', title: 'Report downloaded', description: name });
      onClose();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof Error ? err.message : 'Could not build the report.' });
    } finally {
      setDownloading(false);
    }
  };

  const k = data?.kpis;
  const p = data?.previous_kpis;
  const maxDaily = Math.max(1, ...(data?.daily.map((d) => Math.max(d.completed, d.created)) ?? [1]));

  return (
    <Modal open={open} onClose={onClose} title="Monthly Excel export" className="max-w-3xl">
      <OverlayHeader
        title={
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600">
              <FileSpreadsheet className="h-4 w-4" />
            </span>
            Monthly Excel export
          </span>
        }
        subtitle="A designed workbook with the month's tasks, dashboards and scorecards."
        onClose={onClose}
      />

      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Left — choose */}
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">Month</Label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setYear((y) => y - 1)}
                  className="focus-ring rounded-md p-1 text-muted hover:bg-line/40 hover:text-ink"
                  aria-label="Previous year"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="w-12 text-center text-sm font-semibold tabular-nums text-ink">{year}</span>
                <button
                  type="button"
                  onClick={() => setYear((y) => Math.min(thisYear, y + 1))}
                  disabled={year >= thisYear}
                  className="focus-ring rounded-md p-1 text-muted hover:bg-line/40 hover:text-ink disabled:opacity-30"
                  aria-label="Next year"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTHS.map((name, i) => {
                const m = i + 1;
                const future = year > thisYear || (year === thisYear && m > thisMonth);
                const isSelected = selected.y === year && selected.m === m;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={future}
                    onClick={() => pick(year, m)}
                    className={cn(
                      'focus-ring h-9 rounded-lg text-sm font-medium transition-colors',
                      isSelected
                        ? 'bg-brand text-brand-ink shadow-sm'
                        : 'border border-line text-muted hover:border-brand/40 hover:text-ink',
                      future && 'cursor-not-allowed opacity-35 hover:border-line hover:text-muted',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1.5">
              <QuickChip active={key === monthKey(thisYear, thisMonth)} onClick={() => pick(thisYear, thisMonth)}>
                This month
              </QuickChip>
              <QuickChip active={key === monthKey(lastMonth.y, lastMonth.m)} onClick={() => pick(lastMonth.y, lastMonth.m)}>
                Last month
              </QuickChip>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-1">
            <div>
              <Label>Team</Label>
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="!h-9 text-sm">
                <option value="ALL">All teams</option>
                {activeTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="!h-9 text-sm">
                <option value="ALL">All projects</option>
                {projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Person</Label>
              <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="!h-9 text-sm">
                <option value="ALL">Everyone</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-line/15">
            <input
              type="checkbox"
              checked={dailyUpdates}
              onChange={(e) => setDailyUpdates(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Include daily-update hours</span>
              <span className="block text-xs text-muted">A person × day heatmap of hours logged in daily updates.</span>
            </span>
          </label>
        </div>

        {/* Right — preview */}
        <div className="rounded-2xl border border-line bg-line/10 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-ink">{data?.month.label ?? '…'}</p>
            <p className="text-xs text-muted">vs {data?.previous.label ?? '…'}</p>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error.message ?? 'Could not load the preview.'}
            </div>
          ) : !data && isLoading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
              <Skeleton className="h-16" />
              <Skeleton className="h-32" />
            </div>
          ) : k && p ? (
            <div className={cn('space-y-4 transition-opacity', isLoading && 'opacity-60')}>
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Tasks in play" value={k.active} delta={k.active - p.active} />
                <Tile label="Completed" value={k.completed} delta={k.completed - p.completed} good="up" />
                <Tile
                  label="On-time delivery"
                  value={k.onTimeRate === null ? '—' : `${Math.round(k.onTimeRate * 100)}%`}
                  delta={k.onTimeRate !== null && p.onTimeRate !== null ? Math.round((k.onTimeRate - p.onTimeRate) * 100) : null}
                  unit=" pts"
                  good="up"
                />
                <Tile label="Overdue at month end" value={k.overdue} delta={k.overdue - p.overdue} good="down" />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
                  <span>Daily flow</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> completed</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-line" /> created</span>
                  </span>
                </div>
                <div className="flex h-16 items-end gap-[2px]" aria-hidden>
                  {data.daily.map((d) => (
                    <div key={d.day} className="relative flex h-full flex-1 items-end" title={`${d.day}: ${d.completed} completed, ${d.created} created`}>
                      <div className="absolute bottom-0 w-full rounded-t-[2px] bg-line" style={{ height: `${(d.created / maxDaily) * 100}%` }} />
                      <div className="relative w-full rounded-t-[2px] bg-emerald-500" style={{ height: `${(d.completed / maxDaily) * 100}%` }} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Inside the workbook</p>
                <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                  <SheetItem icon={CalendarDays} name="Daily Activity" detail="calendar heatmap" />
                  <SheetItem icon={ClipboardList} name="All Tasks" detail={`${data.sheets.tasks} rows`} />
                  <SheetItem icon={Users} name="People" detail={`${data.sheets.people} people`} />
                  <SheetItem icon={FolderKanban} name="Projects" detail={`${data.sheets.projects} projects`} />
                  <SheetItem icon={UsersRound} name="Teams" detail={`${data.sheets.teams} teams`} />
                  <SheetItem icon={AlertTriangle} name="Needs Attention" detail={`${data.sheets.attention} flagged`} tone={data.sheets.attention ? 'red' : undefined} />
                  {data.sheets.daily_updates !== null && (
                    <SheetItem icon={NotebookPen} name="Daily Updates" detail={`${data.sheets.daily_updates} people`} />
                  )}
                  <SheetItem icon={HelpCircle} name="How to Read" detail="definitions" />
                  <SheetItem icon={UserRound} name="A tab per person" detail={`${data.sheets.person_tabs} leaders & employees`} />
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          Includes every task alive during the month that you can see. Dates use your local time.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={download} loading={downloading} disabled={!!error}>
            {!downloading && <Download className="h-4 w-4" />}
            {downloading ? 'Building…' : 'Download .xlsx'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'focus-ring rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-line/40 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function Tile({
  label,
  value,
  delta,
  unit = '',
  good,
}: {
  label: string;
  value: number | string;
  delta: number | null;
  unit?: string;
  good?: 'up' | 'down';
}) {
  const positive = delta !== null && delta > 0;
  const tone =
    delta === null || delta === 0 || !good
      ? 'text-faint'
      : (positive && good === 'up') || (!positive && good === 'down')
        ? 'text-emerald-600'
        : 'text-red-500';
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <div className="rounded-xl border border-line bg-elevated p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums text-ink">{value}</span>
        {delta !== null && delta !== 0 && (
          <span className={cn('flex items-center gap-0.5 text-xs font-medium tabular-nums', tone)}>
            <Icon className="h-3 w-3" />
            {positive ? '+' : '−'}{Math.abs(delta)}{unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SheetItem({
  icon: Icon,
  name,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  detail: string;
  tone?: 'red';
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-1.5 py-1">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tone === 'red' ? 'text-red-500' : 'text-muted')} />
      <span className="truncate text-ink">{name}</span>
      <span className="ml-auto shrink-0 text-xs text-faint">{detail}</span>
    </li>
  );
}
