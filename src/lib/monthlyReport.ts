import 'server-only';
import { query } from './db';
import { badRequest } from './api';
import { taskScope, teamMemberIds } from './tasks';
import type { SessionUser } from './types';

/**
 * Monthly report data.
 *
 * One month is "every task that was alive at some point in it": created before
 * the month ended and not closed before it began. That is what a manager means
 * by "the month's work" — new tasks, finished tasks and the backlog that rolled
 * through it — rather than only the tasks that happen to have been created in it.
 *
 * All month boundaries are in the viewer's local time. The database stores UTC,
 * so the browser sends its offset and every date is shifted before it is
 * bucketed into a day or written into the workbook.
 */

export const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'REJECTED'] as const;
const CLOSED_SQL = `COALESCE(t.completed_at, t.cancelled_at,
  IF(t.status IN ('COMPLETED','CANCELLED','REJECTED'), t.updated_at, NULL))`;

const DAY = 86_400_000;

export interface MonthRange {
  /** "2026-09" */
  key: string;
  year: number;
  /** 1-12 */
  month: number;
  label: string;
  shortLabel: string;
  /** UTC instants of local midnight on the 1st, and of the 1st of the next month. */
  start: Date;
  end: Date;
  days: number;
  /** Minutes to add to local time to get UTC (Date#getTimezoneOffset). */
  tz: number;
}

export interface ReportFilters {
  team_id?: number;
  project_id?: number;
  assignee_id?: number;
}

export interface ReportTask {
  id: number;
  task_number: string;
  title: string;
  description: string | null;
  task_type: string;
  priority: string;
  status: string;
  progress: number;
  start_date: Date | null;
  deadline: Date | null;
  original_deadline: Date | null;
  created_at: Date;
  completed_at: Date | null;
  closed_at: Date | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  blocked_reason: string | null;
  completion_notes: string | null;
  parent_number: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assignee_role: string | null;
  /** The assignee's own team, which can differ from the task's. */
  assignee_team: string | null;
  created_by: number | null;
  creator_name: string | null;
  creator_role: string | null;
  creator_team: string | null;
  project_id: number | null;
  project_name: string | null;
  project_health: string | null;
  team_id: number | null;
  team_name: string | null;
  department_name: string | null;
  collaborators: string | null;
  tags: string | null;
  subtask_count: number;
  subtask_done: number;
  checklist_count: number;
  checklist_done: number;
  comment_count: number;
  reopen_count: number;
}

export interface DailyUpdateRow {
  user_id: number;
  full_name: string;
  role: string;
  team_name: string | null;
  day: string; // YYYY-MM-DD
  hours: number;
  status: string;
  items: number;
}

export interface Kpis {
  active: number;
  created: number;
  completed: number;
  cancelled: number;
  completionRate: number | null;
  onTimeRate: number | null;
  onTime: number;
  late: number;
  overdue: number;
  carriedOver: number;
  avgCycleDays: number | null;
  estimatedHours: number;
  actualHours: number;
  reopened: number;
  blocked: number;
}

/* ------------------------------------------------------------------ *
 * Month & time helpers
 * ------------------------------------------------------------------ */

export function parseMonth(raw: string | null, tzRaw: string | null): MonthRange {
  const tz = Number(tzRaw ?? 0);
  if (!Number.isFinite(tz) || Math.abs(tz) > 14 * 60) throw badRequest('Invalid time zone offset.');

  const now = new Date(Date.now() - tz * 60_000);
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw ?? fallback);
  if (!m) throw badRequest('Month must look like 2026-09.');
  return monthRange(Number(m[1]), Number(m[2]), tz);
}

export function monthRange(year: number, month: number, tz: number): MonthRange {
  const startLocal = Date.UTC(year, month - 1, 1);
  const endLocal = Date.UTC(year, month, 1);
  const name = new Date(startLocal).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    year,
    month,
    label: `${name} ${year}`,
    shortLabel: name.slice(0, 3),
    start: new Date(startLocal + tz * 60_000),
    end: new Date(endLocal + tz * 60_000),
    days: Math.round((endLocal - startLocal) / DAY),
    tz,
  };
}

export function previousMonth(r: MonthRange): MonthRange {
  return r.month === 1 ? monthRange(r.year - 1, 12, r.tz) : monthRange(r.year, r.month - 1, r.tz);
}

/** A UTC instant expressed as a Date whose UTC fields read as the viewer's wall clock. */
export function toLocal(d: Date, tz: number): Date {
  return new Date(d.getTime() - tz * 60_000);
}

/** 1-based day of the month an instant falls on locally, or 0 if outside the month. */
export function dayOfMonth(d: Date | null, r: MonthRange): number {
  if (!d || d < r.start || d >= r.end) return 0;
  return toLocal(d, r.tz).getUTCDate();
}

const inRange = (d: Date | null, r: MonthRange) => !!d && d >= r.start && d < r.end;

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadTasks(
  user: SessionUser,
  from: Date,
  to: Date,
  filters: ReportFilters,
): Promise<ReportTask[]> {
  const scope = await taskScope(user, 't');
  const where = ['t.deleted_at IS NULL', scope.sql, 't.created_at < ?', `(${CLOSED_SQL} IS NULL OR ${CLOSED_SQL} >= ?)`];
  const params: unknown[] = [...scope.params, to, from];

  if (filters.team_id) {
    where.push('t.team_id = ?');
    params.push(filters.team_id);
  }
  if (filters.project_id) {
    where.push('t.project_id = ?');
    params.push(filters.project_id);
  }
  if (filters.assignee_id) {
    where.push(`(t.assignee_id = ? OR EXISTS (SELECT 1 FROM tm_task_assignees fa
                 WHERE fa.task_id = t.id AND fa.user_id = ? AND fa.unassigned_at IS NULL))`);
    params.push(filters.assignee_id, filters.assignee_id);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.task_number, t.title, t.description, t.task_type, t.priority, t.status, t.progress,
            t.start_date, t.deadline, t.original_deadline, t.created_at, t.completed_at,
            ${CLOSED_SQL} AS closed_at,
            t.estimated_hours, t.actual_hours, t.blocked_reason, t.completion_notes,
            pt.task_number AS parent_number,
            t.assignee_id, a.full_name AS assignee_name, a.role AS assignee_role, atm.name AS assignee_team,
            t.created_by, c.full_name AS creator_name, c.role AS creator_role, ctm.name AS creator_team,
            t.project_id, p.name AS project_name, p.health AS project_health,
            t.team_id, tm.name AS team_name, d.name AS department_name,
            (SELECT GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ')
               FROM tm_task_assignees ta JOIN tm_users u ON u.id = ta.user_id
              WHERE ta.task_id = t.id AND ta.unassigned_at IS NULL AND NOT (ta.user_id <=> t.assignee_id)) AS collaborators,
            (SELECT GROUP_CONCAT(tg.name ORDER BY tg.name SEPARATOR ', ')
               FROM tm_task_tag_map mp JOIN tm_task_tags tg ON tg.id = mp.tag_id
              WHERE mp.task_id = t.id) AS tags,
            (SELECT COUNT(*) FROM tm_tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
            (SELECT COUNT(*) FROM tm_tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL AND s.status = 'COMPLETED') AS subtask_done,
            (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id) AS checklist_count,
            (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id AND ck.is_done = 1) AS checklist_done,
            (SELECT COUNT(*) FROM tm_task_comments cm WHERE cm.task_id = t.id AND cm.deleted_at IS NULL) AS comment_count,
            (SELECT COUNT(*) FROM tm_task_status_history h WHERE h.task_id = t.id AND h.to_status = 'REOPENED') AS reopen_count
       FROM tm_tasks t
       LEFT JOIN tm_users a ON a.id = t.assignee_id
       LEFT JOIN tm_users c ON c.id = t.created_by
       LEFT JOIN tm_teams atm ON atm.id = a.team_id
       LEFT JOIN tm_teams ctm ON ctm.id = c.team_id
       LEFT JOIN tm_projects p ON p.id = t.project_id
       LEFT JOIN tm_teams tm ON tm.id = t.team_id
       LEFT JOIN tm_departments d ON d.id = t.department_id
       LEFT JOIN tm_tasks pt ON pt.id = t.parent_task_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.created_at ASC
      LIMIT 20000`,
    params,
  );

  return rows.map((r) => ({
    ...(r as unknown as ReportTask),
    id: Number(r.id),
    progress: Number(r.progress ?? 0),
    estimated_hours: num(r.estimated_hours),
    actual_hours: num(r.actual_hours),
    assignee_id: num(r.assignee_id),
    created_by: num(r.created_by),
    project_id: num(r.project_id),
    team_id: num(r.team_id),
    subtask_count: Number(r.subtask_count ?? 0),
    subtask_done: Number(r.subtask_done ?? 0),
    checklist_count: Number(r.checklist_count ?? 0),
    checklist_done: Number(r.checklist_done ?? 0),
    comment_count: Number(r.comment_count ?? 0),
    reopen_count: Number(r.reopen_count ?? 0),
  }));
}

/**
 * Submitted daily-update hours for the people the viewer is responsible for.
 * Mirrors the CSV export: Managers see everyone, Leaders their teams and themselves.
 */
export async function loadDailyUpdates(
  user: SessionUser,
  r: MonthRange,
  filters: ReportFilters,
): Promise<DailyUpdateRow[]> {
  const where = ['u.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (user.role !== 'MANAGER') {
    const ids = [...new Set([user.id, ...(await teamMemberIds(user.id))])];
    where.push('u.id IN (?)');
    params.push(ids);
  }
  if (filters.assignee_id) {
    where.push('u.id = ?');
    params.push(filters.assignee_id);
  }
  if (filters.team_id) {
    where.push(`(u.team_id = ? OR EXISTS (SELECT 1 FROM tm_team_members m
                 WHERE m.user_id = u.id AND m.team_id = ? AND m.is_active = 1))`);
    params.push(filters.team_id, filters.team_id);
  }

  // update_date is a calendar DATE in the person's own day, so no tz shift.
  const first = r.key + '-01';
  const next = r.month === 12 ? `${r.year + 1}-01-01` : `${r.year}-${String(r.month + 1).padStart(2, '0')}-01`;

  const rows = await query<Record<string, unknown>>(
    `SELECT u.id AS user_id, u.full_name, u.role, tm.name AS team_name,
            DATE_FORMAT(du.update_date, '%Y-%m-%d') AS day,
            COALESCE(du.total_hours,
              (SELECT SUM(i.hours) FROM tm_daily_update_items i WHERE i.daily_update_id = du.id), 0) AS hours,
            du.status,
            (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = du.id) AS items
       FROM tm_daily_updates du
       JOIN tm_users u ON u.id = du.user_id
       LEFT JOIN tm_teams tm ON tm.id = u.team_id
      WHERE du.update_date >= ? AND du.update_date < ? AND ${where.join(' AND ')}
      ORDER BY u.full_name, du.update_date`,
    [first, next, ...params],
  );

  return rows.map((row) => ({
    user_id: Number(row.user_id),
    full_name: String(row.full_name),
    role: String(row.role),
    team_name: (row.team_name as string | null) ?? null,
    day: String(row.day),
    hours: Number(row.hours ?? 0),
    status: String(row.status),
    items: Number(row.items ?? 0),
  }));
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

/** Tasks alive at some point during `r`. */
export function aliveIn(tasks: ReportTask[], r: MonthRange): ReportTask[] {
  return tasks.filter((t) => t.created_at < r.end && (!t.closed_at || t.closed_at >= r.start));
}

export const isCompletedIn = (t: ReportTask, r: MonthRange) => t.status === 'COMPLETED' && inRange(t.completed_at, r);

/** Open when the month ended (or now, for the current month) and past its deadline by then. */
export function isOverdueAtEnd(t: ReportTask, r: MonthRange, now = new Date()): boolean {
  const cutoff = r.end < now ? r.end : now;
  if (!t.deadline || t.deadline >= cutoff) return false;
  return !t.closed_at || t.closed_at > cutoff;
}

export const isOpenAtEnd = (t: ReportTask, r: MonthRange) => !t.closed_at || t.closed_at >= r.end;

/**
 * Tasks created already finished (logged after the fact, e.g. from a daily
 * update) have a cycle of seconds. They say nothing about turnaround, so they
 * are left out of the cycle-time average rather than dragging it to zero.
 */
const MIN_CYCLE_DAYS = 10 / (24 * 60);

export function cycleDays(t: ReportTask): number | null {
  if (!t.completed_at) return null;
  const from = t.start_date && t.start_date < t.completed_at ? t.start_date : t.created_at;
  return Math.max(0, (t.completed_at.getTime() - from.getTime()) / DAY);
}

export function onTimeFlag(t: ReportTask): boolean | null {
  if (t.status !== 'COMPLETED' || !t.completed_at || !t.deadline) return null;
  return t.completed_at <= t.deadline;
}

export function monthActivity(t: ReportTask, r: MonthRange): string {
  const created = inRange(t.created_at, r);
  const done = isCompletedIn(t, r);
  if (created && done) return 'Created & completed';
  if (done) return 'Carried in · completed';
  if (inRange(t.closed_at, r)) return created ? 'Created · closed' : 'Carried in · closed';
  if (created) return 'Created · still open';
  return 'Carried over';
}

export function computeKpis(all: ReportTask[], r: MonthRange): Kpis {
  const tasks = aliveIn(all, r);
  const completed = tasks.filter((t) => isCompletedIn(t, r));
  const cancelled = tasks.filter((t) => t.status !== 'COMPLETED' && inRange(t.closed_at, r)).length;
  const withDeadline = completed.filter((t) => t.deadline);
  const onTime = withDeadline.filter((t) => onTimeFlag(t)).length;
  const cycles = completed.map(cycleDays).filter((v): v is number => v !== null && v >= MIN_CYCLE_DAYS);
  const denominator = tasks.length - cancelled;

  return {
    active: tasks.length,
    created: tasks.filter((t) => inRange(t.created_at, r)).length,
    completed: completed.length,
    cancelled,
    completionRate: denominator > 0 ? completed.length / denominator : null,
    onTimeRate: withDeadline.length ? onTime / withDeadline.length : null,
    onTime,
    late: withDeadline.length - onTime,
    overdue: tasks.filter((t) => isOverdueAtEnd(t, r)).length,
    carriedOver: tasks.filter((t) => isOpenAtEnd(t, r)).length,
    avgCycleDays: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
    estimatedHours: round1(completed.reduce((s, t) => s + (t.estimated_hours ?? 0), 0)),
    actualHours: round1(completed.reduce((s, t) => s + (t.actual_hours ?? 0), 0)),
    reopened: tasks.reduce((s, t) => s + (t.reopen_count > 0 ? 1 : 0), 0),
    blocked: tasks.filter((t) => t.status === 'BLOCKED' && isOpenAtEnd(t, r)).length,
  };
}

export interface DailyPoint {
  day: number;
  date: Date; // local midnight, as a UTC-field date
  created: number;
  completed: number;
  due: number;
}

export function dailySeries(tasks: ReportTask[], r: MonthRange): DailyPoint[] {
  const points: DailyPoint[] = Array.from({ length: r.days }, (_, i) => ({
    day: i + 1,
    date: new Date(Date.UTC(r.year, r.month - 1, i + 1)),
    created: 0,
    completed: 0,
    due: 0,
  }));
  for (const t of tasks) {
    const c = dayOfMonth(t.created_at, r);
    if (c) points[c - 1].created++;
    if (t.status === 'COMPLETED') {
      const d = dayOfMonth(t.completed_at, r);
      if (d) points[d - 1].completed++;
    }
    const due = dayOfMonth(t.deadline, r);
    if (due) points[due - 1].due++;
  }
  return points;
}

export interface GroupStats {
  key: string;
  label: string;
  sub: string | null;
  total: number;
  completed: number;
  open: number;
  overdue: number;
  blocked: number;
  urgent: number;
  completionRate: number | null;
  onTimeRate: number | null;
  avgCycleDays: number | null;
  estimatedHours: number;
  actualHours: number;
  health: string | null;
}

export function groupStats(
  tasks: ReportTask[],
  r: MonthRange,
  keyOf: (t: ReportTask) => { key: string; label: string; sub?: string | null; health?: string | null },
): GroupStats[] {
  const groups = new Map<string, { meta: ReturnType<typeof keyOf>; tasks: ReportTask[] }>();
  for (const t of tasks) {
    const meta = keyOf(t);
    const g = groups.get(meta.key) ?? { meta, tasks: [] };
    g.tasks.push(t);
    groups.set(meta.key, g);
  }

  return [...groups.values()]
    .map(({ meta, tasks: list }) => {
      const k = computeKpis(list, r);
      return {
        key: meta.key,
        label: meta.label,
        sub: meta.sub ?? null,
        total: k.active,
        completed: k.completed,
        open: k.carriedOver,
        overdue: k.overdue,
        blocked: k.blocked,
        urgent: list.filter((t) => t.priority === 'CRITICAL' || t.priority === 'HIGH').length,
        completionRate: k.completionRate,
        onTimeRate: k.onTimeRate,
        avgCycleDays: k.avgCycleDays,
        estimatedHours: round1(list.reduce((s, t) => s + (t.estimated_hours ?? 0), 0)),
        actualHours: round1(list.reduce((s, t) => s + (t.actual_hours ?? 0), 0)),
        health: meta.health ?? null,
      };
    })
    .sort((a, b) => b.completed - a.completed || b.total - a.total || a.label.localeCompare(b.label));
}

export function countBy(tasks: ReportTask[], key: (t: ReportTask) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
  return m;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * The assembled report
 * ------------------------------------------------------------------ */

export interface MonthlyReport {
  range: MonthRange;
  previous: MonthRange;
  generatedAt: Date;
  generatedBy: SessionUser;
  filters: ReportFilters;
  filterLabels: string[];
  tasks: ReportTask[];
  /** Every task loaded, including ones only alive last month — for per-person comparisons. */
  history: ReportTask[];
  kpis: Kpis;
  previousKpis: Kpis;
  daily: DailyPoint[];
  dailyUpdates: DailyUpdateRow[] | null;
}

export async function buildMonthlyReport(
  user: SessionUser,
  range: MonthRange,
  filters: ReportFilters,
  opts: { includeDailyUpdates: boolean },
): Promise<MonthlyReport> {
  const previous = previousMonth(range);

  const [all, dailyUpdates, labels] = await Promise.all([
    loadTasks(user, previous.start, range.end, filters),
    opts.includeDailyUpdates ? loadDailyUpdates(user, range, filters) : Promise.resolve(null),
    filterLabels(filters),
  ]);

  const tasks = aliveIn(all, range);

  return {
    range,
    previous,
    generatedAt: new Date(),
    generatedBy: user,
    filters,
    filterLabels: labels,
    tasks,
    history: all,
    kpis: computeKpis(all, range),
    previousKpis: computeKpis(all, previous),
    daily: dailySeries(tasks, range),
    dailyUpdates,
  };
}

async function filterLabels(f: ReportFilters): Promise<string[]> {
  const out: string[] = [];
  const name = async (sql: string, id: number) =>
    (await query<{ name: string }>(sql, [id]))[0]?.name ?? `#${id}`;
  if (f.team_id) out.push(`Team: ${await name('SELECT name FROM tm_teams WHERE id = ?', f.team_id)}`);
  if (f.project_id) out.push(`Project: ${await name('SELECT name FROM tm_projects WHERE id = ?', f.project_id)}`);
  if (f.assignee_id) out.push(`Person: ${await name('SELECT full_name AS name FROM tm_users WHERE id = ?', f.assignee_id)}`);
  return out;
}
