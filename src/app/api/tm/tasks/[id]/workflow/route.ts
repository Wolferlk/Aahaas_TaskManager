import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, queryOne } from '@/lib/db';
import { audit, badRequest, forbidden, notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { logActivity, logStatusChange, refreshParentProgress, canEditTask } from '@/lib/tasks';
import { notify } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(['submit', 'approve', 'reject', 'request_changes', 'reopen', 'cancel', 'escalate']),
  comment: z.string().max(2000).nullable().optional(),
});

/**
 * Completion approval flow.
 * Approve and reject are Leader/Manager only, and a rejection must carry a comment.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);
    const body = await parseBody(req, schema);

    const task = await queryOne<{
      id: number;
      title: string;
      status: string;
      assignee_id: number | null;
      created_by: number;
      team_id: number | null;
      parent_task_id: number | null;
    }>(
      'SELECT id, title, status, assignee_id, created_by, team_id, parent_task_id FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!task) throw notFound('That task does not exist.');

    const isReviewer = user.role === 'MANAGER' || user.role === 'LEADER';
    const isOwner = task.assignee_id === user.id || task.created_by === user.id;

    let to: string;
    let notifyUser: number | null = null;
    let notifyType = '';
    let notifyTitle = '';

    switch (body.action) {
      case 'submit': {
        if (!isOwner && !(await canEditTask(user, task))) throw forbidden('Only the assignee can submit this task.');
        to = 'REVIEW';
        const team = await queryOne<{ leader_user_id: number | null }>(
          'SELECT leader_user_id FROM tm_teams WHERE id = ?',
          [task.team_id],
        );
        notifyUser = team?.leader_user_id ?? task.created_by;
        notifyType = 'TASK_REVIEW_REQUESTED';
        notifyTitle = `Review requested: ${task.title}`;
        break;
      }
      case 'approve': {
        if (!isReviewer) throw forbidden('Only a Leader or Manager can approve completed work.');
        if (task.assignee_id === user.id && user.role !== 'MANAGER') {
          throw forbidden('You cannot approve your own task.');
        }
        to = 'COMPLETED';
        notifyUser = task.assignee_id;
        notifyType = 'TASK_APPROVED';
        notifyTitle = `Approved: ${task.title}`;
        break;
      }
      case 'reject':
      case 'request_changes': {
        if (!isReviewer) throw forbidden('Only a Leader or Manager can reject or return work.');
        if (!body.comment?.trim()) throw badRequest('Add a comment explaining what needs to change.');
        to = 'IN_PROGRESS';
        notifyUser = task.assignee_id;
        notifyType = 'TASK_REJECTED';
        notifyTitle = `Changes requested: ${task.title}`;
        break;
      }
      case 'reopen': {
        if (!isReviewer && task.created_by !== user.id) throw forbidden('You cannot reopen this task.');
        to = 'IN_PROGRESS';
        notifyUser = task.assignee_id;
        notifyType = 'TASK_REOPENED';
        notifyTitle = `Reopened: ${task.title}`;
        break;
      }
      case 'cancel': {
        if (user.role !== 'MANAGER' && task.created_by !== user.id) throw forbidden('You cannot cancel this task.');
        to = 'CANCELLED';
        notifyUser = task.assignee_id;
        notifyType = 'TASK_CANCELLED';
        notifyTitle = `Cancelled: ${task.title}`;
        break;
      }
      case 'escalate': {
        const managers = await queryOne<{ id: number }>(
          "SELECT id FROM tm_users WHERE role = 'MANAGER' AND status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1",
        );
        await logActivity(id, user.id, 'ESCALATED', null, null, body.comment ?? null);
        if (managers) {
          await notify({
            userId: managers.id,
            type: 'TASK_ESCALATED',
            title: `Escalated: ${task.title}`,
            body: body.comment ?? undefined,
            link: `/tm/tasks?task=${id}`,
            entityType: 'TASK',
            entityId: id,
            actorId: user.id,
            priority: 'HIGH',
          });
        }
        await audit(user.id, 'TASK_ESCALATED', 'TASK', id, null, body.comment);
        return NextResponse.json({ ok: true, status: task.status });
      }
    }

    const sets = ["status = ?"];
    const values: unknown[] = [to];
    if (to === 'COMPLETED') {
      sets.push('completed_at = NOW()', 'approved_at = NOW()', 'approved_by = ?', 'progress = 100');
      values.push(user.id);
    }
    if (to === 'REVIEW') sets.push('submitted_at = NOW()');
    if (to === 'CANCELLED') sets.push('cancelled_at = NOW()');
    if (to === 'IN_PROGRESS' && task.status === 'COMPLETED') {
      sets.push('completed_at = NULL', 'approved_at = NULL', 'approved_by = NULL');
    }
    values.push(id);
    await execute(`UPDATE tm_tasks SET ${sets.join(', ')} WHERE id = ?`, values);

    await logStatusChange(id, task.status as never, to as never, user.id, body.comment ?? null);
    await logActivity(
      id,
      user.id,
      body.action === 'reopen' ? 'REOPENED' : body.action.toUpperCase(),
      'status',
      task.status,
      to,
    );

    if (body.comment?.trim()) {
      await execute('INSERT INTO tm_task_comments (task_id, user_id, body, is_system) VALUES (?,?,?,1)', [
        id,
        user.id,
        `${body.action === 'approve' ? 'Approved' : body.action === 'reopen' ? 'Reopened' : 'Returned'}: ${body.comment.trim()}`,
      ]);
    }

    if (notifyUser && notifyUser !== user.id) {
      await notify({
        userId: notifyUser,
        type: notifyType,
        title: notifyTitle,
        body: body.comment ?? undefined,
        link: `/tm/tasks?task=${id}`,
        entityType: 'TASK',
        entityId: id,
        actorId: user.id,
        priority: 'HIGH',
      });
    }

    if (task.parent_task_id) await refreshParentProgress(task.parent_task_id);
    await audit(user.id, `TASK_${body.action.toUpperCase()}`, 'TASK', id, task.status, to);

    return NextResponse.json({ ok: true, status: to });
  } catch (err) {
    return toErrorResponse(err);
  }
}
