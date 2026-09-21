'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  AlertTriangle, Activity, CalendarDays, CheckCircle2, ChevronRight, ClipboardList,
  ExternalLink, Flame, Gauge, ListChecks, MessageSquare, NotebookPen, Plus, Timer,
  TrendingUp, UserRound, Users as UsersIcon,
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { fetcher } from '@/lib/client';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtDueIn, pluralize, timeAgo } from '@/lib/format';
import { STATUS_LABEL, type Priority, type TaskStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { SearchInput, Select } from '@/components/ui/Field';
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Tabs } from '@/components/ui/Tabs';
import { TaskDrawer } from './TaskDrawer';
import { TaskFormModal } from './TaskFormModal';
import { OriginalText } from './OriginalText';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface MemberRow {
  id: number;
  full_name: string;
  email: string;
  avatar_url: string | null;
  job_title: string | null;
  role: string;
  availability: string;
  department_name: string | null;
  team_name: string | null;
  team_id: number | null;
  open_tasks: number;
  overdue_tasks: number;
  due_today: number;
  in_progress: number;
  in_review: number;
  blocked: number;
  completed_7d: number;
  completed_30d: number;
  avg_progress: number | null;
  last_update_date: string | null;
  updated_today: number;
  last_activity_at: string | null;
}

interface MemberTask {
  id: number;
  task_number: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  progress: number;
  task_type: string;
  deadline: string | null;
  completed_at: string | null;
  updated_at: string;
  blocked_reason: string | null;
  project_name: string | null;
  project_color: string | null;
  creator_name: string | null;
  checklist_count: number;
  checklist_done: number;
  comment_count: number;
  is_overdue: 0 | 1;
}

interface MemberDetailResponse {
  user: {
    id: number;
    full_name: string;
    email: string;
    role: string;
    avatar_url: string | null;
    job_title: string | null;
    availability: string;
    department_name: string | null;
    team_name: string | null;
    team_id: number | null;
    leader_name: string | null;
    last_login_at: string | null;
  };
  stats: {
    total: number;
    open_tasks: number;
    overdue: number;
    due_today: number;
    due_week: number;
    completed_30d: number;
    avg_progress: number;
    estimated_hours: number;
    actual_hours: number;
    on_time_rate: number | null;
  };
  status_counts: Record<TaskStatus, number>;
  priority_counts: Record<string, number>;
  projects: Array<{ project_name: string; project_color: string | null; total: number; completed: number; open_count: number }>;
  tasks: MemberTask[];
  trend: Array<{ date: string; created: number; completed: number }>;
  daily: Array<{
    id: number;
    update_date: string;
    summary: string | null;
    raw_text: string | null;
    total_hours: string | null;
    status: string;
    mood: string | null;
    blockers: string | null;
    submitted_at: string | null;
    next_day_plan: string | null;
    focus_area: string | null;
    is_auto_submitted: 0 | 1 | null;
    item_count: number;
  }>;
  missing_updates: string[];
  activity: Array<{
    action: string;
    field: string | null;
    old_value: string | null;
    new_value: string | null;
    created_at: string;
    task_id: number;
    task_number: string;
    title: string;
  }>;
  can_assign: boolean;
  is_self: boolean;
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

const AVAILABILITY_DOT: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500',
  BUSY: 'bg-amber-500',
  ON_LEAVE: 'bg-slate-400',
  REMOTE: 'bg-sky-500',
  OFFLINE: 'bg-line',
};

const STATUS_BAR: Record<TaskStatus, string> = {
  DRAFT: 'bg-slate-300 dark:bg-slate-700',
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-blue-500',
  REOPENED: 'bg-indigo-500',
  BLOCKED: 'bg-red-500',
  WAITING: 'bg-amber-500',
  REVIEW: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  REJECTED: 'bg-rose-400',
  CANCELLED: 'bg-line',
};

/**
 * A single headline number. `tone` is the whole visual difference between
 * "3 tasks in review" and "3 tasks overdue", so it is never decorative.
 */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'neutral' | 'red' | 'amber' | 'emerald' | 'brand' | 'purple';
  active?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    neutral: 'text-muted',
    red: 'text-red-500',
    amber: 'text-amber-500',
    emerald: 'text-emerald-500',
    brand: 'text-brand',
    purple: 'text-purple-500',
  };
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl border border-line bg-surface p-3 text-left transition-colors',
        onClick && 'focus-ring hover:border-brand/40 hover:bg-line/20',
        active && 'border-brand/60 bg-brand-soft',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', tones[tone])} />
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      </div>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'neutral' ? 'text-ink' : tones[tone])}>
        {value}
      </p>
      {hint && <p className="truncate text-[11px] text-faint">{hint}</p>}
    </Tag>
  );
}

/** Proportional band of every status in the queue — the shape of the workload. */
function StatusDistribution({ counts, onPick }: { counts: Record<TaskStatus, number>; onPick?: (s: TaskStatus) => void }) {
  const entries = (Object.entries(counts) as Array<[TaskStatus, number]>).filter(([, c]) => c > 0);
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  if (!total) return <p className="text-sm text-faint">No tasks yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line/40">
        {entries.map(([status, count]) => (
          <div
            key={status}
            className={cn(STATUS_BAR[status], 'transition-all duration-500')}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${STATUS_LABEL[status]}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([status, count]) => (
          <button
            key={status}
            type="button"
            onClick={() => onPick?.(status)}
            className="focus-ring flex items-center gap-1.5 rounded text-xs text-muted hover:text-ink"
          >
            <span className={cn('h-2 w-2 rounded-full', STATUS_BAR[status])} />
            {STATUS_LABEL[status]}
            <span className="font-semibold tabular-nums text-ink">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

/** How urgently a person needs their supervisor's attention. Higher is worse. */
function attentionScore(m: MemberRow) {
  return m.overdue_tasks * 10 + m.blocked * 6 + m.due_today * 3 + (m.updated_today ? 0 : 4);
}

function RosterRow({ member, selected, onSelect }: { member: MemberRow; selected: boolean; onSelect: () => void }) {
  const needsAttention = member.overdue_tasks > 0 || member.blocked > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'focus-ring group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all',
        selected
          ? 'border-brand/60 bg-brand-soft shadow-sm'
          : 'border-transparent hover:border-line hover:bg-line/20',
      )}
    >
      <div className="relative shrink-0">
        <Avatar name={member.full_name} src={member.avatar_url} size="md" />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface',
            AVAILABILITY_DOT[member.availability] ?? 'bg-line',
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className={cn('truncate text-sm font-medium', selected ? 'text-brand' : 'text-ink')}>{member.full_name}</p>
          {needsAttention && <Flame className="h-3.5 w-3.5 shrink-0 text-red-500" />}
        </div>
        <p className="truncate text-[11px] text-faint">{member.job_title ?? member.team_name ?? member.email}</p>

        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="text-muted">{member.open_tasks} open</span>
          {member.overdue_tasks > 0 && (
            <span className="font-medium text-red-500">{member.overdue_tasks} overdue</span>
          )}
          {member.overdue_tasks === 0 && member.due_today > 0 && (
            <span className="text-amber-600 dark:text-amber-400">{member.due_today} due today</span>
          )}
          {/* A missing update is the earliest signal that someone is stuck. */}
          {!member.updated_today && (
            <span className="ml-auto shrink-0 text-faint" title="No Daily Update filed today">
              <NotebookPen className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      <ChevronRight
        className={cn(
          'h-4 w-4 shrink-0 transition-transform',
          selected ? 'text-brand' : 'text-faint group-hover:translate-x-0.5',
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Detail tabs
 * ------------------------------------------------------------------ */

function TaskRow({ task, onOpen }: { task: MemberTask; onOpen: () => void }) {
  const due = fmtDueIn(task.deadline);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-brand/40 hover:bg-line/10"
    >
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', STATUS_BAR[task.status])}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-faint">{task.task_number}</span>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.title}</p>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.project_name && (
            <Badge variant="outline" className="gap-1.5">
              {task.project_color && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.project_color }} />
              )}
              {task.project_name}
            </Badge>
          )}
          {task.deadline && (
            <span
              className={cn(
                'text-[11px]',
                due.overdue ? 'font-medium text-red-500' : due.soon ? 'text-amber-500' : 'text-faint',
              )}
            >
              {due.label}
            </span>
          )}
          {task.checklist_count > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-faint">
              <ListChecks className="h-3 w-3" />
              {task.checklist_done}/{task.checklist_count}
            </span>
          )}
          {task.comment_count > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-faint">
              <MessageSquare className="h-3 w-3" />
              {task.comment_count}
            </span>
          )}
        </div>

        {task.blocked_reason && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-500">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            {task.blocked_reason}
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          <ProgressBar value={task.progress} className="flex-1" />
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-faint">{task.progress}%</span>
        </div>
      </div>
    </button>
  );
}

function DailyTimeline({ detail }: { detail: MemberDetailResponse }) {
  const { daily, missing_updates } = detail;

  return (
    <div className="space-y-4">
      {missing_updates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
          <NotebookPen className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-ink">
            No Daily Update on {pluralize(missing_updates.length, 'working day')} in the last two weeks
          </p>
          <span className="text-xs text-faint">
            {missing_updates.slice(0, 5).map((d) => fmtDate(d, { month: 'short', day: 'numeric' })).join(', ')}
            {missing_updates.length > 5 && ` +${missing_updates.length - 5}`}
          </span>
        </div>
      )}

      {daily.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="No Daily Updates filed yet"
          description="Daily Updates appear here as soon as this person submits one."
        />
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-5">
          {daily.map((d) => (
            <li key={d.id} className="relative">
              <span className="absolute -left-[26px] top-2 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-surface" />
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {fmtDate(d.update_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    {d.status === 'DRAFT' && <Badge className="bg-amber-500/12 text-amber-600 dark:text-amber-400">Draft</Badge>}
                    {!!d.is_auto_submitted && <Badge variant="outline">Auto-filed</Badge>}
                    <span className="ml-auto flex items-center gap-3 text-[11px] text-faint">
                      {d.total_hours && (
                        <span className="flex items-center gap-1">
                          <Timer className="h-3 w-3" />
                          {Number(d.total_hours)}h
                        </span>
                      )}
                      <span>{pluralize(d.item_count, 'item')}</span>
                    </span>
                  </div>

                  {d.summary && <p className="whitespace-pre-line text-sm text-muted">{d.summary}</p>}

                  {d.blockers && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-red-500/[0.07] px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
                      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                      {d.blockers}
                    </p>
                  )}
                  {d.next_day_plan && (
                    <p className="text-xs text-faint">
                      <span className="font-medium text-muted">Next: </span>
                      {d.next_day_plan}
                    </p>
                  )}
                  <OriginalText text={d.raw_text} className="mt-1" />
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Activity rows are machine-written, so they get a readable sentence here. */
function activitySentence(a: MemberDetailResponse['activity'][number]) {
  switch (a.action) {
    case 'CREATED':
      return 'created';
    case 'STATUS_CHANGED':
      return `moved to ${STATUS_LABEL[a.new_value as TaskStatus] ?? a.new_value}`;
    case 'COMMENTED':
      return 'commented on';
    case 'UPDATED':
      return a.field ? `updated ${a.field.replace(/_/g, ' ')} on` : 'updated';
    case 'ASSIGNED':
      return 'was assigned';
    default:
      return a.action.toLowerCase().replace(/_/g, ' ');
  }
}

function ActivityFeed({ activity }: { activity: MemberDetailResponse['activity'] }) {
  if (!activity.length) {
    return <EmptyState icon={Activity} title="No recorded activity yet" />;
  }
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {activity.map((a, i) => (
        <li key={`${a.task_id}-${a.created_at}-${i}`} className="relative">
          <span className="absolute -left-[23px] top-1.5 h-2 w-2 rounded-full bg-line ring-4 ring-surface" />
          <p className="text-sm text-muted">
            {activitySentence(a)}{' '}
            <Link href={`/tm/tasks/${a.task_id}`} className="font-medium text-ink hover:text-brand">
              {a.task_number}
            </Link>{' '}
            <span className="text-faint">— {a.title}</span>
          </p>
          <p className="text-[11px] text-faint">{fmtDateTime(a.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * Detail panel
 * ------------------------------------------------------------------ */

const BRAND = '#6366f1';

function MemberDetail({
  memberId,
  onAssigned,
}: {
  memberId: number;
  onAssigned: () => void;
}) {
  const [tab, setTab] = useState('overview');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const [bucket, setBucket] = useState<'' | 'overdue' | 'today'>('');
  const [taskQuery, setTaskQuery] = useState('');
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  // Filters belong to the person being viewed; carrying them across would
  // silently show a different slice of the next person's queue.
  useEffect(() => {
    setTab('overview');
    setStatusFilter('ALL');
    setBucket('');
    setTaskQuery('');
  }, [memberId]);

  const params = new URLSearchParams({
    ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
    ...(bucket ? { bucket } : {}),
    ...(taskQuery ? { q: taskQuery } : {}),
  });

  const { data, error, isLoading, mutate } = useSWR<MemberDetailResponse>(
    `/api/tm/members/${memberId}?${params}`,
    fetcher,
    { keepPreviousData: true },
  );

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="This person's workload could not be loaded"
        description={error instanceof Error ? error.message : undefined}
        action={<Button size="sm" variant="secondary" onClick={() => mutate()}>Retry</Button>}
      />
    );
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) return null;

  const { user, stats, status_counts, priority_counts, projects, tasks, trend, activity } = data;

  const atRisk = tasks
    .filter((t) => t.is_overdue || t.status === 'BLOCKED' || t.priority === 'CRITICAL')
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
    .slice(0, 5);

  const jumpToTasks = (next: { status?: 'ALL' | TaskStatus; bucket?: '' | 'overdue' | 'today' }) => {
    setStatusFilter(next.status ?? 'ALL');
    setBucket(next.bucket ?? '');
    setTab('tasks');
  };

  return (
    <div className="space-y-4">
      {/* Identity ------------------------------------------------- */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <Avatar name={user.full_name} src={user.avatar_url} size="xl" />
            <span
              className={cn(
                'absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full ring-4 ring-surface',
                AVAILABILITY_DOT[user.availability] ?? 'bg-line',
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-ink">{user.full_name}</h2>
              <Badge variant="outline">{user.role[0] + user.role.slice(1).toLowerCase()}</Badge>
              {data.is_self && <Badge variant="brand">You</Badge>}
            </div>
            <p className="truncate text-sm text-muted">{user.job_title ?? user.email}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
              {user.team_name && <span className="flex items-center gap-1"><UsersIcon className="h-3 w-3" />{user.team_name}</span>}
              {user.department_name && <span>{user.department_name}</span>}
              {user.leader_name && <span>Reports to {user.leader_name}</span>}
              {user.last_login_at && <span>Last seen {timeAgo(user.last_login_at)}</span>}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {data.can_assign && (
              <Button size="sm" onClick={() => setAssignOpen(true)}>
                <Plus className="h-4 w-4" /> Assign task
              </Button>
            )}
            <Link href={`/tm/daily-updates/history?user=${user.id}`}>
              <Button size="sm" variant="secondary">
                <NotebookPen className="h-3.5 w-3.5" /> Daily updates
              </Button>
            </Link>
            <Link href={`/tm/tasks?assignee_id=${user.id}`} title="Open in the full task list">
              <Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Headline numbers ------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          icon={ClipboardList} label="Open" value={stats.open_tasks}
          hint={`${stats.total} all time`}
          onClick={() => jumpToTasks({})}
        />
        <StatTile
          icon={AlertTriangle} label="Overdue" value={stats.overdue} tone={stats.overdue ? 'red' : 'neutral'}
          active={bucket === 'overdue'}
          onClick={() => jumpToTasks({ bucket: 'overdue' })}
        />
        <StatTile
          icon={CalendarDays} label="Due today" value={stats.due_today} tone={stats.due_today ? 'amber' : 'neutral'}
          hint={`${stats.due_week} this week`}
          active={bucket === 'today'}
          onClick={() => jumpToTasks({ bucket: 'today' })}
        />
        <StatTile
          icon={Gauge} label="In review" value={status_counts.REVIEW} tone="purple"
          onClick={() => jumpToTasks({ status: 'REVIEW' })}
        />
        <StatTile
          icon={CheckCircle2} label="Done (30d)" value={stats.completed_30d} tone="emerald"
          hint={stats.on_time_rate === null ? 'No deadline data' : `${stats.on_time_rate}% on time`}
        />
        <StatTile
          icon={TrendingUp} label="Avg progress" value={`${stats.avg_progress}%`} tone="brand"
          hint={stats.actual_hours ? `${stats.actual_hours}h logged` : undefined}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'tasks', label: 'Tasks', count: tasks.length },
          { id: 'daily', label: 'Daily Updates', count: data.daily.length },
          { id: 'activity', label: 'Activity', count: activity.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Overview -------------------------------------------------- */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Workload by status</CardTitle></CardHeader>
            <CardContent>
              <StatusDistribution counts={status_counts} onPick={(s) => jumpToTasks({ status: s })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Last 14 days</CardTitle>
              <span className="text-[11px] text-faint">Created vs completed</span>
            </CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mwDone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-line" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d: string) => fmtDate(d, { month: 'short', day: 'numeric' })}
                    interval="preserveStartEnd"
                  />
                  <YAxis width={28} allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip
                    labelFormatter={(d) => fmtDate(String(d), { weekday: 'short', month: 'short', day: 'numeric' })}
                  />
                  <Area type="monotone" dataKey="completed" name="Completed" stroke={BRAND} strokeWidth={2} fill="url(#mwDone)" />
                  <Area type="monotone" dataKey="created" name="Created" stroke="#94a3b8" strokeWidth={1.5} fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Open work by priority</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => {
                const count = priority_counts[p] ?? 0;
                const max = Math.max(1, ...Object.values(priority_counts));
                return (
                  <div key={p} className="flex items-center gap-3">
                    <div className="w-20 shrink-0"><PriorityBadge priority={p} /></div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/40">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          p === 'CRITICAL' ? 'bg-red-500' : p === 'HIGH' ? 'bg-orange-500' : p === 'MEDIUM' ? 'bg-amber-500' : 'bg-sky-500',
                        )}
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">{count}</span>
                  </div>
                );
              })}
              {projects.length > 0 && (
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Across projects</p>
                  {projects.map((p) => (
                    <div key={p.project_name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: p.project_color ?? '#94a3b8' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted">{p.project_name}</span>
                      <span className="shrink-0 tabular-nums text-faint">
                        {Number(p.open_count)} open · {Number(p.completed)} done
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              {atRisk.length > 0 && (
                <button
                  type="button"
                  onClick={() => jumpToTasks({ bucket: 'overdue' })}
                  className="focus-ring rounded text-xs font-medium text-brand"
                >
                  See all
                </button>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {atRisk.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  Nothing overdue, blocked or critical right now.
                </div>
              ) : (
                atRisk.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />)
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tasks ----------------------------------------------------- */}
      {tab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={taskQuery}
              onValueChange={setTaskQuery}
              placeholder="Search this person's tasks..."
              className="min-w-[200px] flex-1 max-w-xs"
            />
            <Select
              value={bucket || statusFilter}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'overdue' || v === 'today') {
                  setBucket(v);
                  setStatusFilter('ALL');
                } else {
                  setBucket('');
                  setStatusFilter(v as 'ALL' | TaskStatus);
                }
              }}
              className="!h-9 !w-auto text-sm"
            >
              <option value="ALL">All statuses</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              {(Object.keys(status_counts) as TaskStatus[])
                .filter((s) => status_counts[s] > 0)
                .map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]} ({status_counts[s]})</option>
                ))}
            </Select>
            <span className="ml-auto text-xs text-faint">{pluralize(tasks.length, 'task')} shown</span>
          </div>

          {tasks.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No tasks match this filter"
              description={
                data.can_assign ? `Assign ${user.full_name.split(' ')[0]} something to get started.` : undefined
              }
              action={
                data.can_assign ? (
                  <Button size="sm" onClick={() => setAssignOpen(true)}><Plus className="h-4 w-4" /> Assign task</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={() => setOpenTaskId(t.id)} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'daily' && <DailyTimeline detail={data} />}
      {tab === 'activity' && (
        <Card>
          <CardContent className="p-5"><ActivityFeed activity={activity} /></CardContent>
        </Card>
      )}

      {openTaskId !== null && (
        <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} onChanged={() => mutate()} />
      )}

      <TaskFormModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onCreated={() => {
          mutate();
          onAssigned();
        }}
        lockAssignee
        title={`Assign to ${user.full_name}`}
        subtitle={user.team_name ? `${user.team_name} · ${user.role.toLowerCase()}` : user.email}
        defaults={{
          assignee_id: user.id,
          assignee_name: user.full_name,
          ...(user.team_id ? { team_id: user.team_id } : {}),
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Workspace
 * ------------------------------------------------------------------ */

type SortKey = 'attention' | 'name' | 'open' | 'completed';

export function MemberWorkspace({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('attention');
  const [onlyAttention, setOnlyAttention] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<{ members: MemberRow[]; scope: { breadth: string; viewer_id: number } }>(
    '/api/tm/members',
    fetcher,
    { refreshInterval: 120000 },
  );

  const members = useMemo(() => {
    let list = data?.members ?? [];
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((m) =>
        [m.full_name, m.email, m.job_title, m.team_name].some((v) => v?.toLowerCase().includes(needle)),
      );
    }
    if (onlyAttention) list = list.filter((m) => m.overdue_tasks > 0 || m.blocked > 0 || !m.updated_today);

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.full_name.localeCompare(b.full_name);
        case 'open':
          return b.open_tasks - a.open_tasks || a.full_name.localeCompare(b.full_name);
        case 'completed':
          return b.completed_30d - a.completed_30d || a.full_name.localeCompare(b.full_name);
        default:
          return attentionScore(b) - attentionScore(a) || a.full_name.localeCompare(b.full_name);
      }
    });
    return sorted;
  }, [data, q, sort, onlyAttention]);

  // Land on somebody rather than an empty right-hand pane. The first entry
  // under the default sort is whoever most needs looking at.
  useEffect(() => {
    if (selectedId === null && members.length) onSelect(members[0].id);
  }, [selectedId, members, onSelect]);

  const totals = useMemo(() => {
    const list = data?.members ?? [];
    return {
      people: list.length,
      overdue: list.reduce((s, m) => s + m.overdue_tasks, 0),
      open: list.reduce((s, m) => s + m.open_tasks, 0),
      noUpdate: list.filter((m) => !m.updated_today).length,
    };
  }, [data]);

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="The people portal could not be loaded"
        description={error instanceof Error ? error.message : undefined}
        action={<Button size="sm" variant="secondary" onClick={() => mutate()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Roster --------------------------------------------------- */}
      <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        <Card>
          <CardContent className="space-y-3 p-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-line/30 p-2 text-center">
                <p className="text-sm font-semibold tabular-nums text-ink">{totals.people}</p>
                <p className="text-[10px] uppercase tracking-wide text-faint">People</p>
              </div>
              <div className="rounded-lg bg-line/30 p-2 text-center">
                <p className={cn('text-sm font-semibold tabular-nums', totals.overdue ? 'text-red-500' : 'text-ink')}>
                  {totals.overdue}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-faint">Overdue</p>
              </div>
              <div className="rounded-lg bg-line/30 p-2 text-center">
                <p className="text-sm font-semibold tabular-nums text-ink">{totals.open}</p>
                <p className="text-[10px] uppercase tracking-wide text-faint">Open</p>
              </div>
            </div>

            <SearchInput value={q} onValueChange={setQ} placeholder="Find a person..." />

            <div className="flex items-center gap-2">
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="!h-8 flex-1 !px-2 text-xs"
              >
                <option value="attention">Needs attention</option>
                <option value="name">Name</option>
                <option value="open">Most open tasks</option>
                <option value="completed">Most completed</option>
              </Select>
              <button
                type="button"
                onClick={() => setOnlyAttention((v) => !v)}
                title="Only people with overdue, blocked or missing updates"
                className={cn(
                  'focus-ring flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors',
                  onlyAttention ? 'bg-red-500/12 text-red-500' : 'text-muted hover:bg-line/30 hover:text-ink',
                )}
              >
                <Flame className="h-3.5 w-3.5" />
                {totals.noUpdate > 0 && <span className="tabular-nums">{totals.noUpdate}</span>}
              </button>
            </div>

            <div className="space-y-1">
              {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}

              {!isLoading && members.length === 0 && (
                <p className="px-2 py-8 text-center text-sm text-faint">
                  {q || onlyAttention ? 'Nobody matches that filter.' : 'Nobody reports to you yet.'}
                </p>
              )}

              {members.map((m) => (
                <RosterRow
                  key={m.id}
                  member={m}
                  selected={selectedId === m.id}
                  onSelect={() => onSelect(m.id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detail ---------------------------------------------------- */}
      <div className="min-w-0">
        {selectedId === null ? (
          <Card>
            <CardContent className="p-5">
              <EmptyState
                icon={UserRound}
                title="Pick somebody to begin"
                description="Choose a person on the left to see their tasks, daily updates and activity."
              />
            </CardContent>
          </Card>
        ) : (
          <MemberDetail memberId={selectedId} onAssigned={() => mutate()} />
        )}
      </div>
    </div>
  );
}
