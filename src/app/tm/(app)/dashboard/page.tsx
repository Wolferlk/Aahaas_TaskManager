'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Sparkles, CheckCircle2, AlertTriangle, Clock, ListChecks, Ban, Eye,
  TrendingUp, Users, ClipboardCheck, ArrowRight, NotebookPen,
} from 'lucide-react';
import { fetcher } from '@/lib/client';
import { useSession } from '@/hooks/useSession';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { PriorityBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, ProgressRing, Skeleton } from '@/components/ui/Misc';
import { fmtDueIn, timeAgo, pluralize } from '@/lib/format';
import { TaskDrawer } from '@/components/tm/TaskDrawer';

interface DashboardData {
  counters: Record<string, number>;
  today: TaskRow[];
  overdue: TaskRow[];
  upcoming: TaskRow[];
  focus: Array<TaskRow & { score: number; reasons: string[] }>;
  recent_activity: Array<{ action: string; field: string | null; created_at: string; task_id: number; task_number: string; title: string; full_name: string | null; avatar_url: string | null }>;
  daily_update: { id: number; status: string } | null;
  performance: { score: number; metrics: Record<string, number> };
  team_workload: Array<{
    id: number; full_name: string; avatar_url: string | null; availability: string;
    open_tasks: number; critical_tasks: number; overdue_tasks: number; due_today: number;
    blocked_tasks: number; remaining_hours: number; completed_week: number;
  }>;
  pending_approvals: number;
}

interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  status: string;
  priority: string;
  progress: number;
  deadline: string | null;
  project_name: string | null;
  project_color: string | null;
  assignee_name?: string | null;
  assignee_avatar?: string | null;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTIVITY_LABEL: Record<string, string> = {
  CREATED: 'created',
  STATUS_CHANGED: 'changed status on',
  COMMENT_ADDED: 'commented on',
  ASSIGNEE_CHANGED: 'reassigned',
  PRIORITY_CHANGED: 'changed priority on',
  DEADLINE_CHANGED: 'changed the deadline on',
  APPROVE: 'approved',
  REOPENED: 'reopened',
};

export default function DashboardPage() {
  const { user } = useSession();
  const { data, isLoading, mutate } = useSWR<DashboardData>('/api/tm/dashboard', fetcher, { refreshInterval: 60000 });
  const [openTask, setOpenTask] = useState<number | null>(null);

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user?.full_name.split(' ')[0]}`}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      />
      <PageBody className="space-y-6">
        {isLoading && <DashboardSkeleton />}

        {data && (
          <>
            <CounterRow counters={data.counters} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <FocusCard focus={data.focus} onOpen={setOpenTask} />
                <TaskListCard
                  title="Today"
                  icon={Clock}
                  tasks={data.today}
                  empty="No tasks due today. You're all caught up."
                  onOpen={setOpenTask}
                />
                {data.overdue.length > 0 && (
                  <TaskListCard
                    title="Overdue"
                    icon={AlertTriangle}
                    tasks={data.overdue}
                    empty="No overdue tasks."
                    onOpen={setOpenTask}
                    tone="danger"
                  />
                )}
                {(user?.role === 'LEADER' || user?.role === 'MANAGER') && data.team_workload.length > 0 && (
                  <WorkloadCard rows={data.team_workload} />
                )}
              </div>

              <div className="space-y-6">
                <DailyUpdateCard status={data.daily_update} />
                <PerformanceCard score={data.performance.score} metrics={data.performance.metrics} />
                {(user?.role === 'LEADER' || user?.role === 'MANAGER') && data.pending_approvals > 0 && (
                  <ApprovalsCard count={data.pending_approvals} />
                )}
                <ActivityCard items={data.recent_activity} />
              </div>
            </div>
          </>
        )}
      </PageBody>

      {openTask && <TaskDrawer taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => mutate()} />}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-80" />
    </div>
  );
}

function CounterRow({ counters }: { counters: Record<string, number> }) {
  const items = [
    { label: 'Open tasks', value: counters.open_tasks, icon: ListChecks, tone: 'brand' },
    { label: 'Due today', value: counters.due_today, icon: Clock, tone: 'amber' },
    { label: 'Overdue', value: counters.overdue, icon: AlertTriangle, tone: 'red' },
    { label: 'Completed today', value: counters.completed_today, icon: CheckCircle2, tone: 'emerald' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Card key={it.label} className="animate-fade-up">
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  it.tone === 'brand'
                    ? 'bg-brand-soft text-brand'
                    : it.tone === 'amber'
                      ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                      : it.tone === 'red'
                        ? 'bg-red-500/12 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold tabular-nums text-ink">{it.value ?? 0}</p>
                <p className="truncate text-xs text-muted">{it.label}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FocusCard({
  focus,
  onOpen,
}: {
  focus: Array<TaskRow & { score: number; reasons: string[] }>;
  onOpen: (id: number) => void;
}) {
  return (
    <Card className="animate-fade-up overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-gradient-to-r from-brand-soft/60 to-transparent px-5 py-4">
        <Sparkles className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-ink">What should I do today?</h3>
      </div>
      <CardContent className="p-5">
        {focus.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing urgent right now" description="Your open tasks don't need immediate attention." />
        ) : (
          <ol className="space-y-3">
            {focus.map((t, i) => (
              <li key={t.id}>
                <button
                  onClick={() => onOpen(t.id)}
                  className="focus-ring flex w-full items-start gap-3 rounded-xl border border-line p-3.5 text-left transition-colors hover:border-brand/40 hover:bg-brand-soft/30"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-ink">{t.title}</p>
                      <PriorityBadge priority={t.priority as never} />
                    </div>
                    <p className="mt-1 text-xs text-faint">{t.task_number}{t.project_name ? ` · ${t.project_name}` : ''}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.reasons.map((r) => (
                        <span key={r} className="rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">{r}</span>
                      ))}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TaskListCard({
  title,
  icon: Icon,
  tasks,
  empty,
  onOpen,
  tone,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tasks: TaskRow[];
  empty: string;
  onOpen: (id: number) => void;
  tone?: 'danger';
}) {
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone === 'danger' ? 'text-red-500' : 'text-muted'}`} />
          {title}
        </CardTitle>
        <Link href="/tm/tasks" className="text-xs font-medium text-brand hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="p-0">
        {tasks.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title={empty} />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {tasks.map((t) => {
              const due = fmtDueIn(t.deadline);
              return (
                <button
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                  className="focus-ring flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-line/20"
                >
                  <PriorityBadge priority={t.priority as never} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{t.title}</p>
                    <p className="truncate text-xs text-faint">{t.task_number}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${due.overdue ? 'text-red-500' : due.soon ? 'text-amber-600' : 'text-muted'}`}>
                    {due.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DailyUpdateCard({ status }: { status: { id: number; status: string } | null }) {
  const submitted = status?.status === 'SUBMITTED';
  return (
    <Card className="animate-fade-up">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-ink">Today&apos;s Update</h3>
        </div>
        {submitted ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Submitted for today
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">You haven&apos;t submitted a daily update yet.</p>
            <Link
              href="/tm/daily-updates/new"
              className="focus-ring mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-brand-ink hover:brightness-110"
            >
              Submit update <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceCard({ score, metrics }: { score: number; metrics: Record<string, number> }) {
  return (
    <Card className="animate-fade-up">
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted" />
          <h3 className="text-sm font-semibold text-ink">Productivity Score</h3>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <ProgressRing value={score} size={64} stroke={6}>
            <span className="text-sm font-bold text-ink">{Math.round(score)}</span>
          </ProgressRing>
          <div className="text-sm text-muted">
            <p>{metrics.tasks_completed ?? 0} completed this month</p>
            <p>{Math.round(metrics.deadline_met_rate ?? 0)}% deadlines met</p>
          </div>
        </div>
        <Link href="/tm/performance" className="mt-3 block text-center text-xs font-medium text-brand hover:underline">
          View full breakdown
        </Link>
      </CardContent>
    </Card>
  );
}

function ApprovalsCard({ count }: { count: number }) {
  return (
    <Link href="/tm/approvals" className="block animate-fade-up">
      <Card className="border-amber-500/30 bg-amber-500/5 transition-colors hover:border-amber-500/50">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{pluralize(count, 'approval')} waiting</p>
            <p className="text-xs text-muted">Review and decide now</p>
          </div>
          <ArrowRight className="h-4 w-4 text-faint" />
        </CardContent>
      </Card>
    </Link>
  );
}

function WorkloadCard({ rows }: { rows: DashboardData['team_workload'] }) {
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted" /> Team Workload
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-line">
          {rows.slice(0, 8).map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={r.full_name} src={r.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{r.full_name}</p>
                <p className="text-xs text-faint">
                  {r.open_tasks} open · {Math.round(r.remaining_hours)}h remaining
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {r.overdue_tasks > 0 && (
                  <span className="rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                    {r.overdue_tasks} overdue
                  </span>
                )}
                {r.blocked_tasks > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">
                    <Ban className="h-3 w-3" /> {r.blocked_tasks}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ items }: { items: DashboardData['recent_activity'] }) {
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-5 pb-5"><EmptyState title="No recent activity" /></div>
        ) : (
          <div className="divide-y divide-line">
            {items.slice(0, 10).map((a, i) => (
              <div key={i} className="flex items-start gap-2.5 px-5 py-3">
                <Avatar name={a.full_name} src={a.avatar_url} size="xs" className="mt-0.5" />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">
                  <span className="font-medium text-ink">{a.full_name ?? 'Someone'}</span>{' '}
                  {ACTIVITY_LABEL[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}{' '}
                  <span className="text-ink">{a.title}</span>
                  <span className="ml-1 text-faint">· {timeAgo(a.created_at)}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
