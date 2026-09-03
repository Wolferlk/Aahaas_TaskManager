import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, notFound, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { projectSchema } from '@/lib/validation';
import { projectHealth } from '@/lib/tasks';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireUser();
    const id = Number((await params).id);

    const project = await queryOne<Record<string, unknown> & { target_date: string | null }>(
      `SELECT p.*, d.name AS department_name, o.full_name AS owner_name, l.full_name AS leader_name
         FROM tm_projects p
         LEFT JOIN tm_departments d ON d.id = p.department_id
         LEFT JOIN tm_users o ON o.id = p.owner_user_id
         LEFT JOIN tm_users l ON l.id = p.leader_user_id
        WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id],
    );
    if (!project) throw notFound('Project not found.');

    const [stats, members, tasks, activity] = await Promise.all([
      queryOne<Record<string, number>>(
        `SELECT COUNT(*) AS total,
                SUM(status = 'COMPLETED') AS completed,
                SUM(status NOT IN ('COMPLETED','CANCELLED') AND deadline < NOW()) AS overdue,
                SUM(status = 'BLOCKED') AS blocked,
                SUM(priority = 'CRITICAL' AND status NOT IN ('COMPLETED','CANCELLED') AND deadline < NOW()) AS critical_overdue,
                SUM(status = 'IN_PROGRESS') AS in_progress
           FROM tm_tasks WHERE project_id = ? AND deleted_at IS NULL`,
        [id],
      ),
      query(
        `SELECT u.id, u.full_name, u.avatar_url, u.job_title, m.role_in_project,
                (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = ? AND t.assignee_id = u.id
                   AND t.deleted_at IS NULL AND t.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks
           FROM tm_project_members m JOIN tm_users u ON u.id = m.user_id
          WHERE m.project_id = ?`,
        [id, id],
      ),
      query(
        `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.deadline,
                u.full_name AS assignee_name, u.avatar_url AS assignee_avatar
           FROM tm_tasks t LEFT JOIN tm_users u ON u.id = t.assignee_id
          WHERE t.project_id = ? AND t.deleted_at IS NULL
          ORDER BY FIELD(t.status,'BLOCKED','IN_PROGRESS','REVIEW','TODO','WAITING','COMPLETED','CANCELLED'),
                   FIELD(t.priority,'CRITICAL','HIGH','MEDIUM','LOW'), t.deadline
          LIMIT 200`,
        [id],
      ),
      query(
        `SELECT a.action, a.field, a.created_at, t.task_number, t.title, u.full_name
           FROM tm_task_activity_logs a
           JOIN tm_tasks t ON t.id = a.task_id
           LEFT JOIN tm_users u ON u.id = a.user_id
          WHERE t.project_id = ? ORDER BY a.created_at DESC LIMIT 20`,
        [id],
      ),
    ]);

    const total = Number(stats?.total ?? 0);
    const completed = Number(stats?.completed ?? 0);
    const daysToTarget = project.target_date
      ? Math.ceil((new Date(project.target_date).getTime() - Date.now()) / 864e5)
      : null;
    const { health, reasons } = projectHealth({
      total,
      completed,
      overdue: Number(stats?.overdue ?? 0),
      blocked: Number(stats?.blocked ?? 0),
      criticalOverdue: Number(stats?.critical_overdue ?? 0),
      daysToTarget,
    });

    return NextResponse.json({
      project: {
        ...project,
        progress: total ? Math.round((completed / total) * 100) : 0,
        health,
        health_reasons: reasons,
        days_to_target: daysToTarget,
      },
      stats: Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
      members,
      tasks,
      activity,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.project.manage');
    const id = Number((await params).id);
    const body = await parseBody(req, projectSchema.partial());

    const before = await queryOne('SELECT * FROM tm_projects WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!before) throw notFound('Project not found.');

    const { member_ids, ...rest } = body;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      fields.push(`\`${k}\` = ?`);
      values.push(
        k === 'code' && typeof v === 'string'
          ? v.toUpperCase()
          : (k === 'start_date' || k === 'target_date') && v
            ? new Date(v as string)
            : v,
      );
    }
    if (fields.length) {
      values.push(id);
      await execute(`UPDATE tm_projects SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (member_ids) {
      await execute('DELETE FROM tm_project_members WHERE project_id = ?', [id]);
      for (const uid of member_ids) {
        await execute('INSERT IGNORE INTO tm_project_members (project_id, user_id) VALUES (?,?)', [id, uid]);
      }
    }

    await audit(user.id, 'PROJECT_UPDATED', 'PROJECT', id, before, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.project.manage');
    const id = Number((await params).id);
    await execute('UPDATE tm_projects SET deleted_at = NOW() WHERE id = ?', [id]);
    await audit(user.id, 'PROJECT_DELETED', 'PROJECT', id);
    return NextResponse.json({ ok: true, restorable: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
