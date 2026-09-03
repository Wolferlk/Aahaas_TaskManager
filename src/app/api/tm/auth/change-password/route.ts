import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { audit, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validation';

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, changePasswordSchema);

    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM tm_users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(body.current_password, row.password_hash))) {
      return NextResponse.json({ error: 'Your current password is incorrect.' }, { status: 400 });
    }

    await execute('UPDATE tm_users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
      await hashPassword(body.password),
      user.id,
    ]);
    await audit(user.id, 'PASSWORD_CHANGED', 'USER', user.id);

    return NextResponse.json({ ok: true, message: 'Password updated.' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
