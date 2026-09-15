import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, queryOne } from '@/lib/db';
import { audit, badRequest, forbidden, notFound, parseBody, requirePermission, toErrorResponse } from '@/lib/api';
import { leaderRequestSchema, reassignmentRequestSchema } from '@/lib/validation';
import { managerIds, notify, notifyMany } from '@/lib/notifications';

const schema = z.discriminatedUnion('kind', [
  reassignmentRequestSchema.extend({ kind: z.literal('TASK_REASSIGNMENT') }),
  leaderRequestSchema.extend({ kind: z.literal('LEADER_REQUEST') }),
]);

/** Guard against a person stacking duplicate pending requests for the same thing. */
async function assertNoDuplicate(type: string, requesterId: number, entityId: number | null) {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM tm_approval_requests
      WHERE type = ? AND status = 'PENDING' AND requester_id = ?
        AND ((entity_id IS NULL AND ? IS NULL) OR entity_id = ?)`,
    [type, requesterId, entityId, entityId],
  );
  if (existing) throw badRequest('You already have a pending request for this.');
}

/**
 * Raises the approval requests that are not a side effect of a task workflow:
 * a reassignment an assignee cannot make alone, and a promotion to Leader.
 */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.approval.request');
    const body = await parseBody(req, schema);

    if (body.kind === 'TASK_REASSIGNMENT') {
      const task = await queryOne<{
        id: number; title: string; assignee_id: number | null; created_by: number; team_id: number | null;
      }>(
        'SELECT id, title, assignee_id, created_by, team_id FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
        [body.task_id],
      );
      if (!task) throw notFound('That task no longer exists.');
      if (task.assignee_id !== user.id && task.created_by !== user.id) {
        throw forbidden('Only the assignee or the creator can request a reassignment.');
      }
      if (task.assignee_id === body.new_assignee_id) {
        throw badRequest('That person is already the assignee.');
      }

      const target = await queryOne<{ id: number; full_name: string }>(
        "SELECT id, full_name FROM tm_users WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL",
        [body.new_assignee_id],
      );
      if (!target) throw badRequest('Choose an active team member to hand this task to.');

      await assertNoDuplicate('TASK_REASSIGNMENT', user.id, task.id);

      const team = task.team_id
        ? await queryOne<{ leader_user_id: number | null }>('SELECT leader_user_id FROM tm_teams WHERE id = ?', [task.team_id])
        : null;
      const approver = team?.leader_user_id ?? task.created_by;

      const res = await execute(
        `INSERT INTO tm_approval_requests (type, requester_id, assigned_to, entity_type, entity_id, payload, reason, status)
         VALUES ('TASK_REASSIGNMENT', ?, ?, 'TASK', ?, CAST(? AS JSON), ?, 'PENDING')`,
        [
          user.id,
          approver,
          task.id,
          JSON.stringify({ new_assignee_id: target.id, new_assignee_name: target.full_name, current_assignee_id: task.assignee_id }),
          body.reason,
        ],
      );

      const payload = {
        type: 'TASK_REASSIGNMENT_REQUEST',
        title: `Reassignment requested: ${task.title}`,
        body: `${body.reason} (to ${target.full_name})`,
        link: '/tm/approvals',
        entityType: 'TASK' as const,
        entityId: task.id,
        actorId: user.id,
        priority: 'HIGH' as const,
      };
      if (approver) await notify({ userId: approver, ...payload });
      else await notifyMany(await managerIds(), payload);

      await audit(user.id, 'TASK_REASSIGNMENT_REQUESTED', 'TASK', task.id, task.assignee_id, target.id);
      return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
    }

    // LEADER_REQUEST
    if (user.role !== 'EMPLOYEE') throw badRequest('Only an Employee can request Leader access.');
    await assertNoDuplicate('LEADER_REQUEST', user.id, null);

    const teamId = body.team_id ?? user.team_id ?? null;
    const res = await execute(
      `INSERT INTO tm_approval_requests (type, requester_id, assigned_to, entity_type, entity_id, payload, reason, status)
       VALUES ('LEADER_REQUEST', ?, NULL, 'USER', ?, CAST(? AS JSON), ?, 'PENDING')`,
      [user.id, user.id, JSON.stringify({ team_id: teamId }), body.reason],
    );

    await notifyMany(await managerIds(), {
      type: 'LEADER_REQUEST',
      title: `Leader access requested by ${user.full_name}`,
      body: body.reason,
      link: '/tm/approvals',
      entityType: 'USER',
      entityId: user.id,
      actorId: user.id,
      priority: 'HIGH',
    });

    await audit(user.id, 'LEADER_REQUESTED', 'USER', user.id, user.role, 'LEADER');
    return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
