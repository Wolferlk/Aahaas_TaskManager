import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { audit, badRequest, forbidden, notFound, parseBody, requirePermission, toErrorResponse } from '@/lib/api';
import { approvalDecisionSchema } from '@/lib/validation';
import { logActivity, logStatusChange } from '@/lib/tasks';
import { notify } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Decides one approval request. Every branch is an explicit human action —
 * nothing in this module approves a user, a reward or a deadline on its own.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.approval.decide');
    const id = Number((await params).id);
    const body = await parseBody(req, approvalDecisionSchema);

    const request = await queryOne<{
      id: number;
      type: string;
      requester_id: number | null;
      entity_id: number | null;
      payload: unknown;
      status: string;
    }>('SELECT * FROM tm_approval_requests WHERE id = ?', [id]);
    if (!request) throw notFound('That request could not be found.');
    if (request.status !== 'PENDING') throw badRequest('This request has already been decided.');

    if (request.type === 'USER_SIGNUP' && user.role !== 'MANAGER') {
      throw forbidden('Only a Manager can approve signup requests.');
    }
    if (body.decision === 'REJECTED' && !body.comment?.trim() && request.type !== 'USER_SIGNUP') {
      throw badRequest('Add a comment explaining the rejection.');
    }

    const payload = (typeof request.payload === 'string' ? JSON.parse(request.payload) : request.payload) as Record<
      string,
      unknown
    > | null;

    switch (request.type) {
      case 'USER_SIGNUP': {
        const targetId = request.entity_id!;
        if (body.decision === 'APPROVED') {
          const role = body.overrides?.role ?? (payload?.requested_role as string) ?? 'EMPLOYEE';
          const fields: string[] = ["status = 'ACTIVE'", 'role = ?', 'approved_by = ?', 'approved_at = NOW()'];
          const values: unknown[] = [role, user.id];

          if (body.overrides?.department_id !== undefined) {
            fields.push('department_id = ?');
            values.push(body.overrides.department_id);
          }
          if (body.overrides?.team_id !== undefined) {
            fields.push('team_id = ?');
            values.push(body.overrides.team_id);
          }
          values.push(targetId);
          await execute(`UPDATE tm_users SET ${fields.join(', ')} WHERE id = ?`, values);

          const teamId = body.overrides?.team_id;
          if (teamId) {
            await execute(
              'INSERT INTO tm_team_members (team_id, user_id, role_in_team) VALUES (?,?,?)',
              [teamId, targetId, role === 'LEADER' ? 'LEADER' : 'MEMBER'],
            );
            if (role === 'LEADER') {
              await execute('UPDATE tm_teams SET leader_user_id = ? WHERE id = ? AND leader_user_id IS NULL', [
                targetId,
                teamId,
              ]);
            }
          }

          await notify({
            userId: targetId,
            type: 'ACCOUNT_APPROVED',
            title: 'Your account has been approved',
            body: `You now have ${role} access to the Task Management System.`,
            link: '/tm/dashboard',
            actorId: user.id,
            priority: 'HIGH',
          });
          await audit(user.id, 'USER_APPROVED', 'USER', targetId, 'PENDING_APPROVAL', { role });
        } else {
          await execute("UPDATE tm_users SET status = 'REJECTED', rejection_reason = ? WHERE id = ?", [
            body.comment ?? 'Signup request declined.',
            targetId,
          ]);
          await audit(user.id, 'USER_REJECTED', 'USER', targetId, 'PENDING_APPROVAL', body.comment);
        }
        break;
      }

      case 'DEADLINE_EXTENSION': {
        const taskId = request.entity_id!;
        if (body.decision === 'APPROVED') {
          const requested = payload?.requested_deadline as string;
          const task = await queryOne<{ deadline: string | null; original_deadline: string | null; title: string }>(
            'SELECT deadline, original_deadline, title FROM tm_tasks WHERE id = ?',
            [taskId],
          );
          // The first deadline is preserved so reliability metrics stay honest.
          await execute(
            `UPDATE tm_tasks
                SET deadline = ?,
                    original_deadline = COALESCE(original_deadline, ?)
              WHERE id = ?`,
            [new Date(requested), task?.deadline ?? null, taskId],
          );
          await logActivity(taskId, user.id, 'DEADLINE_EXTENDED', 'deadline', task?.deadline, requested);
          await notify({
            userId: request.requester_id!,
            type: 'EXTENSION_APPROVED',
            title: `Extension approved: ${task?.title ?? 'task'}`,
            link: `/tm/tasks?task=${taskId}`,
            entityType: 'TASK',
            entityId: taskId,
            actorId: user.id,
          });
        } else {
          await notify({
            userId: request.requester_id!,
            type: 'EXTENSION_REJECTED',
            title: 'Deadline extension declined',
            body: body.comment ?? undefined,
            link: `/tm/tasks?task=${taskId}`,
            entityType: 'TASK',
            entityId: taskId,
            actorId: user.id,
          });
        }
        break;
      }

      case 'TASK_COMPLETION': {
        const taskId = request.entity_id!;
        const to = body.decision === 'APPROVED' ? 'COMPLETED' : 'IN_PROGRESS';
        await execute(
          body.decision === 'APPROVED'
            ? "UPDATE tm_tasks SET status = 'COMPLETED', completed_at = NOW(), approved_at = NOW(), approved_by = ?, progress = 100 WHERE id = ?"
            : "UPDATE tm_tasks SET status = 'IN_PROGRESS' WHERE id = ?",
          body.decision === 'APPROVED' ? [user.id, taskId] : [taskId],
        );
        await logStatusChange(taskId, 'REVIEW', to as never, user.id, body.comment ?? null);
        await notify({
          userId: request.requester_id!,
          type: body.decision === 'APPROVED' ? 'TASK_APPROVED' : 'TASK_REJECTED',
          title: body.decision === 'APPROVED' ? 'Your task was approved' : 'Changes requested on your task',
          body: body.comment ?? undefined,
          link: `/tm/tasks?task=${taskId}`,
          entityType: 'TASK',
          entityId: taskId,
          actorId: user.id,
          priority: 'HIGH',
        });
        break;
      }

      case 'TASK_REASSIGNMENT': {
        const taskId = request.entity_id!;
        if (body.decision === 'APPROVED' && payload?.new_assignee_id) {
          await execute('UPDATE tm_tasks SET assignee_id = ? WHERE id = ?', [payload.new_assignee_id, taskId]);
          await logActivity(taskId, user.id, 'ASSIGNEE_CHANGED', 'assignee_id', null, payload.new_assignee_id);
        }
        break;
      }

      default:
        break;
    }

    await execute(
      "UPDATE tm_approval_requests SET status = ?, decided_by = ?, decided_at = NOW(), decision_comment = ? WHERE id = ?",
      [body.decision, user.id, body.comment ?? null, id],
    );
    await audit(user.id, `APPROVAL_${body.decision}`, 'APPROVAL', id, request.status, body);

    return NextResponse.json({ ok: true, status: body.decision });
  } catch (err) {
    return toErrorResponse(err);
  }
}
