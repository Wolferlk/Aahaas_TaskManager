'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, List as ListIcon, Calendar as CalendarIcon, ListChecks, FilterX, Timer } from 'lucide-react';
import Link from 'next/link';
import { fetcher } from '@/lib/client';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Select, SearchInput } from '@/components/ui/Field';
import { fmtDate, fmtDueIn, pluralize } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '@/lib/types';
import { TaskDrawer } from './TaskDrawer';

interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  deadline: string | null;
  created_at: string;
  completed_at: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  project_name: string | null;
  project_color: string | null;
  team_name: string | null;
  is_overdue: number;
  subtask_count: number;
  subtask_done: number;
  comment_count: number;
}

/** A piece of work someone filed in a Daily Update (typed in, or synced from Online Work). */
interface DailyRow {
  id: number;
  daily_update_id: number;
  update_date: string;
  update_status: 'DRAFT' | 'SUBMITTED';
  user_id: number;
  user_name: string;
  user_avatar: string | null;
  title: string;
  topic: string | null;
  description: string | null;
  status: string | null;
  priority: string | null;
  progress: number | null;
  hours: string | number | null;
  project_name: string | null;
  project_color: string | null;
}

interface TasksResponse {
  tasks: TaskRow[];
  /** Present when Daily Update entries were asked for (Team Tasks). */
  daily_items?: DailyRow[];
  /** The page order across both kinds, when they are mixed. */
  order?: Array<{ kind: 'task' | 'daily'; id: number }>;
  /** Whether this reader may list Daily Update entries here at all. */
  daily_available?: boolean;
  pagination: { page: number; limit: number; total: number; pages: number };
}

type WorkSource = 'all' | 'tasks' | 'daily';

type WorkRow = { kind: 'task'; task: TaskRow } | { kind: 'daily'; item: DailyRow };

const SOURCES: Array<[WorkSource, string]> = [
  ['all', 'All work'],
  ['tasks', 'Tasks'],
  ['daily', 'Daily Updates'],
];

const asStatus = (s: string | null): TaskStatus | null =>
  s && (TASK_STATUSES as string[]).includes(s) ? (s as TaskStatus) : null;

const asPriority = (p: string | null): Priority | null =>
  p && (PRIORITIES as string[]).includes(p) ? (p as Priority) : null;

const fmtHours = (h: number) => `${Math.round(h * 100) / 100}h`;

/** Puts the page back in the order the server ranked it, across tasks and Daily Update entries. */
function toRows(data: TasksResponse): WorkRow[] {
  if (!data.order) return data.tasks.map((task) => ({ kind: 'task', task }));
  const tasks = new Map(data.tasks.map((t) => [Number(t.id), t]));
  const items = new Map((data.daily_items ?? []).map((i) => [Number(i.id), i]));
  const rows: WorkRow[] = [];
  for (const { kind, id } of data.order) {
    if (kind === 'task') {
      const task = tasks.get(id);
      if (task) rows.push({ kind, task });
    } else {
      const item = items.get(id);
      if (item) rows.push({ kind, item });
    }
  }
  return rows;
}

export function TaskListView({
  view,
  extraParams,
  showViewSwitch = true,
}: {
  view?: string;
  extraParams?: Record<string, string>;
  showViewSwitch?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [status, setStatus] = useState('ALL');
  const [priority, setPriority] = useState('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('created_at');
  const [page, setPage] = useState(1);
  // Team Tasks also lists what people filed in their Daily Updates.
  const mixesDaily = view === 'team';
  const [source, setSource] = useState<WorkSource>('all');

  useEffect(() => {
    const fromUrl = searchParams.get('task');
    if (fromUrl) setOpenTask(Number(fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeDrawer = () => {
    setOpenTask(null);
    if (searchParams.get('task')) router.replace(window.location.pathname);
  };

  // A link can narrow the list to one person, e.g. from My People. The prop
  // still wins, so a page that hard-scopes itself is never overridden by a URL.
  const urlAssignee = searchParams.get('assignee_id');
  const assigneeFilter: Record<string, string> =
    !extraParams?.assignee_id && urlAssignee && Number(urlAssignee) > 0
      ? { assignee_id: urlAssignee }
      : {};

  const params = new URLSearchParams({
    ...(view ? { view } : {}),
    ...assigneeFilter,
    ...(status !== 'ALL' ? { status } : {}),
    ...(priority !== 'ALL' ? { priority } : {}),
    ...(q ? { q } : {}),
    sort,
    dir: 'desc',
    page: String(page),
    limit: '25',
    ...(mixesDaily ? { source } : {}),
    ...extraParams,
  });

  const { data, isLoading, mutate } = useSWR<TasksResponse>(`/api/tm/tasks?${params}`, fetcher, {
    keepPreviousData: true,
  });

  const rows = data ? toRows(data) : [];
  const showSourceSwitch = mixesDaily && Boolean(data?.daily_available);
  const mixed = showSourceSwitch && source !== 'tasks';
  const itemWord = !mixed ? 'task' : source === 'daily' ? 'entry' : 'item';
  const openDaily = (item: DailyRow) =>
    router.push(`/tm/daily-updates/history?user=${item.user_id}&date=${item.update_date}`);

  const filtersActive = q !== '' || status !== 'ALL' || priority !== 'ALL' || sort !== 'created_at';
  const clearFilters = () => {
    setQ('');
    setStatus('ALL');
    setPriority('ALL');
    setSort('created_at');
    setPage(1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
        <SearchInput
          value={q}
          onValueChange={(v) => { setQ(v); setPage(1); }}
          placeholder="Filter tasks..."
          className="flex-1 min-w-[180px] max-w-xs"
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!h-9 !w-auto text-sm">
          <option value="ALL">All statuses</option>
          {['DRAFT', 'TODO', 'IN_PROGRESS', 'REOPENED', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </Select>
        <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }} className="!h-9 !w-auto text-sm">
          <option value="ALL">All priorities</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => (
            <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="!h-9 !w-auto text-sm">
          <option value="created_at">Newest</option>
          <option value="deadline">Deadline</option>
          <option value="priority">Priority</option>
          <option value="progress">Progress</option>
        </Select>
        {showSourceSwitch && (
          <div className="inline-flex h-9 items-center rounded-lg border border-line bg-surface p-0.5 text-xs" role="group" aria-label="Show">
            {SOURCES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={source === value}
                onClick={() => { setSource(value); setPage(1); }}
                className={cn(
                  'focus-ring h-full rounded-md px-2.5 font-medium transition-colors',
                  source === value ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="focus-ring flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-line/30 hover:text-ink"
          >
            <FilterX className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
        {showViewSwitch && (
          <div className="ml-auto flex items-center gap-1">
            <Link href="/tm/tasks/board" className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-faint hover:bg-line/30 hover:text-ink">
              <LayoutGrid className="h-4 w-4" />
            </Link>
            <Link href="/tm/tasks/calendar" className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-faint hover:bg-line/30 hover:text-ink">
              <CalendarIcon className="h-4 w-4" />
            </Link>
            <button className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4 sm:p-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : !rows.length ? (
        <EmptyState
          icon={ListChecks}
          title={!mixed ? 'No tasks found' : source === 'daily' ? 'No Daily Update entries found' : 'No work found'}
          description={
            mixed
              ? 'Try adjusting your filters. Daily Update entries have no deadline, so deadline-based filters leave them out.'
              : 'Try adjusting your filters, or create a new task.'
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-faint">
                  <th className="px-6 py-2.5">{mixed ? 'Work' : 'Task'}</th>
                  <th className="px-3 py-2.5">{mixed ? 'Person' : 'Assignee'}</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">{mixed ? 'Created / Filed' : 'Created'}</th>
                  <th className="px-3 py-2.5">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if (row.kind === 'daily') {
                    return <DailyTableRow key={`d-${row.item.id}`} item={row.item} onOpen={() => openDaily(row.item)} />;
                  }
                  const t = row.task;
                  const due = fmtDueIn(t.deadline);
                  return (
                    <tr
                      key={`t-${t.id}`}
                      onClick={() => setOpenTask(t.id)}
                      className="cursor-pointer border-b border-line/60 hover:bg-line/15"
                    >
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {t.project_color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.project_color }} />}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{t.title}</p>
                            <p className="truncate text-xs text-faint">{t.task_number}{t.project_name ? ` · ${t.project_name}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {t.assignee_name ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={t.assignee_name} src={t.assignee_avatar} size="xs" />
                            <span className="truncate text-xs text-muted">{t.assignee_name}</span>
                          </div>
                        ) : <span className="text-xs text-faint">Unassigned</span>}
                      </td>
                      <td className="px-3 py-3"><PriorityBadge priority={t.priority as never} /></td>
                      <td className="px-3 py-3"><StatusBadge status={t.status as never} /></td>
                      <td className="px-3 py-3 w-32">
                        <ProgressBar value={t.progress} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className="text-xs text-muted">{fmtDate(t.created_at)}</p>
                        {t.completed_at && <p className="text-xs text-faint">Done {fmtDate(t.completed_at)}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <p className={due.overdue ? 'text-xs font-medium text-red-500' : due.soon ? 'text-xs font-medium text-amber-600' : 'text-xs text-muted'}>
                          {due.label}
                        </p>
                        {t.deadline && <p className="text-xs text-faint">{fmtDate(t.deadline)}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-line sm:hidden">
            {rows.map((row) => {
              if (row.kind === 'daily') {
                return <DailyCard key={`d-${row.item.id}`} item={row.item} onOpen={() => openDaily(row.item)} />;
              }
              const t = row.task;
              const due = fmtDueIn(t.deadline);
              return (
                <button key={`t-${t.id}`} onClick={() => setOpenTask(t.id)} className="flex w-full flex-col gap-2 px-4 py-3.5 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{t.title}</p>
                    <PriorityBadge priority={t.priority as never} />
                  </div>
                  <p className="text-xs text-faint">{t.task_number} · Created {fmtDate(t.created_at)}</p>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={t.status as never} />
                    <span className={due.overdue ? 'text-xs font-medium text-red-500' : 'text-xs text-muted'}>
                      {due.label}{t.deadline ? ` · ${fmtDate(t.deadline)}` : ''}
                    </span>
                  </div>
                  <ProgressBar value={t.progress} />
                </button>
              );
            })}
          </div>

          {data && data.pagination.pages > 1 && (
            <div className="flex items-center justify-between px-6 py-4">
              <p className="text-xs text-muted">
                Page {data.pagination.page} of {data.pagination.pages} ·{' '}
                {pluralize(data.pagination.total, itemWord, itemWord === 'entry' ? 'entries' : undefined)}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={page >= data.pagination.pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {openTask && <TaskDrawer taskId={openTask} onClose={closeDrawer} onChanged={() => mutate()} />}
    </div>
  );
}

/**
 * A Daily Update entry as a row of the table. It has no deadline or task
 * number of its own; opening it goes to that person's day in the history.
 */
function DailyTableRow({ item, onOpen }: { item: DailyRow; onOpen: () => void }) {
  const status = asStatus(item.status);
  const priority = asPriority(item.priority);
  const hours = Number(item.hours ?? 0);
  const subline = [item.topic, item.project_name].filter(Boolean).join(' · ');
  return (
    <tr
      onClick={onOpen}
      title="Open this Daily Update"
      className="cursor-pointer border-b border-line/60 bg-violet-500/[0.025] hover:bg-line/15"
    >
      <td className="px-6 py-3">
        <div className="flex items-center gap-2">
          {item.project_color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.project_color }} />}
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{item.title}</p>
            <p className="truncate text-xs text-faint">
              Filed in a Daily Update{subline && ` · ${subline}`}
              {item.update_status === 'DRAFT' && (
                <span className="ml-1.5 font-medium text-amber-600 dark:text-amber-400">· Draft</span>
              )}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Avatar name={item.user_name} src={item.user_avatar} size="xs" />
          <span className="truncate text-xs text-muted">{item.user_name}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        {priority ? <PriorityBadge priority={priority} /> : <span className="text-xs text-faint">—</span>}
      </td>
      <td className="px-3 py-3">
        {status ? <StatusBadge status={status} /> : <span className="text-xs text-muted">{item.status ?? '—'}</span>}
      </td>
      <td className="px-3 py-3 w-32">
        {item.progress !== null ? <ProgressBar value={item.progress} /> : <span className="text-xs text-faint">—</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <p className="text-xs text-muted">Filed {fmtDate(item.update_date)}</p>
        {hours > 0 && (
          <p className="flex items-center gap-1 text-xs text-faint">
            <Timer className="h-3 w-3" /> {fmtHours(hours)} logged
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <p className="text-xs text-faint">No deadline</p>
      </td>
    </tr>
  );
}

function DailyCard({ item, onOpen }: { item: DailyRow; onOpen: () => void }) {
  const status = asStatus(item.status);
  const priority = asPriority(item.priority);
  const hours = Number(item.hours ?? 0);
  return (
    <button onClick={onOpen} className="flex w-full flex-col gap-2 bg-violet-500/[0.025] px-4 py-3.5 text-left">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{item.title}</p>
          <p className="text-xs text-faint">Filed in a Daily Update</p>
        </div>
        {priority && <PriorityBadge priority={priority} />}
      </div>
      <p className="text-xs text-faint">
        {item.user_name} · Filed {fmtDate(item.update_date)}
        {hours > 0 && ` · ${fmtHours(hours)}`}
        {item.update_status === 'DRAFT' && ' · Draft'}
      </p>
      <div>
        {status ? <StatusBadge status={status} /> : item.status && <span className="text-xs text-muted">{item.status}</span>}
      </div>
      {item.progress !== null && <ProgressBar value={item.progress} />}
    </button>
  );
}
