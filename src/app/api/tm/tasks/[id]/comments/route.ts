import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { commentSchema } from '@/lib/validation';
import { logActivity, taskScope } from '@/lib/tasks';
import { notify } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

/** Resolves `@name` mentions against active users. */
async function resolveMentions(body: string): Promise<number[]> {
  const handles = [...body.matchAll(/@([\w.\-]{2,60})/g)].map((m) => m[1].toLowerCase());
  if (!handles.length) return [];

  const users = await query<{ id: number; full_name: string; email: string }>(
    "SELECT id, full_name, email FROM tm_users WHERE status = 'ACTIVE' AND deleted_at IS NULL",
  );
  const matched = new Set<number>();
  for (const handle of handles) {
    for (const u of users) {
      const first = u.full_name.split(/\s+/)[0].toLowerCase();
      const compact = u.full_name.replace(/\s+/g, '').toLowerCase();
      const local = u.email.split('@')[0].toLowerCase();
      if (handle === first || handle === compact || handle === local) matched.add(u.id);
    }
  }
  return [...matched];
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const id = Number((await params).id);
    const body = await parseBody(req, commentSchema);

    const scope = await taskScope(user, 't');
    const task = await queryOne<{ id: number; title: string; assignee_id: number | null; created_by: number }>(
      `SELECT t.id, t.title, t.assignee_id, t.created_by FROM tm_tasks t
        WHERE t.id = ? AND t.deleted_at IS NULL AND ${scope.sql}`,
      [id, ...scope.params],
    );
    if (!task) throw notFound('That task does not exist, or you do not have access to it.');

    const res = await execute(
      'INSERT INTO tm_task_comments (task_id, user_id, parent_id, body) VALUES (?,?,?,?)',
      [id, user.id, body.parent_id ?? null, body.body],
    );
    const commentId = res.insertId;

    const mentioned = await resolveMentions(body.body);
    for (const uid of mentioned) {
      await execute('INSERT IGNORE INTO tm_task_comment_mentions (comment_id, user_id) VALUES (?,?)', [commentId, uid]);
      if (uid !== user.id) {
        await notify({
          userId: uid,
          type: 'COMMENT_MENTION',
          title: `${user.full_name} mentioned you`,
          body: body.body.slice(0, 200),
          link: `/tm/tasks?task=${id}`,
          entityType: 'TASK',
          entityId: id,
          actorId: user.id,
          priority: 'HIGH',
        });
      }
    }

    // The assignee and creator hear about the conversation even without a mention.
    for (const uid of [task.assignee_id, task.created_by]) {
      if (uid && uid !== user.id && !mentioned.includes(uid)) {
        await notify({
          userId: uid,
          type: 'TASK_COMMENT',
          title: `New comment on ${task.title}`,
          body: body.body.slice(0, 200),
          link: `/tm/tasks?task=${id}`,
          entityType: 'TASK',
          entityId: id,
          actorId: user.id,
        });
      }
    }

    await logActivity(id, user.id, 'COMMENT_ADDED', null, null, body.body.slice(0, 200));

    const created = await queryOne(
      `SELECT c.id, c.body, c.is_system, c.is_ai, c.parent_id, c.created_at, c.edited_at,
              c.user_id, u.full_name, u.avatar_url
         FROM tm_task_comments c LEFT JOIN tm_users u ON u.id = c.user_id WHERE c.id = ?`,
      [commentId],
    );

    return NextResponse.json({ ok: true, comment: created, mentioned: mentioned.length }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Editing or removing your own comment. Deletion is soft and audited. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const taskId = Number((await params).id);
    const payload = (await req.json()) as { comment_id?: number; body?: string; action?: 'edit' | 'delete' };
    const commentId = Number(payload.comment_id);
    if (!commentId) throw notFound('Comment not found.');

    const comment = await queryOne<{ user_id: number; body: string }>(
      'SELECT user_id, body FROM tm_task_comments WHERE id = ? AND task_id = ? AND deleted_at IS NULL',
      [commentId, taskId],
    );
    if (!comment) throw notFound('Comment not found.');

    const isOwner = comment.user_id === user.id;
    if (!isOwner && user.role !== 'MANAGER') {
      return NextResponse.json({ error: 'You can only change your own comments.' }, { status: 403 });
    }

    if (payload.action === 'delete') {
      await execute('UPDATE tm_task_comments SET deleted_at = NOW(), deleted_by = ? WHERE id = ?', [user.id, commentId]);
      await audit(user.id, 'COMMENT_DELETED', 'TASK_COMMENT', commentId, comment.body, null);
    } else {
      const text = String(payload.body ?? '').trim();
      if (!text) return NextResponse.json({ error: 'Write something first.' }, { status: 400 });
      await execute('UPDATE tm_task_comments SET body = ?, edited_at = NOW() WHERE id = ?', [text.slice(0, 10000), commentId]);
      await audit(user.id, 'COMMENT_EDITED', 'TASK_COMMENT', commentId, comment.body, text);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
