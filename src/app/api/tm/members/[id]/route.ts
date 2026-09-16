import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { forbidden, intParam, notFound, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { canViewMember, missingUpdateDays } from '@/lib/members';
import { taskMemberScopeCheck } from '@/lib/tasks';
import { TASK_STATUSES, type TaskStatus } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

const TREND_DAYS = 14;

/** A dense day-by-day series, so the chart never has to guess at missing days. */
function emptySeries(days: number) {
  const out: Array<{ date: string; created: number; completed: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      created: 0,
      completed: 0,
    });
  }
  return out;
}

/**
 * Everything one person's supervisor needs on a single screen: who they are,
 * what their queue looks like right now, what they have been filing daily, and
 * what they have touched recently.
 *
 * Read access is the same rule as the roster — your own record, or somebody in
 * a team you lead, or anybody at all if you are a Manager.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);
    if (!Number.isFinite(id) || id <= 0) throw notFound('That person could not be found.');

    if (!(await canViewMember(me, id))) {
      throw forbidden(
        me.role === 'EMPLOYEE'
          ? 'You can only open your own workload.'
          : 'That person is not in a team you lead.',
      );
    }

    const sp = searchParams(req);

    const user = await queryOne(
      `SELECT u.id, u.full_name, u.email, u.role, u.status, u.avatar_url, u.job_title,
              u.employee_code, u.phone, u.availability, u.department_id, u.team_id,
              u.created_at, u.last_login_at,
              d.name AS department_name, t.name AS team_name, l.full_name AS leader_name
         FROM tm_users u
         LEFT JOIN tm_departments d ON d.id = u.department_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
         LEFT JOIN tm_users l ON l.id = t.leader_user_id
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    );
    if (!user) throw notFound('That person could not be found.');

    /* ---------------- task list ---------------- */

    const where: string[] = ['t.deleted_at IS NULL', 't.assignee_id = ?'];
    const listParams: unknown[] = [id];

    // A supervisor is looking at someone else's queue, so private personal
    // tasks stay private unless the reader is the owner.
    if (me.id !== id) where.push("t.is_personal = 0 AND t.visibility <> 'PRIVATE'");

    const statusFilter = sp.get('status');
    if (statusFilter && statusFilter !== 'ALL') {
      const list = statusFilter.split(',').filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s));
      if (list.length) {
        where.push('t.status IN (?)');
        listParams.push(list);
      }
    }
    if (sp.get('bucket') === 'overdue') {
      where.push("t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')");
    } else if (sp.get('bucket') === 'today') {
      where.push("DATE(t.deadline) = CURDATE() AND t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')");
    }

    const q = sp.get('q');
    if (q) {
      where.push('(t.title LIKE ? OR t.task_number LIKE ?)');
      listParams.push(`%${q}%`, `%${q}%`);
    }

    const limit = intParam(sp, 'limit', 100, 300);

    const tasks = await query(
      `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.task_type,
              t.deadline, t.start_date, t.created_at, t.updated_at, t.completed_at,
              t.estimated_hours, t.actual_hours, t.blocked_reason, t.approval_required,
              t.project_id, t.team_id, t.parent_task_id,
              p.name AS project_name, p.color AS project_color,
              c.full_name AS creator_name,
              (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id) AS checklist_count,
              (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id AND ck.is_done = 1) AS checklist_done,
              (SELECT COUNT(*) FROM tm_task_comments cm WHERE cm.task_id = t.id AND cm.deleted_at IS NULL) AS comment_count,
              (t.deadline IS NOT NULL AND t.deadline < NOW()
                 AND t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')) AS is_overdue
         FROM tm_tasks t
         LEFT JOIN tm_projects p ON p.id = t.project_id
         LEFT JOIN tm_users c ON c.id = t.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(t.status,'BLOCKED','REOPENED','IN_PROGRESS','REVIEW','WAITING','TODO','DRAFT','COMPLETED','REJECTED','CANCELLED'),
                 t.deadline IS NULL, t.deadline ASC, t.id DESC
        LIMIT ?`,
      [...listParams, limit],
    );

    /* ---------------- aggregates ---------------- */

    // The summary numbers describe the whole queue, never just the filtered
    // page — otherwise clicking a status tile would rewrite its own count.
    const visibility = me.id === id ? '' : "AND t.is_personal = 0 AND t.visibility <> 'PRIVATE'";

    const [statusRows, priorityRows, projectRows, totals, createdRows, completedRows, daily, activity, missing] =
      await Promise.all([
        query<{ status: TaskStatus; c: number }>(
          `SELECT t.status, COUNT(*) AS c FROM tm_tasks t
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}
            GROUP BY t.status`,
          [id],
        ),
        query<{ priority: string; c: number }>(
          `SELECT t.priority, COUNT(*) AS c FROM tm_tasks t
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}
              AND t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
            GROUP BY t.priority`,
          [id],
        ),
        query(
          `SELECT COALESCE(p.name, 'No project') AS project_name, p.color AS project_color,
                  COUNT(*) AS total,
                  SUM(t.status = 'COMPLETED') AS completed,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')) AS open_count
             FROM tm_tasks t
             LEFT JOIN tm_projects p ON p.id = t.project_id
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}
            GROUP BY p.id, p.name, p.color
            ORDER BY total DESC LIMIT 8`,
          [id],
        ),
        queryOne<Record<string, number | null>>(
          `SELECT COUNT(*) AS total,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DRAFT')) AS open_tasks,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                      AND t.deadline IS NOT NULL AND t.deadline < NOW()) AS overdue,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                      AND DATE(t.deadline) = CURDATE()) AS due_today,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                      AND t.deadline IS NOT NULL
                      AND t.deadline BETWEEN NOW() AND (NOW() + INTERVAL 7 DAY)) AS due_week,
                  SUM(t.status = 'COMPLETED' AND t.completed_at >= (NOW() - INTERVAL 30 DAY)) AS completed_30d,
                  SUM(t.status = 'COMPLETED'
                      AND t.completed_at IS NOT NULL AND t.deadline IS NOT NULL
                      AND t.completed_at <= t.deadline) AS completed_on_time,
                  SUM(t.status = 'COMPLETED' AND t.deadline IS NOT NULL) AS completed_with_deadline,
                  ROUND(AVG(CASE WHEN t.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DRAFT')
                                 THEN t.progress END)) AS avg_progress,
                  ROUND(SUM(COALESCE(t.estimated_hours, 0)), 1) AS estimated_hours,
                  ROUND(SUM(COALESCE(t.actual_hours, 0)), 1) AS actual_hours
             FROM tm_tasks t
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}`,
          [id],
        ),
        query<{ d: string; c: number }>(
          `SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') AS d, COUNT(*) AS c FROM tm_tasks t
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}
              AND t.created_at >= (CURDATE() - INTERVAL ? DAY)
            GROUP BY d`,
          [id, TREND_DAYS - 1],
        ),
        query<{ d: string; c: number }>(
          `SELECT DATE_FORMAT(t.completed_at, '%Y-%m-%d') AS d, COUNT(*) AS c FROM tm_tasks t
            WHERE t.deleted_at IS NULL AND t.assignee_id = ? ${visibility}
              AND t.completed_at >= (CURDATE() - INTERVAL ? DAY)
            GROUP BY d`,
          [id, TREND_DAYS - 1],
        ),
        query(
          `SELECT d.id, DATE_FORMAT(d.update_date, '%Y-%m-%d') AS update_date, d.summary, d.total_hours,
                  d.status, d.mood, d.blockers, d.submitted_at, d.source,
                  dd.is_auto_submitted, dd.next_day_plan, dd.focus_area,
                  (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = d.id) AS item_count
             FROM tm_daily_updates d
             LEFT JOIN tm_daily_update_details dd ON dd.daily_update_id = d.id
            WHERE d.user_id = ?
            ORDER BY d.update_date DESC LIMIT 14`,
          [id],
        ),
        query(
          `SELECT a.action, a.field, a.old_value, a.new_value, a.created_at,
                  t.id AS task_id, t.task_number, t.title
             FROM tm_task_activity_logs a
             JOIN tm_tasks t ON t.id = a.task_id
            WHERE a.user_id = ? AND t.deleted_at IS NULL
            ORDER BY a.created_at DESC LIMIT 30`,
          [id],
        ),
        missingUpdateDays(id, TREND_DAYS),
      ]);

    const status_counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const row of statusRows) status_counts[row.status] = Number(row.c);

    const priority_counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const row of priorityRows) priority_counts[row.priority] = Number(row.c);

    const trend = emptySeries(TREND_DAYS);
    const byDate = new Map(trend.map((p) => [p.date, p]));
    for (const row of createdRows) {
      const point = byDate.get(row.d);
      if (point) point.created = Number(row.c);
    }
    for (const row of completedRows) {
      const point = byDate.get(row.d);
      if (point) point.completed = Number(row.c);
    }

    const num = (v: number | null | undefined) => Number(v ?? 0);
    const withDeadline = num(totals?.completed_with_deadline);

    return NextResponse.json({
      user,
      stats: {
        total: num(totals?.total),
        open_tasks: num(totals?.open_tasks),
        overdue: num(totals?.overdue),
        due_today: num(totals?.due_today),
        due_week: num(totals?.due_week),
        completed_30d: num(totals?.completed_30d),
        avg_progress: num(totals?.avg_progress),
        estimated_hours: num(totals?.estimated_hours),
        actual_hours: num(totals?.actual_hours),
        // Left null rather than 100% when nothing finished against a deadline —
        // "no data" and "perfect record" must not look the same.
        on_time_rate: withDeadline ? Math.round((num(totals?.completed_on_time) / withDeadline) * 100) : null,
      },
      status_counts,
      priority_counts,
      projects: projectRows,
      tasks,
      trend,
      daily,
      missing_updates: missing,
      activity,
      can_assign: await taskMemberScopeCheck(me, id),
      is_self: me.id === id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
