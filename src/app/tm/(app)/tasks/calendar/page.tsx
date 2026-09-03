'use client';

import { Suspense, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetcher } from '@/lib/client';
import { PageHeader } from '@/components/tm/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Misc';
import { TaskDrawer } from '@/components/tm/TaskDrawer';
import { cn } from '@/lib/cn';

interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  priority: string;
  deadline: string | null;
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function CalendarInner() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [openTask, setOpenTask] = useState<number | null>(null);

  const from = cursor.toISOString().slice(0, 10);
  const to = addMonths(cursor, 1).toISOString().slice(0, 10);

  const { data, isLoading, mutate } = useSWR<{ tasks: TaskRow[] }>(
    `/api/tm/tasks?view=team&deadline_from=${from}&deadline_to=${to}&limit=200`,
    fetcher,
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of data?.tasks ?? []) {
      if (!t.deadline) continue;
      const key = new Date(t.deadline).toDateString();
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [data]);

  const days = useMemo(() => {
    const first = startOfMonth(cursor);
    const startPad = first.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: Array<Date | null> = Array(startPad).fill(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), i));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const today = new Date().toDateString();

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Tasks by deadline"
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="icon" onClick={() => setCursor((c) => addMonths(c, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="w-36 text-center text-sm font-medium text-ink">
              {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <Button variant="secondary" size="icon" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        {isLoading ? (
          <Skeleton className="h-[600px]" />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line">
            <div className="grid grid-cols-7 border-b border-line bg-line/20">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="px-2 py-2 text-center text-xs font-medium text-muted">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const items = day ? byDay.get(day.toDateString()) ?? [] : [];
                const isToday = day?.toDateString() === today;
                return (
                  <div
                    key={i}
                    className={cn(
                      'min-h-[110px] border-b border-r border-line/60 p-1.5 last:border-r-0',
                      !day && 'bg-line/5',
                    )}
                  >
                    {day && (
                      <>
                        <p className={cn('mb-1 text-xs font-medium', isToday ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-ink' : 'text-faint')}>
                          {day.getDate()}
                        </p>
                        <div className="space-y-1">
                          {items.slice(0, 3).map((t) => (
                            <button
                              key={t.id}
                              onClick={() => setOpenTask(t.id)}
                              className="flex w-full items-center gap-1 truncate rounded-md bg-brand-soft px-1.5 py-0.5 text-left text-[11px] text-brand hover:brightness-95"
                            >
                              {t.title}
                            </button>
                          ))}
                          {items.length > 3 && <p className="px-1.5 text-[10px] text-faint">+{items.length - 3} more</p>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {openTask && <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => mutate()} />}
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarInner />
    </Suspense>
  );
}
