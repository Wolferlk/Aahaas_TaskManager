import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { getSessionUser, requestMeta } from './auth';
import { can, type Permission } from './rbac';
import { execute } from './db';
import type { SessionUser } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const unauthorized = (m = 'You need to sign in to continue.') => new ApiError(401, m);
export const forbidden = (m = 'You do not have permission to do that.') => new ApiError(403, m);
export const notFound = (m = 'That record could not be found.') => new ApiError(404, m);
export const badRequest = (m: string) => new ApiError(400, m);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init);
}

/**
 * Wraps a route handler so no raw driver error ever reaches the browser.
 * Technical detail stays in the server log; the client gets a plain sentence.
 */
export function handler<T>(fn: () => Promise<T>) {
  return async (): Promise<NextResponse> => {
    try {
      const data = await fn();
      return data instanceof NextResponse ? data : NextResponse.json(data as object);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join('.') || 'Input'}: ${first.message}` : 'Invalid input.', issues: err.issues },
      { status: 422 },
    );
  }
  console.error('[tm] unhandled route error:', err);
  return NextResponse.json({ error: 'Something went wrong on our side. Please try again.' }, { status: 500 });
}

/** Requires an active session. Pending/disabled accounts are rejected. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  if (user.status === 'PENDING_APPROVAL') {
    throw new ApiError(403, 'Your account is waiting for Manager approval.', 'PENDING_APPROVAL');
  }
  if (user.status !== 'ACTIVE') {
    throw new ApiError(403, 'This account is not active. Please contact your Manager.', 'INACTIVE');
  }
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw forbidden();
  return user;
}

export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('Expected a JSON request body.');
  }
  return schema.parse(raw);
}

export function searchParams(req: Request) {
  return new URL(req.url).searchParams;
}

export function intParam(sp: URLSearchParams, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const v = Number(sp.get(key));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

/** Writes an entry to the module audit trail. Never throws into the caller. */
export async function audit(
  userId: number | null,
  action: string,
  entityType: string | null,
  entityId: number | null,
  oldValue?: unknown,
  newValue?: unknown,
) {
  try {
    const meta = await requestMeta();
    await execute(
      `INSERT INTO tm_audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        userId,
        action,
        entityType,
        entityId,
        oldValue === undefined ? null : JSON.stringify(oldValue).slice(0, 4000),
        newValue === undefined ? null : JSON.stringify(newValue).slice(0, 4000),
        meta.ip ?? null,
        meta.userAgent?.slice(0, 400) ?? null,
      ],
    );
  } catch (err) {
    console.error('[tm] audit write failed:', err);
  }
}
