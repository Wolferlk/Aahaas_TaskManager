import 'server-only';
import { execute, query, queryOne, type PoolConnection } from './db';
import type { Priority, SessionUser, TaskStatus } from './types';

/* ------------------------------------------------------------------ *
 * Task numbering
 * ------------------------------------------------------------------ */

/**
 * Allocates the next human-readable task number, e.g. `TM-IT-2026-000124`.
 * The counter row is locked for the duration of the transaction, so a number
 * is never handed out twice and never reused.
 */
export async function nextTaskNumber(cx: PoolConnection, departmentCode?: string | null): Promise<string> {
  const year = new Date().getFullYear();
  const scope = (departmentCode || 'GEN').toUpperCase().slice(0, 20);

  await cx.query(
    'INSERT INTO tm_task_counters (scope, year, last_seq) VALUES (?,?,0) ON DUPLICATE KEY UPDATE scope = scope',
    [scope, year],
  );
  await cx.query('SELECT last_seq FROM tm_task_counters WHERE scope = ? AND year = ? FOR UPDATE', [scope, year]);
  await cx.query('UPDATE tm_task_counters SET last_seq = last_seq + 1 WHERE scope = ? AND year = ?', [scope, year]);
  const [rows] = await cx.query('SELECT last_seq FROM tm_task_counters WHERE scope = ? AND year = ?', [scope, year]);
  const seq = (rows as Array<{ last_seq: number }>)[0].last_seq;

  const padded = String(seq).padStart(6, '0');
  return scope === 'GEN' ? `TM-${year}-${padded}` : `TM-${scope}-${year}-${padded}`;
}

/* ------------------------------------------------------------------ *
 * Visibility scoping
 * ------------------------------------------------------------------ */

export interface Scope {
  sql: string;
  params: unknown[];
}

/** Team ids a Leader is currently responsible for. */
export async function ledTeamIds(userId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT t.id FROM tm_teams t
      WHERE t.deleted_at IS NULL
        AND (t.leader_user_id = ?
             OR EXISTS (SELECT 1 FROM tm_team_members m
                         WHERE m.team_id = t.id AND m.user_id = ? AND m.role_in_team = 'LEADER' AND m.is_active = 1))`,
    [userId, userId],
  );
  return rows.map((r) => r.id);
}

/** User ids a Leader may act on: active members of the teams they lead. */
export async function teamMemberIds(userId: number): Promise<number[]> {
  const teams = await ledTeamIds(userId);
  if (!teams.length) return [];
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT u.id FROM tm_users u
      WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
        AND (u.team_id IN (?) OR EXISTS (SELECT 1 FROM tm_team_members m
              WHERE m.user_id = u.id AND m.is_active = 1 AND m.team_id IN (?)))`,
    [teams, teams],
  );
  return rows.map((r) => r.id);
}

/**
 * Builds the WHERE fragment restricting which tasks `user` may read.
 * This is the single source of truth for task-level read access.
 */
export async function taskScope(user: SessionUser, alias = 't'): Promise<Scope> {
  const a = alias;

  if (user.role === 'MANAGER') {
    // Managers see everything except other people's private personal tasks.
    return {
      sql: `(${a}.visibility <> 'PRIVATE' OR ${a}.created_by = ? OR ${a}.assignee_id = ?)`,
      params: [user.id, user.id],
    };
  }

  const mine = `(${a}.created_by = ? OR ${a}.assignee_id = ?
                 OR EXISTS (SELECT 1 FROM tm_task_assignees ta WHERE ta.task_id = ${a}.id AND ta.user_id = ? AND ta.unassigned_at IS NULL)
                 OR EXISTS (SELECT 1 FROM tm_task_watchers w WHERE w.task_id = ${a}.id AND w.user_id = ?))`;
  const mineParams = [user.id, user.id, user.id, user.id];

  if (user.role === 'LEADER') {
    const teams = await ledTeamIds(user.id);
    const teamSql = teams.length
      ? ` OR (${a}.visibility <> 'PRIVATE' AND (${a}.team_id IN (?) OR ${a}.assignee_id IN (
            SELECT u2.id FROM tm_users u2 WHERE u2.team_id IN (?))))`
      : '';
    const teamParams = teams.length ? [teams, teams] : [];
    return {
      sql: `(${mine}${teamSql}
             OR (${a}.visibility IN ('DEPARTMENT','PUBLIC') AND ${a}.department_id <=> ?))`,
      params: [...mineParams, ...teamParams, user.department_id],
    };
  }

  // Employee
  return {
    sql: `(${mine}
           OR (${a}.visibility = 'TEAM' AND ${a}.team_id IS NOT NULL AND ${a}.team_id <=> ?)
           OR (${a}.visibility = 'DEPARTMENT' AND ${a}.department_id IS NOT NULL AND ${a}.department_id <=> ?)
           OR ${a}.visibility = 'PUBLIC')`,
    params: [...mineParams, user.team_id, user.department_id],
  };
}

/** Whether `user` may edit the given task. Mirrors the RBAC matrix. */
export async function canEditTask(
  user: SessionUser,
  task: { created_by: number; assignee_id: number | null; team_id: number | null },
): Promise<boolean> {
  if (user.role === 'MANAGER') return true;
  if (task.created_by === user.id) return true;
  if (user.role === 'LEADER') {
    const teams = await ledTeamIds(user.id);
    if (task.team_id && teams.includes(task.team_id)) return true;
    if (task.assignee_id) {
      const members = await teamMemberIds(user.id);
      if (members.includes(task.assignee_id)) return true;
    }
  }
  return false;
}

/** Employees may progress their own work but not rewrite its definition. */
export function canUpdateOwnProgress(user: SessionUser, task: { assignee_id: number | null }) {
  return task.assignee_id === user.id;
}

/* ------------------------------------------------------------------ *
 * History and activity
 * ------------------------------------------------------------------ */

export async function logActivity(
  taskId: number,
  userId: number | null,
  action: string,
  field?: string | null,
  oldValue?: unknown,
  newValue?: unknown,
  meta?: unknown,
) {
  const str = (v: unknown) =>
    v === null || v === undefined ? null : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 2000);
  await execute(
    `INSERT INTO tm_task_activity_logs (task_id, user_id, action, field, old_value, new_value, meta)
     VALUES (?,?,?,?,?,?,?)`,
    [taskId, userId, action, field ?? null, str(oldValue), str(newValue), meta ? JSON.stringify(meta) : null],
  );
}

export async function logStatusChange(
  taskId: number,
  from: TaskStatus | null,
  to: TaskStatus,
  userId: number | null,
  reason?: string | null,
) {
  await execute(
    'INSERT INTO tm_task_status_history (task_id, from_status, to_status, changed_by, reason) VALUES (?,?,?,?,?)',
    [taskId, from, to, userId, reason ?? null],
  );
}

/* ------------------------------------------------------------------ *
 * Derived values
 * ------------------------------------------------------------------ */

const PRIORITY_WEIGHT: Record<Priority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Deterministic focus score used by "What should I do today?".
 * Rules first, so the ordering is explainable without any AI call.
 */
export function focusScore(task: {
  priority: Priority;
  deadline: string | Date | null;
  status: TaskStatus;
  progress: number;
  estimated_hours: string | number | null;
  blocks_count?: number;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = PRIORITY_WEIGHT[task.priority] * 12;
  if (task.priority === 'CRITICAL') reasons.push('Critical priority');
  else if (task.priority === 'HIGH') reasons.push('High priority');

  if (task.deadline) {
    const hours = (new Date(task.deadline).getTime() - Date.now()) / 36e5;
    if (hours < 0) {
      score += 60;
      reasons.push(`Overdue by ${Math.abs(Math.round(hours / 24))}d`);
    } else if (hours <= 8) {
      score += 45;
      reasons.push(`Due in ${Math.max(1, Math.round(hours))}h`);
    } else if (hours <= 24) {
      score += 32;
      reasons.push('Due today');
    } else if (hours <= 72) {
      score += 18;
      reasons.push(`Due in ${Math.round(hours / 24)}d`);
    }
  }

  if (task.blocks_count && task.blocks_count > 0) {
    score += task.blocks_count * 10;
    reasons.push(`Blocks ${task.blocks_count} other task${task.blocks_count > 1 ? 's' : ''}`);
  }

  if (task.status === 'IN_PROGRESS') {
    score += 8;
    if (task.progress >= 50) reasons.push(`${task.progress}% done — close to finishing`);
  }
  if (task.status === 'BLOCKED') score -= 25;
  if (task.status === 'REVIEW') score -= 10;

  const est = Number(task.estimated_hours ?? 0);
  if (est > 0 && est <= 1) {
    score += 6;
    reasons.push('Quick win (under 1h)');
  }

  return { score: Math.round(score), reasons: reasons.slice(0, 3) };
}

/** Health of a project from its own task numbers — no hidden weighting. */
export function projectHealth(m: {
  total: number;
  completed: number;
  overdue: number;
  blocked: number;
  criticalOverdue: number;
  daysToTarget: number | null;
}): { health: 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'CRITICAL'; reasons: string[] } {
  const reasons: string[] = [];
  if (m.total === 0) return { health: 'HEALTHY', reasons: ['No tasks yet'] };

  const overduePct = (m.overdue / m.total) * 100;
  const completePct = (m.completed / m.total) * 100;
  let risk = 0;

  if (overduePct >= 30) {
    risk += 3;
    reasons.push(`${Math.round(overduePct)}% of tasks overdue`);
  } else if (overduePct >= 15) {
    risk += 2;
    reasons.push(`${Math.round(overduePct)}% of tasks overdue`);
  } else if (overduePct > 0) {
    risk += 1;
    reasons.push(`${m.overdue} overdue task${m.overdue > 1 ? 's' : ''}`);
  }

  if (m.criticalOverdue > 0) {
    risk += 2;
    reasons.push(`${m.criticalOverdue} critical task${m.criticalOverdue > 1 ? 's' : ''} overdue`);
  }
  if (m.blocked > 0) {
    risk += m.blocked >= 3 ? 2 : 1;
    reasons.push(`${m.blocked} blocked task${m.blocked > 1 ? 's' : ''}`);
  }
  if (m.daysToTarget !== null && m.daysToTarget <= 7 && completePct < 80) {
    risk += 2;
    reasons.push(`Target date in ${m.daysToTarget}d with ${Math.round(completePct)}% complete`);
  }
  if (m.daysToTarget !== null && m.daysToTarget < 0 && completePct < 100) {
    risk += 3;
    reasons.push('Past its target date');
  }

  const health = risk >= 6 ? 'CRITICAL' : risk >= 4 ? 'AT_RISK' : risk >= 2 ? 'NEEDS_ATTENTION' : 'HEALTHY';
  if (!reasons.length) reasons.push(`${Math.round(completePct)}% complete, nothing overdue`);
  return { health, reasons };
}

/** Recomputes and stores a parent task's progress from its subtasks. */
export async function refreshParentProgress(parentId: number) {
  const row = await queryOne<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, SUM(status = 'COMPLETED') AS done
       FROM tm_tasks WHERE parent_task_id = ? AND deleted_at IS NULL`,
    [parentId],
  );
  if (!row || !row.total) return;
  const progress = Math.round((Number(row.done) / Number(row.total)) * 100);
  await execute('UPDATE tm_tasks SET progress = ? WHERE id = ?', [progress, parentId]);
}
