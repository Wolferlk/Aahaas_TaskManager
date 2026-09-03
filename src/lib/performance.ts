import 'server-only';
import { query, queryOne } from './db';

/**
 * Transparent performance scoring.
 *
 * Every dimension is computed from recorded task data, normalised to 0-100 and
 * multiplied by a Manager-configurable weight. The breakdown is stored and
 * shown to the user — there is no hidden ranking model anywhere in this module.
 */

export interface Weights {
  completion: number;
  deadline_reliability: number;
  quality: number;
  consistency: number;
  collaboration: number;
  daily_updates: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  completion: 25,
  deadline_reliability: 20,
  quality: 20,
  consistency: 15,
  collaboration: 10,
  daily_updates: 10,
};

export const DIMENSION_LABEL: Record<keyof Weights, string> = {
  completion: 'Task Completion',
  deadline_reliability: 'Deadline Reliability',
  quality: 'Task Quality',
  consistency: 'Consistency',
  collaboration: 'Collaboration',
  daily_updates: 'Daily Update Compliance',
};

export async function getWeights(): Promise<Weights> {
  const row = await queryOne<{ value: unknown }>('SELECT value FROM tm_settings WHERE setting_key = ?', [
    'performance_weights',
  ]);
  if (!row?.value) return DEFAULT_WEIGHTS;
  const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return { ...DEFAULT_WEIGHTS, ...(parsed as Partial<Weights>) };
}

export interface Metrics {
  tasks_assigned: number;
  tasks_completed: number;
  tasks_pending: number;
  tasks_overdue: number;
  completion_rate: number;
  avg_completion_days: number;
  deadlines_met: number;
  deadlines_missed: number;
  deadline_met_rate: number;
  critical_completed: number;
  rejections: number;
  tasks_reopened: number;
  daily_updates_submitted: number;
  working_days: number;
  daily_update_rate: number;
  blocked_tasks: number;
  estimated_hours: number;
  actual_hours: number;
  comments_made: number;
  projects_contributed: number;
  active_days: number;
}

function bounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return [start.toISOString().slice(0, 19).replace('T', ' '), end.toISOString().slice(0, 19).replace('T', ' ')];
}

/** Counts weekdays in a month up to today, so a mid-month view is not penalised. */
export function workingDaysSoFar(year: number, month: number): number {
  const now = new Date();
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const isCurrent = now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  const upTo = isCurrent ? now.getUTCDate() : last;
  let days = 0;
  for (let d = 1; d <= upTo; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return Math.max(days, 1);
}

export async function computeMetrics(userId: number, year: number, month: number): Promise<Metrics> {
  const [start, end] = bounds(year, month);

  const task = await queryOne<Record<string, number | null>>(
    `SELECT
        COUNT(*) AS tasks_assigned,
        SUM(status = 'COMPLETED') AS tasks_completed,
        SUM(status NOT IN ('COMPLETED','CANCELLED','REJECTED')) AS tasks_pending,
        SUM(status NOT IN ('COMPLETED','CANCELLED') AND deadline IS NOT NULL AND deadline < NOW()) AS tasks_overdue,
        SUM(status = 'COMPLETED' AND priority = 'CRITICAL') AS critical_completed,
        SUM(status = 'BLOCKED') AS blocked_tasks,
        SUM(status = 'COMPLETED' AND deadline IS NOT NULL AND completed_at <= deadline) AS deadlines_met,
        SUM(status = 'COMPLETED' AND deadline IS NOT NULL AND completed_at > deadline) AS deadlines_missed,
        AVG(CASE WHEN status = 'COMPLETED' THEN TIMESTAMPDIFF(HOUR, created_at, completed_at) END) AS avg_hours,
        SUM(COALESCE(estimated_hours,0)) AS estimated_hours,
        SUM(COALESCE(actual_hours,0)) AS actual_hours,
        COUNT(DISTINCT project_id) AS projects_contributed
       FROM tm_tasks
      WHERE assignee_id = ? AND deleted_at IS NULL
        AND created_at >= ? AND created_at < ?`,
    [userId, start, end],
  );

  const extra = await queryOne<Record<string, number | null>>(
    `SELECT
       (SELECT COUNT(*) FROM tm_task_activity_logs a
         JOIN tm_tasks t ON t.id = a.task_id
        WHERE t.assignee_id = ? AND a.action = 'REOPENED' AND a.created_at >= ? AND a.created_at < ?) AS tasks_reopened,
       (SELECT COUNT(*) FROM tm_task_status_history h
         JOIN tm_tasks t ON t.id = h.task_id
        WHERE t.assignee_id = ? AND h.to_status = 'REJECTED' AND h.created_at >= ? AND h.created_at < ?) AS rejections,
       (SELECT COUNT(*) FROM tm_task_comments c
        WHERE c.user_id = ? AND c.is_system = 0 AND c.deleted_at IS NULL
          AND c.created_at >= ? AND c.created_at < ?) AS comments_made,
       (SELECT COUNT(*) FROM tm_daily_updates d
        WHERE d.user_id = ? AND d.status = 'SUBMITTED'
          AND d.update_date >= DATE(?) AND d.update_date < DATE(?)) AS daily_updates_submitted,
       (SELECT COUNT(DISTINCT DATE(a.created_at)) FROM tm_task_activity_logs a
        WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < ?) AS active_days`,
    [
      userId, start, end,
      userId, start, end,
      userId, start, end,
      userId, start, end,
      userId, start, end,
    ],
  );

  const n = (v: unknown) => Number(v ?? 0);
  const assigned = n(task?.tasks_assigned);
  const completed = n(task?.tasks_completed);
  const met = n(task?.deadlines_met);
  const missed = n(task?.deadlines_missed);
  const workingDays = workingDaysSoFar(year, month);
  const updates = n(extra?.daily_updates_submitted);

  return {
    tasks_assigned: assigned,
    tasks_completed: completed,
    tasks_pending: n(task?.tasks_pending),
    tasks_overdue: n(task?.tasks_overdue),
    completion_rate: assigned ? (completed / assigned) * 100 : 0,
    avg_completion_days: n(task?.avg_hours) / 24,
    deadlines_met: met,
    deadlines_missed: missed,
    deadline_met_rate: met + missed ? (met / (met + missed)) * 100 : assigned ? 100 : 0,
    critical_completed: n(task?.critical_completed),
    rejections: n(extra?.rejections),
    tasks_reopened: n(extra?.tasks_reopened),
    daily_updates_submitted: updates,
    working_days: workingDays,
    daily_update_rate: Math.min(100, (updates / workingDays) * 100),
    blocked_tasks: n(task?.blocked_tasks),
    estimated_hours: n(task?.estimated_hours),
    actual_hours: n(task?.actual_hours),
    comments_made: n(extra?.comments_made),
    projects_contributed: n(task?.projects_contributed),
    active_days: n(extra?.active_days),
  };
}

export interface ScoreLine {
  dimension: keyof Weights;
  label: string;
  raw: number;
  normalized: number;
  weight: number;
  weighted: number;
  explanation: string;
}

export interface ScoreResult {
  score: number;
  lines: ScoreLine[];
}

export function scoreFromMetrics(m: Metrics, weights: Weights): ScoreResult {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  // Quality: completions that stuck, penalised by rework.
  const rework = m.tasks_reopened + m.rejections;
  const quality = m.tasks_completed ? clamp(((m.tasks_completed - rework) / m.tasks_completed) * 100) : m.tasks_assigned ? 60 : 0;

  // Consistency: how many working days saw recorded activity.
  const consistency = clamp((m.active_days / m.working_days) * 100);

  // Collaboration: comments, scaled so ~20 comments is full marks.
  const collaboration = clamp((m.comments_made / 20) * 100);

  const lines: ScoreLine[] = [
    {
      dimension: 'completion',
      label: DIMENSION_LABEL.completion,
      raw: m.completion_rate,
      normalized: clamp(m.completion_rate),
      weight: weights.completion,
      weighted: 0,
      explanation: `${m.tasks_completed} of ${m.tasks_assigned} assigned tasks completed.`,
    },
    {
      dimension: 'deadline_reliability',
      label: DIMENSION_LABEL.deadline_reliability,
      raw: m.deadline_met_rate,
      normalized: clamp(m.deadline_met_rate),
      weight: weights.deadline_reliability,
      weighted: 0,
      explanation: `${m.deadlines_met} deadlines met, ${m.deadlines_missed} missed.`,
    },
    {
      dimension: 'quality',
      label: DIMENSION_LABEL.quality,
      raw: quality,
      normalized: quality,
      weight: weights.quality,
      weighted: 0,
      explanation: rework
        ? `${rework} completed task(s) were reopened or rejected.`
        : 'No completed task was reopened or rejected.',
    },
    {
      dimension: 'consistency',
      label: DIMENSION_LABEL.consistency,
      raw: consistency,
      normalized: consistency,
      weight: weights.consistency,
      weighted: 0,
      explanation: `Activity recorded on ${m.active_days} of ${m.working_days} working days.`,
    },
    {
      dimension: 'collaboration',
      label: DIMENSION_LABEL.collaboration,
      raw: m.comments_made,
      normalized: collaboration,
      weight: weights.collaboration,
      weighted: 0,
      explanation: `${m.comments_made} comment(s) across tasks (20 counts as full marks).`,
    },
    {
      dimension: 'daily_updates',
      label: DIMENSION_LABEL.daily_updates,
      raw: m.daily_update_rate,
      normalized: clamp(m.daily_update_rate),
      weight: weights.daily_updates,
      weighted: 0,
      explanation: `${m.daily_updates_submitted} update(s) over ${m.working_days} working days.`,
    },
  ];

  const totalWeight = lines.reduce((s, l) => s + l.weight, 0) || 100;
  let score = 0;
  for (const l of lines) {
    l.weighted = (l.normalized * l.weight) / totalWeight;
    score += l.weighted;
  }
  return { score: Math.round(score * 10) / 10, lines };
}

/** Leaderboard rows for a period, computed live from task data. */
export async function leaderboard(year: number, month: number, limit = 20) {
  const users = await query<{ id: number; full_name: string; avatar_url: string | null; department_name: string | null; team_name: string | null }>(
    `SELECT u.id, u.full_name, u.avatar_url, d.name AS department_name, t.name AS team_name
       FROM tm_users u
       LEFT JOIN tm_departments d ON d.id = u.department_id
       LEFT JOIN tm_teams t ON t.id = u.team_id
      WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
  );
  const weights = await getWeights();
  const rows = await Promise.all(
    users.map(async (u) => {
      const m = await computeMetrics(u.id, year, month);
      const { score } = scoreFromMetrics(m, weights);
      return { ...u, score, metrics: m, points: Math.round(score * 10) };
    }),
  );
  return rows
    .filter((r) => r.metrics.tasks_assigned > 0 || r.metrics.daily_updates_submitted > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
