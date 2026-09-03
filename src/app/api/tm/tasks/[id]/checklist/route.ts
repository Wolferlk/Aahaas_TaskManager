import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, queryOne } from '@/lib/db';
import { notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { logActivity, taskScope } from '@/lib/tasks';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(['add', 'toggle', 'remove', 'rename']),
  item_id: z.coerce.number().int().positive().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  is_done: z.boolean().optional(),
});

/** Recomputes task progress from checklist completion when no subtasks exist. */
async function syncProgress(taskId: number) {
  const counts = await queryOne<{ total: number; done: number; subtasks: number }>(
    `SELECT
       (SELECT COUNT(*) FROM tm_task_checklists WHERE task_id = ?) AS total,
       (SELECT COUNT(*) FROM tm_task_checklists WHERE task_id = ? AND is_done = 1) AS done,
       (SELECT COUNT(*) FROM tm_tasks WHERE parent_task_id = ? AND deleted_at IS NULL) AS subtasks`,
    [taskId, taskId, taskId],
  );
  if (!counts || !Number(counts.total) || Number(counts.subtasks) > 0) return;
  const progress = Math.round((Number(counts.done) / Number(counts.total)) * 100);
  await execute("UPDATE tm_tasks SET progress = ? WHERE id = ? AND status <> 'COMPLETED'", [progress, taskId]);
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const taskId = Number((await params).id);
    const body = await parseBody(req, schema);

    const scope = await taskScope(user, 't');
    const task = await queryOne<{ id: number }>(
      `SELECT t.id FROM tm_tasks t WHERE t.id = ? AND t.deleted_at IS NULL AND ${scope.sql}`,
      [taskId, ...scope.params],
    );
    if (!task) throw notFound('That task does not exist, or you do not have access to it.');

    switch (body.action) {
      case 'add': {
        if (!body.title) return NextResponse.json({ error: 'Enter a checklist item.' }, { status: 400 });
        const pos = await queryOne<{ n: number }>(
          'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tm_task_checklists WHERE task_id = ?',
          [taskId],
        );
        await execute('INSERT INTO tm_task_checklists (task_id, title, position) VALUES (?,?,?)', [
          taskId,
          body.title,
          Number(pos?.n ?? 0),
        ]);
        break;
      }
      case 'toggle': {
        if (!body.item_id) return NextResponse.json({ error: 'Missing checklist item.' }, { status: 400 });
        const done = body.is_done ?? true;
        await execute(
          'UPDATE tm_task_checklists SET is_done = ?, done_by = ?, done_at = ? WHERE id = ? AND task_id = ?',
          [done ? 1 : 0, done ? user.id : null, done ? new Date() : null, body.item_id, taskId],
        );
        if (done) await logActivity(taskId, user.id, 'CHECKLIST_COMPLETED', null, null, String(body.item_id));
        break;
      }
      case 'rename': {
        if (!body.item_id || !body.title) return NextResponse.json({ error: 'Nothing to rename.' }, { status: 400 });
        await execute('UPDATE tm_task_checklists SET title = ? WHERE id = ? AND task_id = ?', [
          body.title,
          body.item_id,
          taskId,
        ]);
        break;
      }
      case 'remove': {
        if (!body.item_id) return NextResponse.json({ error: 'Missing checklist item.' }, { status: 400 });
        await execute('DELETE FROM tm_task_checklists WHERE id = ? AND task_id = ?', [body.item_id, taskId]);
        break;
      }
    }

    await syncProgress(taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
