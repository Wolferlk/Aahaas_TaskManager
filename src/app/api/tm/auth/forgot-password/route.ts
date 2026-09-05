import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { requestMeta, sha256 } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { forgotSchema } from '@/lib/validation';
import { graphConfigured, sendMail } from '@/lib/graphMail';
import { passwordResetEmail } from '@/lib/emailTemplates';

/**
 * Issues a reset token and mails the link out through Microsoft Graph.
 *
 * The response is deliberately the same whether or not the address is
 * registered, so the endpoint cannot be used to enumerate accounts. The one
 * thing it does report is whether *delivery itself* failed, because a person
 * staring at "check your inbox" while Graph is misconfigured has no way to
 * tell the difference between "not registered" and "the mail never left".
 */

const EXPIRY_MINUTES = 60;

function resetUrl(token: string) {
  const base = (process.env.TM_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/tm/reset-password?token=${encodeURIComponent(token)}`;
}

export async function POST(req: Request) {
  try {
    const { email } = await parseBody(req, forgotSchema);
    const meta = await requestMeta();

    const user = await queryOne<{ id: number; status: string; full_name: string; email: string }>(
      'SELECT id, status, full_name, email FROM tm_users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );

    const generic = {
      ok: true,
      message: 'If that email is registered, a reset link is on its way. It expires in an hour.',
    };

    if (!user || user.status !== 'ACTIVE') return NextResponse.json(generic);

    // Only the newest link may be used — any earlier one is burned here so a
    // forwarded or shoulder-surfed older mail is worthless.
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
    await audit(user.id, 'PASSWORD_RESET_REQUESTED', 'USER', user.id);

    const link = resetUrl(raw);
    let delivery: { ok: boolean; error?: string } = {
      ok: false,
      error: 'Microsoft Graph is not configured, so the reset link could not be emailed.',
    };

    if (graphConfigured()) {
      const { subject, html } = passwordResetEmail({
        name: user.full_name,
        resetUrl: link,
        expiresInMinutes: EXPIRY_MINUTES,
        requestedFromIp: meta.ip ?? null,
      });
      delivery = await sendMail({
        subject,
        html,
        to: [{ email: user.email, name: user.full_name }],
        scope: 'PASSWORD_RESET',
        entityType: 'USER',
        entityId: user.id,
        triggeredBy: user.id,
      });
    }

    if (!delivery.ok) {
      await audit(user.id, 'PASSWORD_RESET_EMAIL_FAILED', 'USER', user.id, null, { error: delivery.error });
    }

    return NextResponse.json({
      ...generic,
      sent: delivery.ok,
      // A delivery failure is surfaced so nobody waits on a mail that never
      // left. It says nothing about whether the address is registered.
      ...(delivery.ok ? {} : { delivery_error: delivery.error }),
      // Outside production the link is handed back directly, so the flow is
      // testable without a live mailbox.
      ...(process.env.NODE_ENV !== 'production' ? { dev_token: raw, dev_link: link } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
