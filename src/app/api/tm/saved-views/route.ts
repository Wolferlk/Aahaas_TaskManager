import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { parseBody, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { savedViewSchema } from '@/lib/validation';

export async function GET() {
  try {
    const user = await requireUser();
    const views = await query(
      `SELECT v.*, u.full_name AS owner_name FROM tm_saved_views v
         JOIN tm_users u ON u.id = v.user_id
        WHERE v.user_id = ? OR v.is_shared = 1
        ORDER BY v.user_id = ? DESC, v.name`,
      [user.id, user.id],
    );
    const favorites = await query('SELECT * FROM tm_favorites WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    return NextResponse.json({ views, favorites });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, savedViewSchema);
    const res = await execute(
      'INSERT INTO tm_saved_views (user_id, name, route, filters, columns, is_shared) VALUES (?,?,?,CAST(? AS JSON),CAST(? AS JSON),?)',
      [
        user.id,
        body.name,
        body.route,
        JSON.stringify(body.filters),
        JSON.stringify(body.columns ?? null),
        body.is_shared ? 1 : 0,
      ],
    );
    return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser();
    const id = Number(searchParams(req).get('id'));
    if (!id) return NextResponse.json({ error: 'Missing view.' }, { status: 400 });
    await execute('DELETE FROM tm_saved_views WHERE id = ? AND user_id = ?', [id, user.id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
