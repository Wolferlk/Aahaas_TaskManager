import { NextResponse } from 'next/server';
import { destroySession, getSessionUser } from '@/lib/auth';
import { audit, toErrorResponse } from '@/lib/api';

export async function POST() {
  try {
    const user = await getSessionUser();
    await destroySession();
    if (user) await audit(user.id, 'USER_LOGOUT', 'USER', user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
