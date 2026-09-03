import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  createSession,
  isRateLimited,
  recordLoginAttempt,
  requestMeta,
  touchLogin,
  verifyPassword,
} from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { loginSchema } from '@/lib/validation';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, loginSchema);
    const meta = await requestMeta();

    if (await isRateLimited(body.email, meta.ip)) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Please wait 15 minutes and try again.' },
        { status: 429 },
      );
    }

    const user = await queryOne<{
      id: number;
      password_hash: string;
      status: string;
      full_name: string;
      must_change_password: number;
    }>(
      `SELECT id, password_hash, status, full_name, must_change_password
         FROM tm_users WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
      [body.email],
    );

    // Same response shape whether the email is unknown or the password is wrong.
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      await recordLoginAttempt(body.email, meta.ip, false);
      return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });
    }

    if (user.status === 'PENDING_APPROVAL') {
      await recordLoginAttempt(body.email, meta.ip, true);
      return NextResponse.json(
        { error: 'Your account is waiting for Manager approval.', code: 'PENDING_APPROVAL' },
        { status: 403 },
      );
    }
    if (user.status === 'REJECTED') {
      await recordLoginAttempt(body.email, meta.ip, true);
      return NextResponse.json(
        { error: 'Your signup request was not approved. Please contact your Manager.', code: 'REJECTED' },
        { status: 403 },
      );
    }
    if (user.status !== 'ACTIVE') {
      await recordLoginAttempt(body.email, meta.ip, true);
      return NextResponse.json(
        { error: 'This account has been deactivated. Please contact your Manager.', code: 'DISABLED' },
        { status: 403 },
      );
    }

    await createSession(user.id, meta);
    await touchLogin(user.id);
    await recordLoginAttempt(body.email, meta.ip, true);
    await audit(user.id, 'USER_LOGIN', 'USER', user.id);

    return NextResponse.json({
      ok: true,
      must_change_password: !!user.must_change_password,
      redirect: '/tm/dashboard',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
