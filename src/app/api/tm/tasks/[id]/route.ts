import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, forbidden, notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { taskUpdateSchema } from '@/lib/validation';
import {
  canEditTask,
  canUpdateOwnProgress,
  logActivity,
  logStatusChange,
  refreshParentProgress,
  taskMemberScopeCheck,
  taskScope,
} from '@/lib/tasks';
import { notify } from '@/lib/notifications';
import type { TaskStatus } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/** Fields an assignee may change on their own task without edit rights. */
const ASSIGNEE_FIELDS = new Set(['status', 'progress', 'actual_hours', 'blocked_reason', 'completion_notes', 'reason']);

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);
    const scope = await taskScope(user, 't');

    const task = await queryOne<Record<string, unknown> & { created_by: number; assignee_id: number | null; team_id: number | null }>(
      `SELECT t.*,
              a.full_name AS assignee_name, a.avatar_url AS assignee_avatar, a.email AS assignee_email,
              c.full_name AS creator_name, c.avatar_url AS creator_avatar,
              p.name AS project_name, p.code AS project_code, p.color AS project_color,
              tm.name AS team_name, tm.leader_user_id,
              l.full_name AS leader_name,
              d.name AS department_name, cat.name AS category_name,
              parent.task_number AS parent_number, parent.title AS parent_title,
              ap.full_name AS approver_name
         FROM tm_tasks t
         LEFT JOIN tm_users a ON a.id = t.assignee_id
         LEFT JOIN tm_users c ON c.id = t.created_by
         LEFT JOIN tm_projects p ON p.id = t.project_id
         LEFT JOIN tm_teams tm ON tm.id = t.team_id
         LEFT JOIN tm_users l ON l.id = tm.leader_user_id
         LEFT JOIN tm_departments d ON d.id = t.department_id
         LEFT JOIN tm_task_categories cat ON cat.id = t.category_id
         LEFT JOIN tm_tasks parent ON parent.id = t.parent_task_id
         LEFT JOIN tm_users ap ON ap.id = t.approved_by
        WHERE t.id = ? AND t.deleted_at IS NULL AND ${scope.sql}`,
      [id, ...scope.params],
    );
    if (!task) throw notFound('That task does not exist, or you do not have access to it.');

    const [subtasks, checklist, comments, activity, history, dependencies, attachments, tags] = await Promise.all([
      query(
        `SELECT s.id, s.task_number, s.title, s.status, s.priority, s.progress, s.deadline, s.assignee_id,
                u.full_name AS assignee_name, u.avatar_url AS assignee_avatar
           FROM tm_tasks s LEFT JOIN tm_users u ON u.id = s.assignee_id
          WHERE s.parent_task_id = ? AND s.deleted_at IS NULL ORDER BY s.created_at`,
        [id],
      ),
      query('SELECT * FROM tm_task_checklists WHERE task_id = ? ORDER BY position, id', [id]),
      query(
        `SELECT c.id, c.body, c.is_system, c.is_ai, c.parent_id, c.created_at, c.edited_at,
                c.user_id, u.full_name, u.avatar_url
           FROM tm_task_comments c LEFT JOIN tm_users u ON u.id = c.user_id
          WHERE c.task_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at`,
        [id],
      ),
      query(
        `SELECT a.id, a.action, a.field, a.old_value, a.new_value, a.created_at,
                u.full_name, u.avatar_url
           FROM tm_task_activity_logs a LEFT JOIN tm_users u ON u.id = a.user_id
          WHERE a.task_id = ? ORDER BY a.created_at DESC LIMIT 100`,
        [id],
      ),
      query(
        `SELECT h.*, u.full_name AS changed_by_name
           FROM tm_task_status_history h LEFT JOIN tm_users u ON u.id = h.changed_by
          WHERE h.task_id = ? ORDER BY h.created_at DESC`,
        [id],
      ),
      query(
        `SELECT dep.id, dep.type, dep.depends_on_task_id,
                o.task_number, o.title, o.status, o.priority, o.deadline
           FROM tm_task_dependencies dep JOIN tm_tasks o ON o.id = dep.depends_on_task_id
          WHERE dep.task_id = ? AND o.deleted_at IS NULL`,
        [id],
      ),
      query('SELECT * FROM tm_task_attachments WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at DESC', [id]),
      query('SELECT tg.id, tg.name, tg.color FROM tm_task_tag_map m JOIN tm_task_tags tg ON tg.id = m.tag_id WHERE m.task_id = ?', [id]),
    ]);

    const blockers = dependencies.filter(
      (d) => (d as { type: string; status: string }).type === 'BLOCKED_BY' && (d as { status: string }).status !== 'COMPLETED',
    );

    return NextResponse.json({
      task,
      subtasks,
      checklist,
      comments,
      activity,
      status_history: history,
      dependencies,
      attachments,
      tags,
      warnings: blockers.length
        ? [`This task is blocked by ${blockers.length} unfinished task${blockers.length > 1 ? 's' : ''}.`]
        : [],
      can_edit: await canEditTask(user, task),
      can_approve:
        (user.role === 'MANAGER' || user.role === 'LEADER') && task.status === 'REVIEW' && task.assignee_id !== user.id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);
    const body = await parseBody(req, taskUpdateSchema);

    const before = await queryOne<Record<string, unknown> & {
      created_by: number;
      assignee_id: number | null;
      team_id: number | null;
      status: TaskStatus;
      title: string;
      deadline: string | null;
      approval_required: number;
      parent_task_id: number | null;
    }>('SELECT * FROM tm_tasks WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!before) throw notFound('That task does not exist.');

    const fullEdit = await canEditTask(user, before);
    const ownProgress = canUpdateOwnProgress(user, before);
    if (!fullEdit && !ownProgress) throw forbidden('You cannot edit this task.');

    const { reason, tags, ...changes } = body;

    if (!fullEdit) {
      for (const key of Object.keys(changes)) {
        if (!ASSIGNEE_FIELDS.has(key)) {
          throw forbidden('You can update progress and status on this task, but not its details.');
        }
      }
    }

    if (changes.assignee_id !== undefined && changes.assignee_id !== before.assignee_id) {
      if (changes.assignee_id && !(await taskMemberScopeCheck(user, changes.assignee_id))) {
        throw forbidden('You can only assign tasks to people in the teams you lead.');
      }
    }

    // A task requiring approval cannot be self-marked complete — it goes to review.
    let nextStatus = changes.status;
    if (
      nextStatus === 'COMPLETED' &&
      before.approval_required &&
      user.role === 'EMPLOYEE' &&
      before.assignee_id === user.id
    ) {
      nextStatus = 'REVIEW';
      changes.status = 'REVIEW';
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      fields.push(`\`${col}\` = ?`);
      values.push(val);
    };

    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined) continue;
      if (k === 'deadline' || k === 'start_date') push(k, v ? new Date(v as string) : null);
      else push(k, v);
    }

    if (nextStatus === 'COMPLETED') {
      push('completed_at', new Date());
      push('progress', 100);
    }
    if (nextStatus === 'REVIEW') push('submitted_at', new Date());
    if (nextStatus === 'CANCELLED') push('cancelled_at', new Date());
    if (nextStatus && nextStatus !== 'COMPLETED' && before.status === 'COMPLETED') {
      push('completed_at', null);
      push('approved_at', null);
      push('approved_by', null);
    }

    if (fields.length) {
      values.push(id);
      await execute(`UPDATE tm_tasks SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (tags) {
      await execute('DELETE FROM tm_task_tag_map WHERE task_id = ?', [id]);
      for (const name of tags) {
        await execute('INSERT INTO tm_task_tags (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name', [name]);
        await execute(
          'INSERT IGNORE INTO tm_task_tag_map (task_id, tag_id) SELECT ?, id FROM tm_task_tags WHERE name = ?',
          [id, name],
        );
      }
    }

    // --- History and notifications -----------------------------------------
    const notable: Array<[string, string]> = [
      ['assignee_id', 'ASSIGNEE_CHANGED'],
      ['deadline', 'DEADLINE_CHANGED'],
      ['priority', 'PRIORITY_CHANGED'],
      ['progress', 'PROGRESS_CHANGED'],
      ['project_id', 'PROJECT_CHANGED'],
      ['title', 'TITLE_CHANGED'],
    ];
    for (const [field, action] of notable) {
      const next = (changes as Record<string, unknown>)[field];
      if (next === undefined) continue;
      const prev = (before as Record<string, unknown>)[field];
      if (String(next ?? '') === String(prev ?? '')) continue;
      await logActivity(id, user.id, action, field, prev, next);
    }

    if (nextStatus && nextStatus !== before.status) {
      await logStatusChange(id, before.status, nextStatus, user.id, reason ?? null);
      await logActivity(id, user.id, 'STATUS_CHANGED', 'status', before.status, nextStatus);

      if (nextStatus === 'REVIEW') {
        const reviewer = await queryOne<{ leader_user_id: number | null }>(
          'SELECT leader_user_id FROM tm_teams WHERE id = ?',
          [before.team_id],
        );
        await notify({
          userId: reviewer?.leader_user_id ?? before.created_by,
          type: 'TASK_REVIEW_REQUESTED',
          title: `Review requested: ${before.title}`,
          body: `${user.full_name} submitted this task for review.`,
          link: `/tm/tasks?task=${id}`,
          entityType: 'TASK',
          entityId: id,
          actorId: user.id,
          priority: 'HIGH',
        });
      }
      if (nextStatus === 'COMPLETED' && before.created_by !== user.id) {
        await notify({
          userId: before.created_by,
          type: 'TASK_COMPLETED',
          title: `Completed: ${before.title}`,
          link: `/tm/tasks?task=${id}`,
          entityType: 'TASK',
          entityId: id,
          actorId: user.id,
        });
      }
    }

    if (changes.assignee_id && changes.assignee_id !== before.assignee_id) {
      await notify({
        userId: changes.assignee_id,
        type: 'TASK_ASSIGNED',
        title: `Assigned to you: ${before.title}`,
        body: `${user.full_name} assigned you this task.`,
        link: `/tm/tasks?task=${id}`,
        entityType: 'TASK',
        entityId: id,
        actorId: user.id,
        priority: 'HIGH',
      });
    }

    if (before.parent_task_id) await refreshParentProgress(before.parent_task_id);

    await audit(user.id, 'TASK_UPDATED', 'TASK', id, before.status, changes);
    return NextResponse.json({ ok: true, status: nextStatus ?? before.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Soft delete. A Manager can restore the row; nothing is removed from the table. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);

    const task = await queryOne<{ created_by: number; assignee_id: number | null; team_id: number | null; title: string }>(
      'SELECT created_by, assignee_id, team_id, title FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!task) throw notFound('That task does not exist.');
    if (user.role !== 'MANAGER' && task.created_by !== user.id) {
      throw forbidden('Only the creator or a Manager can delete this task.');
    }

    await execute('UPDATE tm_tasks SET deleted_at = NOW() WHERE id = ?', [id]);
    await logActivity(id, user.id, 'DELETED', null, task.title, null);
    await audit(user.id, 'TASK_DELETED', 'TASK', id, task, null);

    return NextResponse.json({ ok: true, restorable: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
