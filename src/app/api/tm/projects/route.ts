import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { projectSchema } from '@/lib/validation';
import { projectHealth } from '@/lib/tasks';

export async function GET() {
  try {
    await requireUser();

    const projects = await query<Record<string, unknown> & { id: number; target_date: string | null }>(
      `SELECT p.*, d.name AS department_name,
              o.full_name AS owner_name, o.avatar_url AS owner_avatar,
              l.full_name AS leader_name,
              (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS total_tasks,
              (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'COMPLETED') AS completed_tasks,
              (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL
                 AND t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue_tasks,
              (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status = 'BLOCKED') AS blocked_tasks,
              (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL
                 AND t.priority = 'CRITICAL' AND t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS critical_overdue,
              (SELECT COUNT(*) FROM tm_project_members m WHERE m.project_id = p.id) AS member_count
         FROM tm_projects p
         LEFT JOIN tm_departments d ON d.id = p.department_id
         LEFT JOIN tm_users o ON o.id = p.owner_user_id
         LEFT JOIN tm_users l ON l.id = p.leader_user_id
        WHERE p.deleted_at IS NULL
        ORDER BY FIELD(p.status,'ACTIVE','PLANNING','ON_HOLD','COMPLETED','CANCELLED'), p.name`,
    );

    // Health is derived on read so it always reflects current task state.
    const enriched = projects.map((p) => {
      const total = Number(p.total_tasks ?? 0);
      const completed = Number(p.completed_tasks ?? 0);
      const daysToTarget = p.target_date
        ? Math.ceil((new Date(p.target_date).getTime() - Date.now()) / 864e5)
        : null;
      const { health, reasons } = projectHealth({
        total,
        completed,
        overdue: Number(p.overdue_tasks ?? 0),
        blocked: Number(p.blocked_tasks ?? 0),
        criticalOverdue: Number(p.critical_overdue ?? 0),
        daysToTarget,
      });
      return {
        ...p,
        progress: total ? Math.round((completed / total) * 100) : Number(p.progress ?? 0),
        health,
        health_reasons: reasons,
        days_to_target: daysToTarget,
      };
    });

    return NextResponse.json({ projects: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.project.manage');
    const body = await parseBody(req, projectSchema);

    const clash = await queryOne<{ id: number }>('SELECT id FROM tm_projects WHERE code = ?', [body.code]);
    if (clash) return NextResponse.json({ error: 'That project code is already in use.' }, { status: 409 });

    const res = await execute(
      `INSERT INTO tm_projects
         (name, code, description, department_id, owner_user_id, leader_user_id, start_date, target_date, status, color, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        body.name,
        body.code.toUpperCase(),
        body.description ?? null,
        body.department_id ?? null,
        body.owner_user_id ?? user.id,
        body.leader_user_id ?? null,
        body.start_date ? new Date(body.start_date) : null,
        body.target_date ? new Date(body.target_date) : null,
        body.status,
        body.color ?? null,
        user.id,
      ],
    );

    for (const memberId of body.member_ids ?? []) {
      await execute('INSERT IGNORE INTO tm_project_members (project_id, user_id) VALUES (?,?)', [res.insertId, memberId]);
    }

    await audit(user.id, 'PROJECT_CREATED', 'PROJECT', res.insertId, null, body);
    return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
