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

/**
 * User ids a Leader may act on: active members of the teams they lead.
 *
 * Managers are excluded even when they sit in one of those teams. A Manager
 * outranks the Leader, so surfacing their queue in the Leader portal — or
 * letting a Leader reassign their work — inverts the hierarchy.
 */
export async function teamMemberIds(userId: number): Promise<number[]> {
  const teams = await ledTeamIds(userId);
  if (!teams.length) return [];
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT u.id FROM tm_users u
      WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role <> 'MANAGER'
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
    // Membership lives in tm_team_members; tm_users.team_id is only the
    // person's primary team and is often unset, so both are consulted or a
    // Leader sees none of their team's work.
    // A Manager who happens to sit in the team is not the Leader's report, so
    // their work is filtered out of the widened team clause.
    const teamSql = teams.length
      ? ` OR (${a}.visibility <> 'PRIVATE'
             AND NOT EXISTS (SELECT 1 FROM tm_users mgr
                              WHERE mgr.id = ${a}.assignee_id AND mgr.role = 'MANAGER')
             AND (${a}.team_id IN (?) OR ${a}.assignee_id IN (
            SELECT u2.id FROM tm_users u2 WHERE u2.team_id IN (?) AND u2.role <> 'MANAGER'
             UNION SELECT m2.user_id FROM tm_team_members m2
                    JOIN tm_users u3 ON u3.id = m2.user_id AND u3.role <> 'MANAGER'
                   WHERE m2.is_active = 1 AND m2.team_id IN (?))))`
      : '';
    const teamParams = teams.length ? [teams, teams, teams] : [];
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
    const members = await teamMemberIds(user.id);
    // A Manager's own work is never editable by a Leader, even when it carries
    // the team's id — teamMemberIds already leaves Managers out.
    if (task.assignee_id && !members.includes(task.assignee_id)) return false;
    const teams = await ledTeamIds(user.id);
    if (task.team_id && teams.includes(task.team_id)) return true;
    if (task.assignee_id && members.includes(task.assignee_id)) return true;
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

  if (task.status === 'IN_PROGRESS' || task.status === 'REOPENED') {
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

/**
 * Recomputes and stores a project's completion percentage and health.
 *
 * Both are also derived on read, but the stored columns are what every other
 * surface (project cards elsewhere, exports, reports) reads, so they have to
 * move with the tasks or a project sits at 0% no matter how much is finished.
 *
 * Cancelled tasks leave the denominator: work that was called off must not
 * hold a project below 100%.
 */
export async function refreshProjectProgress(projectId: number | null | undefined) {
  if (!projectId) return;

  const row = await queryOne<Record<string, number | null>>(
    `SELECT COUNT(*) AS total,
            SUM(status = 'COMPLETED') AS completed,
            SUM(status NOT IN ('COMPLETED','CANCELLED') AND deadline < NOW()) AS overdue,
            SUM(status = 'BLOCKED') AS blocked,
            SUM(priority = 'CRITICAL' AND status NOT IN ('COMPLETED','CANCELLED') AND deadline < NOW()) AS critical_overdue
       FROM tm_tasks
      WHERE project_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED'`,
    [projectId],
  );

  const project = await queryOne<{ target_date: string | null }>(
    'SELECT target_date FROM tm_projects WHERE id = ? AND deleted_at IS NULL',
    [projectId],
  );
  if (!project) return;

  const total = Number(row?.total ?? 0);
  const completed = Number(row?.completed ?? 0);
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const daysToTarget = project.target_date
    ? Math.ceil((new Date(project.target_date).getTime() - Date.now()) / 864e5)
    : null;

  const { health, reasons } = projectHealth({
    total,
    completed,
    overdue: Number(row?.overdue ?? 0),
    blocked: Number(row?.blocked ?? 0),
    criticalOverdue: Number(row?.critical_overdue ?? 0),
    daysToTarget,
  });

  await execute('UPDATE tm_projects SET progress = ?, health = ?, health_reasons = CAST(? AS JSON) WHERE id = ?', [
    progress,
    health,
    JSON.stringify(reasons),
    projectId,
  ]);
}

/**
 * Keeps the Approval Center in step with a task's review state.
 *
 * Moving a task into REVIEW raises a TASK_COMPLETION request; moving it out
 * closes whatever was open. The workflow endpoint is not the only way a task
 * reaches REVIEW — the status dropdown in the drawer PATCHes the task directly
 * — so this has to live somewhere both paths can call, or completions submitted
 * from the drawer never appear in the Approval Center at all.
 */
export async function syncCompletionApproval(opts: {
  taskId: number;
  title: string;
  fromStatus: TaskStatus | string;
  toStatus: TaskStatus | string;
  actorId: number;
  reviewerId: number | null;
  comment?: string | null;
}) {
  const { taskId, title, fromStatus, toStatus, actorId, reviewerId, comment } = opts;

  if (toStatus === 'REVIEW') {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM tm_approval_requests
        WHERE type = 'TASK_COMPLETION' AND entity_type = 'TASK' AND entity_id = ? AND status = 'PENDING'`,
      [taskId],
    );
    if (existing) return;
    await execute(
      `INSERT INTO tm_approval_requests (type, requester_id, assigned_to, entity_type, entity_id, payload, reason, status)
       VALUES ('TASK_COMPLETION', ?, ?, 'TASK', ?, CAST(? AS JSON), ?, 'PENDING')`,
      [
        actorId,
        reviewerId,
        taskId,
        JSON.stringify({ submitted_from: fromStatus }),
        comment?.trim() || `Completion review for ${title}`,
      ],
    );
    return;
  }

  // Any move out of review settles the open request. The statement is a no-op
  // when nothing is pending, so it is safe on every other transition too.
  await execute(
    `UPDATE tm_approval_requests
        SET status = ?, decided_by = ?, decided_at = NOW(), decision_comment = ?
      WHERE type = 'TASK_COMPLETION' AND entity_type = 'TASK' AND entity_id = ? AND status = 'PENDING'`,
    [toStatus === 'COMPLETED' ? 'APPROVED' : 'REJECTED', actorId, comment ?? null, taskId],
  );
}

/** The person who reviews a task: its team's Leader, else whoever raised it. */
export async function reviewerFor(task: { team_id: number | null; created_by: number }): Promise<number> {
  if (task.team_id) {
    const team = await queryOne<{ leader_user_id: number | null }>(
      'SELECT leader_user_id FROM tm_teams WHERE id = ? AND deleted_at IS NULL',
      [task.team_id],
    );
    if (team?.leader_user_id) return team.leader_user_id;
  }
  return task.created_by;
}

/**
 * Whether `user` may assign work to `targetUserId`.
 * Managers may assign to anyone; Leaders only within the teams they lead;
 * everyone else only to themselves.
 */
export async function taskMemberScopeCheck(user: SessionUser, targetUserId: number): Promise<boolean> {
  if (user.role === 'MANAGER') return true;
  if (targetUserId === user.id) return true;
  if (user.role !== 'LEADER') return false;
  const members = await teamMemberIds(user.id);
  return members.includes(targetUserId);
}
