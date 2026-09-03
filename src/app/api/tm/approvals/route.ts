import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, parseBody, requirePermission, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { extensionRequestSchema } from '@/lib/validation';
import { ledTeamIds } from '@/lib/tasks';
import { managerIds, notify, notifyMany } from '@/lib/notifications';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const where: string[] = [];
    const params: unknown[] = [];

    const status = sp.get('status') ?? 'PENDING';
    if (status !== 'ALL') {
      where.push('a.status = ?');
      params.push(status);
    }
    const type = sp.get('type');
    if (type && type !== 'ALL') {
      where.push('a.type = ?');
      params.push(type);
    }

    if (user.role === 'MANAGER') {
      // Managers see everything.
    } else if (user.role === 'LEADER') {
      const teams = await ledTeamIds(user.id);
      where.push("a.type <> 'USER_SIGNUP'");
      if (teams.length) {
        where.push('(a.assigned_to = ? OR r.team_id IN (?))');
        params.push(user.id, teams);
      } else {
        where.push('a.assigned_to = ?');
        params.push(user.id);
      }
    } else {
      where.push('a.requester_id = ?');
      params.push(user.id);
    }

    const rows = await query(
      `SELECT a.*, r.full_name AS requester_name, r.avatar_url AS requester_avatar, r.email AS requester_email,
              r.requested_role, r.job_title, r.status AS requester_status,
              d.name AS department_name, t.name AS team_name,
              decider.full_name AS decided_by_name,
              tk.task_number, tk.title AS task_title, tk.deadline AS task_deadline
         FROM tm_approval_requests a
         LEFT JOIN tm_users r ON r.id = a.requester_id
         LEFT JOIN tm_departments d ON d.id = r.department_id
         LEFT JOIN tm_teams t ON t.id = r.team_id
         LEFT JOIN tm_users decider ON decider.id = a.decided_by
         LEFT JOIN tm_tasks tk ON tk.id = a.entity_id AND a.entity_type = 'TASK'
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY FIELD(a.status,'PENDING','APPROVED','REJECTED'), a.created_at DESC
        LIMIT 200`,
      params,
    );

    const counts = await query<{ type: string; c: number }>(
      user.role === 'MANAGER'
        ? "SELECT type, COUNT(*) AS c FROM tm_approval_requests WHERE status = 'PENDING' GROUP BY type"
        : "SELECT type, COUNT(*) AS c FROM tm_approval_requests WHERE status = 'PENDING' AND type <> 'USER_SIGNUP' GROUP BY type",
    );

    return NextResponse.json({
      approvals: rows,
      counts: Object.fromEntries(counts.map((c) => [c.type, Number(c.c)])),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Employees raise a deadline extension request rather than moving the date. */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.approval.request');
    const body = await parseBody(req, extensionRequestSchema);

    const task = await queryOne<{ id: number; title: string; deadline: string | null; team_id: number | null; created_by: number }>(
      'SELECT id, title, deadline, team_id, created_by FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
      [body.task_id],
    );
    if (!task) return NextResponse.json({ error: 'That task no longer exists.' }, { status: 404 });

    const team = task.team_id
      ? await queryOne<{ leader_user_id: number | null }>('SELECT leader_user_id FROM tm_teams WHERE id = ?', [task.team_id])
      : null;
    const approver = team?.leader_user_id ?? task.created_by;

    const res = await execute(
      `INSERT INTO tm_approval_requests (type, requester_id, assigned_to, entity_type, entity_id, payload, reason, status)
       VALUES ('DEADLINE_EXTENSION', ?, ?, 'TASK', ?, CAST(? AS JSON), ?, 'PENDING')`,
      [
        user.id,
        approver,
        task.id,
        JSON.stringify({ current_deadline: task.deadline, requested_deadline: body.requested_deadline }),
        body.reason,
      ],
    );

    if (approver) {
      await notify({
        userId: approver,
        type: 'DEADLINE_EXTENSION_REQUEST',
        title: `Extension requested: ${task.title}`,
        body: body.reason,
        link: '/tm/approvals',
        entityType: 'TASK',
        entityId: task.id,
        actorId: user.id,
        priority: 'HIGH',
      });
    } else {
      await notifyMany(await managerIds(), {
        type: 'DEADLINE_EXTENSION_REQUEST',
        title: `Extension requested: ${task.title}`,
        body: body.reason,
        link: '/tm/approvals',
        entityType: 'TASK',
        entityId: task.id,
        actorId: user.id,
        priority: 'HIGH',
      });
    }

    await audit(user.id, 'DEADLINE_EXTENSION_REQUESTED', 'TASK', task.id, task.deadline, body.requested_deadline);
    return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
