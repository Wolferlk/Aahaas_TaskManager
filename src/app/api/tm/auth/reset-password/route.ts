import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { hashPassword, sha256 } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { resetSchema } from '@/lib/validation';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, resetSchema);

    const row = await queryOne<{ id: number; user_id: number; status: string }>(
      `SELECT r.id, r.user_id, u.status
         FROM tm_password_resets r
         JOIN tm_users u ON u.id = r.user_id AND u.deleted_at IS NULL
        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW() LIMIT 1`,
      [sha256(body.token)],
    );
    if (!row) {
      return NextResponse.json(
        { error: 'This reset token is invalid or has expired. Enter the emergency code again.' },
        { status: 400 },
      );
    }

    // An account that a Manager has not approved (or has since disabled) has no
    // password to change yet. The token is burned so it cannot be retried.
    if (row.status !== 'ACTIVE') {
      await execute('UPDATE tm_password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
      await audit(row.user_id, 'PASSWORD_RESET_BLOCKED', 'USER', row.user_id, row.status, null);
      return NextResponse.json(
        {
          error:
            row.status === 'PENDING_APPROVAL'
              ? 'Your account is still waiting for Manager approval, so its password cannot be changed yet.'
              : 'This account is not active. Please contact your Manager.',
        },
        { status: 403 },
      );
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
