import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { hashPassword, sha256 } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { resetSchema } from '@/lib/validation';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, resetSchema);

    const row = await queryOne<{ id: number; user_id: number }>(
      `SELECT id, user_id FROM tm_password_resets
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [sha256(body.token)],
    );
    if (!row) {
      return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }

    await execute('UPDATE tm_users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
      await hashPassword(body.password),
      row.user_id,
    ]);
    await execute('UPDATE tm_password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
    // Every existing session is invalidated after a password reset.
    await execute('UPDATE tm_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [
      row.user_id,
    ]);
    await audit(row.user_id, 'PASSWORD_RESET_COMPLETED', 'USER', row.user_id);

    return NextResponse.json({ ok: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    return toErrorResponse(err);
  }
}
