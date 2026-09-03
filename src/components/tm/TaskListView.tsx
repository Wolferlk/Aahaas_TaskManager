'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, LayoutGrid, List as ListIcon, Calendar as CalendarIcon, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { fetcher } from '@/lib/client';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Select } from '@/components/ui/Field';
import { fmtDueIn } from '@/lib/format';
import { TaskDrawer } from './TaskDrawer';

interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  deadline: string | null;
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

interface TasksResponse {
  tasks: TaskRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
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

  useEffect(() => {
    const fromUrl = searchParams.get('task');
    if (fromUrl) setOpenTask(Number(fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeDrawer = () => {
    setOpenTask(null);
    if (searchParams.get('task')) router.replace(window.location.pathname);
  };

  const params = new URLSearchParams({
    ...(view ? { view } : {}),
    ...(status !== 'ALL' ? { status } : {}),
    ...(priority !== 'ALL' ? { priority } : {}),
    ...(q ? { q } : {}),
    sort,
    dir: 'desc',
    page: String(page),
    limit: '25',
    ...extraParams,
  });

  const { data, isLoading, mutate } = useSWR<TasksResponse>(`/api/tm/tasks?${params}`, fetcher, {
    keepPreviousData: true,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Filter tasks..."
            className="focus-ring h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-faint"
          />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!h-9 !w-auto text-sm">
          <option value="ALL">All statuses</option>
          {['DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
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
      ) : !data?.tasks.length ? (
        <EmptyState icon={ListChecks} title="No tasks found" description="Try adjusting your filters, or create a new task." />
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-faint">
                  <th className="px-6 py-2.5">Task</th>
                  <th className="px-3 py-2.5">Assignee</th>
                  <th className="px-3 py-2.5">Priority</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => {
                  const due = fmtDueIn(t.deadline);
                  return (
                    <tr
                      key={t.id}
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
                      <td className="px-3 py-3">
                        <span className={due.overdue ? 'text-xs font-medium text-red-500' : due.soon ? 'text-xs font-medium text-amber-600' : 'text-xs text-muted'}>
                          {due.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-line sm:hidden">
            {data.tasks.map((t) => {
              const due = fmtDueIn(t.deadline);
              return (
                <button key={t.id} onClick={() => setOpenTask(t.id)} className="flex w-full flex-col gap-2 px-4 py-3.5 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{t.title}</p>
                    <PriorityBadge priority={t.priority as never} />
                  </div>
                  <p className="text-xs text-faint">{t.task_number}</p>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={t.status as never} />
                    <span className={due.overdue ? 'text-xs font-medium text-red-500' : 'text-xs text-muted'}>{due.label}</span>
                  </div>
                  <ProgressBar value={t.progress} />
                </button>
              );
            })}
          </div>

          {data.pagination.pages > 1 && (
            <div className="flex items-center justify-between px-6 py-4">
              <p className="text-xs text-muted">
                Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} tasks
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
