'use client';

import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { fetcher, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader } from '@/components/tm/PageHeader';
import { PriorityBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar, Skeleton } from '@/components/ui/Misc';
import { fmtDueIn } from '@/lib/format';
import { TaskDrawer } from '@/components/tm/TaskDrawer';
import { useToast } from '@/components/ui/Toast';
import { BOARD_STATUSES, STATUS_LABEL, type TaskStatus } from '@/lib/types';

interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  status: TaskStatus;
  priority: string;
  progress: number;
  deadline: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
}

const COLUMN_STYLE: Record<string, string> = {
  TODO: 'border-t-slate-400',
  IN_PROGRESS: 'border-t-blue-500',
  BLOCKED: 'border-t-red-500',
  REVIEW: 'border-t-purple-500',
  COMPLETED: 'border-t-emerald-500',
};

function BoardInner() {
  const { data, isLoading, mutate } = useSWR<{ tasks: TaskRow[] }>('/api/tm/tasks?limit=100&view=team', fetcher);
  const [dragId, setDragId] = useState<number | null>(null);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const toast = useToast();

  const drop = async (status: TaskStatus) => {
    if (!dragId || !data) return;
    const task = data.tasks.find((t) => t.id === dragId);
    if (!task || task.status === status) return;

    mutate({ tasks: data.tasks.map((t) => (t.id === dragId ? { ...t, status } : t)) }, false);
    try {
      await apiPatch(`/api/tm/tasks/${dragId}`, { status });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not move task' });
      mutate();
    }
    setDragId(null);
  };

  return (
    <>
      <PageHeader title="Board" subtitle="Drag cards between columns to update status." />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-96" />)}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto p-4 sm:p-6">
          {BOARD_STATUSES.map((status) => {
            const items = (data?.tasks ?? []).filter((t) => t.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(status)}
                className={`flex w-72 shrink-0 flex-col rounded-2xl border border-t-4 border-line bg-surface ${COLUMN_STYLE[status]}`}
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{STATUS_LABEL[status]}</p>
                  <span className="rounded-full bg-line/50 px-2 py-0.5 text-xs text-muted">{items.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3" style={{ maxHeight: 'calc(100vh - 220px)' }}>
                  {items.map((t) => {
                    const due = fmtDueIn(t.deadline);
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onClick={() => setOpenTask(t.id)}
                        className="animate-fade-up cursor-grab space-y-2 rounded-xl border border-line bg-elevated p-3 shadow-card active:cursor-grabbing"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug text-ink">{t.title}</p>
                          <PriorityBadge priority={t.priority as never} />
                        </div>
                        <p className="text-[11px] text-faint">{t.task_number}</p>
                        <ProgressBar value={t.progress} />
                        <div className="flex items-center justify-between">
                          <Avatar name={t.assignee_name} src={t.assignee_avatar} size="xs" />
                          {t.deadline && (
                            <span className={`text-[11px] font-medium ${due.overdue ? 'text-red-500' : 'text-faint'}`}>{due.label}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && <div className="py-8 text-center text-xs text-faint">No tasks</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {openTask && <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => mutate()} />}
    </>
  );
}

export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <BoardInner />
    </Suspense>
  );
}
