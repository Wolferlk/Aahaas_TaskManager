import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireUser, toErrorResponse } from '@/lib/api';
import { focusScore, ledTeamIds } from '@/lib/tasks';
import { computeMetrics, getWeights, scoreFromMetrics } from '@/lib/performance';
import type { Priority, TaskStatus } from '@/lib/types';

const TASK_FIELDS = `t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.deadline,
  t.estimated_hours, t.project_id, t.assignee_id,
  p.name AS project_name, p.color AS project_color,
  u.full_name AS assignee_name, u.avatar_url AS assignee_avatar`;

const TASK_JOINS = `LEFT JOIN tm_projects p ON p.id = t.project_id
  LEFT JOIN tm_users u ON u.id = t.assignee_id`;

export async function GET() {
  try {
    const user = await requireUser();

    const counters = await queryOne<Record<string, number>>(
      `SELECT
         SUM(status NOT IN ('COMPLETED','CANCELLED','DRAFT')) AS open_tasks,
         SUM(DATE(deadline) = CURDATE() AND status NOT IN ('COMPLETED','CANCELLED')) AS due_today,
         SUM(deadline < NOW() AND status NOT IN ('COMPLETED','CANCELLED')) AS overdue,
         SUM(status = 'BLOCKED') AS blocked,
         SUM(status = 'REVIEW') AS in_review,
         SUM(status = 'IN_PROGRESS') AS in_progress,
         SUM(status = 'COMPLETED' AND DATE(completed_at) = CURDATE()) AS completed_today,
         SUM(DATE(created_at) = CURDATE()) AS assigned_today,
         SUM(deadline BETWEEN NOW() AND (NOW() + INTERVAL 7 DAY) AND status NOT IN ('COMPLETED','CANCELLED')) AS due_this_week
       FROM tm_tasks
      WHERE assignee_id = ? AND deleted_at IS NULL`,
      [user.id],
    );

    const [today, overdue, upcoming, recentActivity] = await Promise.all([
      query(
        `SELECT ${TASK_FIELDS} FROM tm_tasks t ${TASK_JOINS}
          WHERE t.assignee_id = ? AND t.deleted_at IS NULL
            AND t.status NOT IN ('COMPLETED','CANCELLED')
            AND (DATE(t.deadline) <= CURDATE() OR t.status = 'IN_PROGRESS')
          ORDER BY FIELD(t.priority,'CRITICAL','HIGH','MEDIUM','LOW'), t.deadline
          LIMIT 12`,
        [user.id],
      ),
      query(
        `SELECT ${TASK_FIELDS} FROM tm_tasks t ${TASK_JOINS}
          WHERE t.assignee_id = ? AND t.deleted_at IS NULL
            AND t.deadline < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')
          ORDER BY t.deadline LIMIT 10`,
        [user.id],
      ),
      query(
        `SELECT ${TASK_FIELDS} FROM tm_tasks t ${TASK_JOINS}
          WHERE t.assignee_id = ? AND t.deleted_at IS NULL
            AND t.deadline > NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')
          ORDER BY t.deadline LIMIT 10`,
        [user.id],
      ),
      query(
        `SELECT a.action, a.field, a.created_at, t.id AS task_id, t.task_number, t.title,
                u.full_name, u.avatar_url
           FROM tm_task_activity_logs a
           JOIN tm_tasks t ON t.id = a.task_id
           LEFT JOIN tm_users u ON u.id = a.user_id
          WHERE t.deleted_at IS NULL AND (t.assignee_id = ? OR t.created_by = ?)
          ORDER BY a.created_at DESC LIMIT 15`,
        [user.id, user.id],
      ),
    ]);

    // --- What should I do today? — deterministic ranking -------------------
    const candidates = await query<{
      id: number;
      task_number: string;
      title: string;
      status: TaskStatus;
      priority: Priority;
      progress: number;
      deadline: string | null;
      estimated_hours: string | null;
      project_name: string | null;
      blocks_count: number;
    }>(
      `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.deadline,
              t.estimated_hours, p.name AS project_name,
              (SELECT COUNT(*) FROM tm_task_dependencies d
                 JOIN tm_tasks bt ON bt.id = d.task_id
                WHERE d.depends_on_task_id = t.id AND d.type = 'BLOCKED_BY'
                  AND bt.status NOT IN ('COMPLETED','CANCELLED') AND bt.deleted_at IS NULL) AS blocks_count
         FROM tm_tasks t
         LEFT JOIN tm_projects p ON p.id = t.project_id
        WHERE t.assignee_id = ? AND t.deleted_at IS NULL
          AND t.status IN ('TODO','IN_PROGRESS','BLOCKED','WAITING')
        LIMIT 100`,
      [user.id],
    );

    const focus = candidates
      .map((t) => ({ ...t, ...focusScore({ ...t, blocks_count: Number(t.blocks_count) }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // --- Daily update status ------------------------------------------------
    const dailyUpdate = await queryOne<{ id: number; status: string }>(
      'SELECT id, status FROM tm_daily_updates WHERE user_id = ? AND update_date = CURDATE()',
      [user.id],
    );

    const now = new Date();
    const metrics = await computeMetrics(user.id, now.getFullYear(), now.getMonth() + 1);
    const { score } = scoreFromMetrics(metrics, await getWeights());

    // --- Leader / Manager panels -------------------------------------------
    let teamWorkload: unknown[] = [];
    let approvals = 0;

    if (user.role === 'LEADER' || user.role === 'MANAGER') {
      const teams = user.role === 'MANAGER' ? null : await ledTeamIds(user.id);
      const teamFilter = teams && teams.length ? 'AND u.team_id IN (?)' : teams ? 'AND 1 = 0' : '';
      const teamParams = teams && teams.length ? [teams] : [];

      teamWorkload = await query(
        `SELECT u.id, u.full_name, u.avatar_url, u.availability, u.job_title,
                COUNT(t.id) AS open_tasks,
                SUM(t.priority = 'CRITICAL') AS critical_tasks,
                SUM(t.deadline < NOW()) AS overdue_tasks,
                SUM(DATE(t.deadline) = CURDATE()) AS due_today,
                SUM(t.status = 'BLOCKED') AS blocked_tasks,
                COALESCE(SUM(GREATEST(COALESCE(t.estimated_hours,0) * (100 - t.progress) / 100, 0)), 0) AS remaining_hours,
                (SELECT COUNT(*) FROM tm_tasks c WHERE c.assignee_id = u.id AND c.deleted_at IS NULL
                   AND c.status = 'COMPLETED' AND c.completed_at >= (NOW() - INTERVAL 7 DAY)) AS completed_week
           FROM tm_users u
           LEFT JOIN tm_tasks t ON t.assignee_id = u.id AND t.deleted_at IS NULL
                AND t.status NOT IN ('COMPLETED','CANCELLED')
          WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL ${teamFilter}
          GROUP BY u.id, u.full_name, u.avatar_url, u.availability, u.job_title
          ORDER BY remaining_hours DESC
          LIMIT 25`,
        teamParams,
      );

      const pending = await queryOne<{ c: number }>(
        user.role === 'MANAGER'
          ? "SELECT COUNT(*) AS c FROM tm_approval_requests WHERE status = 'PENDING'"
          : "SELECT COUNT(*) AS c FROM tm_approval_requests WHERE status = 'PENDING' AND type <> 'USER_SIGNUP'",
      );
      approvals = Number(pending?.c ?? 0);
    }

    return NextResponse.json({
      counters: Object.fromEntries(Object.entries(counters ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
      today,
      overdue,
      upcoming,
      focus,
      recent_activity: recentActivity,
      daily_update: dailyUpdate,
      performance: { score, metrics },
      team_workload: teamWorkload,
      pending_approvals: approvals,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
