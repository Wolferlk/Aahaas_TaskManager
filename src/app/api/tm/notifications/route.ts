import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { intParam, requireUser, searchParams, toErrorResponse } from '@/lib/api';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const where = ['n.user_id = ?'];
    const params: unknown[] = [user.id];
    const filter = sp.get('filter');
    if (filter === 'unread') where.push('n.read_at IS NULL');
    if (filter === 'read') where.push('n.read_at IS NOT NULL');

    const limit = intParam(sp, 'limit', 40, 200);

    const [rows, unread] = await Promise.all([
      query(
        `SELECT n.*, a.full_name AS actor_name, a.avatar_url AS actor_avatar
           FROM tm_notifications n
           LEFT JOIN tm_users a ON a.id = n.actor_id
          WHERE ${where.join(' AND ')}
          ORDER BY n.created_at DESC LIMIT ?`,
        [...params, limit],
      ),
      queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM tm_notifications WHERE user_id = ? AND read_at IS NULL', [
        user.id,
      ]),
    ]);

    return NextResponse.json({ notifications: rows, unread: Number(unread?.c ?? 0) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as { action?: string; ids?: number[] };

    if (body.action === 'read_all') {
      await execute('UPDATE tm_notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [user.id]);
    } else if (body.ids?.length) {
      await execute('UPDATE tm_notifications SET read_at = NOW() WHERE user_id = ? AND id IN (?) AND read_at IS NULL', [
        user.id,
        body.ids,
      ]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
