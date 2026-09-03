import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { execute, query, queryOne } from './db';
import type { SessionUser } from './types';

const COOKIE = process.env.TM_COOKIE_NAME || 'tm_session';
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.TM_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('TM_SESSION_SECRET must be set to at least 32 characters.');
  }
  return new TextEncoder().encode(s);
}

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Creates a DB-backed session and sets the signed, http-only cookie. */
export async function createSession(userId: number, meta: { ip?: string; userAgent?: string }) {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);

  await execute(
    `INSERT INTO tm_user_sessions (user_id, token_hash, user_agent, ip_address, expires_at, last_seen_at)
     VALUES (?,?,?,?,?,NOW())`,
    [userId, sha256(raw), meta.userAgent?.slice(0, 400) ?? null, meta.ip ?? null, expires],
  );

  const jwt = await new SignJWT({ sid: raw, uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
  return jwt;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      await execute(
        'UPDATE tm_user_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
        [sha256(String(payload.sid))],
      );
    } catch {
      // An unparseable cookie is simply cleared.
    }
  }
  jar.delete(COOKIE);
}

/** Resolves the signed-in user, or null. Revoked or expired sessions resolve to null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  let sid: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    sid = String(payload.sid);
  } catch {
    return null;
  }

  const row = await queryOne<SessionUser>(
    `SELECT u.id, u.uuid, u.full_name, u.email, u.role, u.status, u.department_id, u.team_id,
            u.job_title, u.avatar_url, u.availability, u.must_change_password,
            d.name AS department_name, t.name AS team_name
       FROM tm_user_sessions s
       JOIN tm_users u ON u.id = s.user_id
       LEFT JOIN tm_departments d ON d.id = u.department_id
       LEFT JOIN tm_teams t ON t.id = u.team_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [sha256(sid)],
  );
  if (!row) return null;
  return { ...row, must_change_password: !!row.must_change_password };
}

export async function touchLogin(userId: number) {
  await execute('UPDATE tm_users SET last_login_at = NOW() WHERE id = ?', [userId]);
}

export async function requestMeta() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { ip: ip ?? undefined, userAgent: h.get('user-agent') ?? undefined };
}

/** Sliding-window throttle backed by tm_login_attempts. */
export async function isRateLimited(email: string, ip?: string) {
  const rows = await query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM tm_login_attempts
      WHERE success = 0 AND created_at > (NOW() - INTERVAL 15 MINUTE)
        AND (email = ? OR (ip_address IS NOT NULL AND ip_address = ?))`,
    [email, ip ?? ' '],
  );
  return (rows[0]?.c ?? 0) >= 8;
}

export async function recordLoginAttempt(email: string, ip: string | undefined, success: boolean) {
  await execute('INSERT INTO tm_login_attempts (email, ip_address, success) VALUES (?,?,?)', [
    email,
    ip ?? null,
    success ? 1 : 0,
  ]);
}
