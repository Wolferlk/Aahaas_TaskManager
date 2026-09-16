import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { forbidden, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { memberScope, memberWhere } from '@/lib/members';

/**
 * The supervision roster: every person the caller may open, with the live
 * workload numbers the list itself needs to be useful at a glance.
 *
 * The counts are correlated subqueries rather than a second round trip, so the
 * page renders a fully-populated roster from one request.
 */
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const scope = await memberScope(me);
    if (!scope.supervises) {
      throw forbidden('Only a Leader or Manager can open the people portal.');
    }

    const sp = searchParams(req);
    const gate = memberWhere(scope, 'u');

    // The roster totals must count exactly what the detail page will list, or a
    // supervisor sees "12 open" here and nine tasks when they click through.
    // Somebody's own private work still counts on their own row. The viewer id
    // comes from the session, so it is safe to inline.
    const viewer = Number(me.id);
    const visible = `AND (k.is_personal = 0 AND k.visibility <> 'PRIVATE' OR u.id = ${viewer})`;

    const where: string[] = ["u.deleted_at IS NULL", "u.status = 'ACTIVE'", gate.sql];
    const params: unknown[] = [...gate.params];

    const q = sp.get('q');
    if (q) {
      where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.job_title LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const team = sp.get('team_id');
    if (team) {
      where.push(
        `(u.team_id = ? OR EXISTS (SELECT 1 FROM tm_team_members m
            WHERE m.user_id = u.id AND m.is_active = 1 AND m.team_id = ?))`,
      );
      params.push(Number(team), Number(team));
    }
    const dept = sp.get('department_id');
    if (dept) {
      where.push('u.department_id = ?');
      params.push(Number(dept));
    }

    const members = await query(
      `SELECT u.id, u.full_name, u.email, u.avatar_url, u.job_title, u.role, u.availability,
              u.department_id, u.team_id,
              d.name AS department_name, t.name AS team_name,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DRAFT')) AS open_tasks,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                 AND k.deadline IS NOT NULL AND k.deadline < NOW()) AS overdue_tasks,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status NOT IN ('COMPLETED','CANCELLED','REJECTED')
                 AND DATE(k.deadline) = CURDATE()) AS due_today,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status IN ('IN_PROGRESS','REOPENED')) AS in_progress,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status = 'REVIEW') AS in_review,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status = 'BLOCKED') AS blocked,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status = 'COMPLETED' AND k.completed_at >= (NOW() - INTERVAL 7 DAY)) AS completed_7d,
              (SELECT COUNT(*) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status = 'COMPLETED' AND k.completed_at >= (NOW() - INTERVAL 30 DAY)) AS completed_30d,
              (SELECT ROUND(AVG(k.progress)) FROM tm_tasks k WHERE k.assignee_id = u.id AND k.deleted_at IS NULL ${visible}
                 AND k.status NOT IN ('COMPLETED','CANCELLED','REJECTED','DRAFT')) AS avg_progress,
              (SELECT MAX(du.update_date) FROM tm_daily_updates du WHERE du.user_id = u.id) AS last_update_date,
              (SELECT COUNT(*) FROM tm_daily_updates du
                WHERE du.user_id = u.id AND du.update_date = CURDATE()) AS updated_today,
              (SELECT MAX(al.created_at) FROM tm_task_activity_logs al WHERE al.user_id = u.id) AS last_activity_at
         FROM tm_users u
         LEFT JOIN tm_departments d ON d.id = u.department_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(u.role,'MANAGER','LEADER','EMPLOYEE'), u.full_name`,
      params,
    );

    return NextResponse.json({
      members,
      scope: { breadth: scope.breadth, viewer_id: me.id },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
