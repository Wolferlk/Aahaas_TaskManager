import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { sha256 } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { forgotSchema } from '@/lib/validation';

/**
 * Issues a reset token. Outbound email is disabled in this module until a
 * Manager turns it on, so the token is returned to the caller only outside
 * production — where a Manager hands it over through an existing channel.
 */
export async function POST(req: Request) {
  try {
    const { email } = await parseBody(req, forgotSchema);
    const user = await queryOne<{ id: number; status: string }>(
      'SELECT id, status FROM tm_users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );

    const generic = {
      ok: true,
      message: 'If that email is registered, a reset link has been prepared. Contact your Manager if you do not receive it.',
    };

    if (!user || user.status !== 'ACTIVE') return NextResponse.json(generic);

    const raw = crypto.randomBytes(32).toString('base64url');
    await execute(
      'INSERT INTO tm_password_resets (user_id, token_hash, expires_at) VALUES (?,?, NOW() + INTERVAL 60 MINUTE)',
      [user.id, sha256(raw)],
    );
    await audit(user.id, 'PASSWORD_RESET_REQUESTED', 'USER', user.id);

    return NextResponse.json({
      ...generic,
      ...(process.env.NODE_ENV !== 'production' ? { dev_token: raw } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
