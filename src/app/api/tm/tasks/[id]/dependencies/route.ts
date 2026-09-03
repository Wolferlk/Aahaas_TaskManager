import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query, queryOne } from '@/lib/db';
import { badRequest, notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { canEditTask, logActivity } from '@/lib/tasks';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(['add', 'remove']),
  depends_on_task_id: z.coerce.number().int().positive().optional(),
  dependency_id: z.coerce.number().int().positive().optional(),
  type: z.enum(['BLOCKS', 'BLOCKED_BY', 'RELATED_TO']).default('BLOCKED_BY'),
});

/**
 * Breadth-first walk of the BLOCKED_BY graph starting at `targetId`.
 * If `taskId` is reachable, adding the edge would close a cycle.
 */
async function wouldCycle(taskId: number, targetId: number): Promise<boolean> {
  const seen = new Set<number>([targetId]);
  let frontier = [targetId];

  for (let depth = 0; depth < 20 && frontier.length; depth++) {
    if (frontier.includes(taskId)) return true;

    const rows = await query<{ depends_on_task_id: number }>(
      "SELECT depends_on_task_id FROM tm_task_dependencies WHERE type = 'BLOCKED_BY' AND task_id IN (?)",
      [frontier],
    );

    frontier = rows.map((r) => r.depends_on_task_id).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
  }
  return seen.has(taskId);
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);
    const body = await parseBody(req, schema);

    const task = await queryOne<{ created_by: number; assignee_id: number | null; team_id: number | null; title: string }>(
      'SELECT created_by, assignee_id, team_id, title FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!task) throw notFound('That task does not exist.');
    if (!(await canEditTask(user, task))) {
      return NextResponse.json({ error: 'You cannot change dependencies on this task.' }, { status: 403 });
    }

    if (body.action === 'remove') {
      if (!body.dependency_id) throw badRequest('Missing dependency.');
      await execute('DELETE FROM tm_task_dependencies WHERE id = ? AND task_id = ?', [body.dependency_id, id]);
      return NextResponse.json({ ok: true });
    }

    if (!body.depends_on_task_id) throw badRequest('Pick a task to link.');
    if (body.depends_on_task_id === id) throw badRequest('A task cannot depend on itself.');

    const other = await queryOne<{ id: number; title: string }>(
      'SELECT id, title FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
      [body.depends_on_task_id],
    );
    if (!other) throw badRequest('The linked task no longer exists.');

    if (body.type === 'BLOCKED_BY' && (await wouldCycle(id, body.depends_on_task_id))) {
      throw badRequest('That link would create a circular dependency.');
    }

    await execute(
      'INSERT IGNORE INTO tm_task_dependencies (task_id, depends_on_task_id, type, created_by) VALUES (?,?,?,?)',
      [id, body.depends_on_task_id, body.type, user.id],
    );
    // The inverse edge keeps both task drawers accurate.
    if (body.type !== 'RELATED_TO') {
      const inverse = body.type === 'BLOCKED_BY' ? 'BLOCKS' : 'BLOCKED_BY';
      await execute(
        'INSERT IGNORE INTO tm_task_dependencies (task_id, depends_on_task_id, type, created_by) VALUES (?,?,?,?)',
        [body.depends_on_task_id, id, inverse, user.id],
      );
    }

    await logActivity(id, user.id, 'DEPENDENCY_ADDED', body.type, null, other.title);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
