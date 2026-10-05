import 'server-only';
import crypto from 'node:crypto';
import { execute, queryOne } from './db';
import { hashPassword } from './auth';

/**
 * Hard-coded development admin. It signs in as an active MANAGER, which holds
 * every permission in rbac.ts. Never honoured when NODE_ENV is 'production'.
 */
export const DEV_ADMIN_EMAIL = 'admin@aahaas.com';
const DEV_ADMIN_PASSWORD = 'admin@123';

/**
 * SQL condition that leaves the dev admin out of people lists, pickers,
 * counts and reports, so it never shows up as a real member. Pass the
 * tm_users alias when the query uses one.
 */
export function hideDevAdmin(alias?: string) {
  return `${alias ? `${alias}.` : ''}email <> '${DEV_ADMIN_EMAIL}'`;
}

export function isDevAdminLogin(email: string, password: string) {
  return (
    process.env.NODE_ENV !== 'production' &&
    email === DEV_ADMIN_EMAIL &&
    password === DEV_ADMIN_PASSWORD
  );
}

/**
 * Makes sure the dev admin row exists and is an active Manager, creating it on
 * first use. Other users are never touched. Returns the user id.
 */
export async function ensureDevAdmin(): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM tm_users WHERE email = ? LIMIT 1',
    [DEV_ADMIN_EMAIL],
  );

  if (existing) {
    await execute(
      `UPDATE tm_users
          SET role = 'MANAGER', status = 'ACTIVE', deleted_at = NULL, must_change_password = 0
        WHERE id = ?`,
      [existing.id],
    );
    return existing.id;
  }

  const res = await execute(
    `INSERT INTO tm_users (uuid, full_name, email, password_hash, role, requested_role, status,
       job_title, availability, approved_at, must_change_password)
     VALUES (?,?,?,?,'MANAGER','MANAGER','ACTIVE',?,'AVAILABLE',NOW(),0)`,
    [crypto.randomUUID(), 'Dev Admin', DEV_ADMIN_EMAIL, await hashPassword(DEV_ADMIN_PASSWORD), 'Administrator'],
  );
  await execute(
    'INSERT INTO tm_user_preferences (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id',
    [res.insertId],
  );
  return res.insertId;
}
