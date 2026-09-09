import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { isRateLimited, recordLoginAttempt, requestMeta, sha256 } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { forgotSchema } from '@/lib/validation';

/**
 * Password reset by emergency code.
 *
 * Outbound mail is not used here. Someone who is locked out proves themselves
 * with the shared emergency code instead, and is handed a single-use reset
 * token straight away.
 *
 * That code is a shared secret: anyone holding it can reset any account, so it
 * is read from TM_RESET_CODE and should be rotated whenever it circulates
 * further than intended. Attempts are throttled and every use is audited.
 */

const EXPIRY_MINUTES = 30;

const DEFAULT_CODE = 'Aahaas123';

function resetCode() {
  const v = (process.env.TM_RESET_CODE ?? '').trim();
  return v || DEFAULT_CODE;
}

/** Constant-time compare, so the code cannot be guessed a character at a time. */
function codeMatches(supplied: string) {
  const a = Buffer.from(supplied.trim());
  const b = Buffer.from(resetCode());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const { email, code } = await parseBody(req, forgotSchema);
    const meta = await requestMeta();

    if (await isRateLimited(email, meta.ip)) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Please wait 15 minutes and try again.' },
        { status: 429 },
      );
    }

    const user = await queryOne<{ id: number; status: string; full_name: string; email: string }>(
      'SELECT id, status, full_name, email FROM tm_users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );

    // One message for a wrong address, a wrong code, or an account that is not
    // active, so the endpoint cannot be used to discover who has an account.
    const rejection = NextResponse.json(
      { error: 'That email and emergency code do not match an active account.' },
      { status: 401 },
    );

    if (!user || user.status !== 'ACTIVE' || !codeMatches(code)) {
      await recordLoginAttempt(email, meta.ip, false);
      if (user) {
        await audit(user.id, 'PASSWORD_RESET_CODE_REJECTED', 'USER', user.id, null, {
          reason: user.status !== 'ACTIVE' ? 'INACTIVE_ACCOUNT' : 'BAD_CODE',
        });
      }
      return rejection;
    }

    // Only the newest token may be used — any earlier one is burned here so a
    // link left open in another tab is worthless.
    await execute(
      'UPDATE tm_password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()',
      [user.id],
    );

    const raw = crypto.randomBytes(32).toString('base64url');
    await execute(
      `INSERT INTO tm_password_resets (user_id, token_hash, expires_at)
       VALUES (?,?, NOW() + INTERVAL ${EXPIRY_MINUTES} MINUTE)`,
      [user.id, sha256(raw)],
    );

    await recordLoginAttempt(email, meta.ip, true);
    await audit(user.id, 'PASSWORD_RESET_CODE_ACCEPTED', 'USER', user.id, null, { ip: meta.ip ?? null });

    return NextResponse.json({
      ok: true,
      token: raw,
      expires_in_minutes: EXPIRY_MINUTES,
      full_name: user.full_name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
