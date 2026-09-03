import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { audit, parseBody, toErrorResponse } from '@/lib/api';
import { signupSchema } from '@/lib/validation';
import { managerIds, notifyMany } from '@/lib/notifications';

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, signupSchema);

    const existing = await queryOne<{ id: number }>('SELECT id FROM tm_users WHERE email = ?', [body.email]);
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 },
      );
    }

    // A self-selected role is only a request — approval decides the real one.
    const res = await execute(
      `INSERT INTO tm_users
         (uuid, full_name, email, password_hash, role, requested_role, status,
          department_id, team_id, job_title, employee_code, phone, avatar_url)
       VALUES (?,?,?,?, 'EMPLOYEE', ?, 'PENDING_APPROVAL', ?,?,?,?,?,?)`,
      [
        crypto.randomUUID(),
        body.full_name,
        body.email,
        await hashPassword(body.password),
        body.requested_role,
        body.department_id ?? null,
        body.team_id ?? null,
        body.job_title ?? null,
        body.employee_code ?? null,
        body.phone ?? null,
        body.avatar_url ?? null,
      ],
    );
    const userId = res.insertId;

    await execute('INSERT INTO tm_user_preferences (user_id) VALUES (?)', [userId]);

    await execute(
      `INSERT INTO tm_approval_requests (type, requester_id, entity_type, entity_id, payload, reason, status)
       VALUES ('USER_SIGNUP', ?, 'USER', ?, CAST(? AS JSON), ?, 'PENDING')`,
      [
        userId,
        userId,
        JSON.stringify({
          requested_role: body.requested_role,
          department_id: body.department_id ?? null,
          team_id: body.team_id ?? null,
          job_title: body.job_title ?? null,
        }),
        `New signup requesting ${body.requested_role} access`,
      ],
    );

    await notifyMany(await managerIds(), {
      type: 'USER_APPROVAL_REQUIRED',
      title: 'New signup awaiting approval',
      body: `${body.full_name} requested ${body.requested_role} access.`,
      link: '/tm/approvals',
      entityType: 'USER',
      entityId: userId,
      priority: 'HIGH',
    });

    await audit(userId, 'USER_SIGNUP', 'USER', userId, null, {
      email: body.email,
      requested_role: body.requested_role,
    });

    return NextResponse.json({
      ok: true,
      status: 'PENDING_APPROVAL',
      message: 'Your account is waiting for Manager approval.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
