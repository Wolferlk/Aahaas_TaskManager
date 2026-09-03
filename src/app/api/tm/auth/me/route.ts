import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { permissionsFor } from '@/lib/rbac';
import { queryOne } from '@/lib/db';
import { toErrorResponse } from '@/lib/api';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ user: null }, { status: 200 });

    const counts = await queryOne<{ unread: number }>(
      'SELECT COUNT(*) AS unread FROM tm_notifications WHERE user_id = ? AND read_at IS NULL',
      [user.id],
    );

    return NextResponse.json({
      user,
      permissions: permissionsFor(user.role),
      unread_notifications: Number(counts?.unread ?? 0),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
