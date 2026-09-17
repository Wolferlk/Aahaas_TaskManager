import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, badRequest, forbidden, notFound, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { userUpdateSchema } from '@/lib/validation';
import { notify } from '@/lib/notifications';
import { computeMetrics, getWeights, scoreFromMetrics } from '@/lib/performance';
import { awardBadgesQuietly, badgeProgress } from '@/lib/badges';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);

    const user = await queryOne(
      `SELECT u.id, u.uuid, u.full_name, u.email, u.role, u.status, u.avatar_url, u.job_title,
              u.employee_code, u.phone, u.availability, u.department_id, u.team_id, u.created_at, u.last_login_at,
              d.name AS department_name, t.name AS team_name, l.full_name AS leader_name
         FROM tm_users u
         LEFT JOIN tm_departments d ON d.id = u.department_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
         LEFT JOIN tm_users l ON l.id = t.leader_user_id
        WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id],
    );
    if (!user) throw notFound('That person could not be found.');

    const now = new Date();
    const metrics = await computeMetrics(id, now.getFullYear(), now.getMonth() + 1);
    const { score } = scoreFromMetrics(metrics, await getWeights());

    // Award before reading, so a badge someone qualified for through work that
    // predates the rules being evaluated shows up the first time they look.
    await awardBadgesQuietly(id);

    const [badges, recent, rewards] = await Promise.all([
      badgeProgress(id),
      query(
        `SELECT a.action, a.field, a.created_at, t.task_number, t.title
           FROM tm_task_activity_logs a
           JOIN tm_tasks t ON t.id = a.task_id
          WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 25`,
        [id],
      ),
      query(
        `SELECT r.name, r.icon, ra.period_year, ra.period_month, ra.reason
           FROM tm_reward_assignments ra JOIN tm_rewards r ON r.id = ra.reward_id
          WHERE ra.user_id = ? AND ra.status = 'APPROVED'
          ORDER BY ra.period_year DESC, ra.period_month DESC LIMIT 12`,
        [id],
      ),
    ]);

    return NextResponse.json({
      user,
      metrics,
      score,
      badges,
      recent_activity: recent,
      rewards,
      can_edit: me.role === 'MANAGER' || me.id === id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    const id = Number((await params).id);
    const body = await parseBody(req, userUpdateSchema);

    const isSelf = me.id === id;
    const isManager = me.role === 'MANAGER';
    if (!isSelf && !isManager) throw forbidden();

    // Only a Manager may change role, status, department or team.
    const privileged = ['role', 'status', 'department_id', 'team_id'] as const;
    if (!isManager) {
      for (const key of privileged) {
        if (body[key] !== undefined) {
          throw forbidden('Only a Manager can change role, status, department or team.');
        }
      }
    }

    const before = await queryOne<Record<string, unknown>>('SELECT * FROM tm_users WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!before) throw notFound('That person could not be found.');

    // The last active Manager cannot demote or disable themselves.
    if (isManager && (body.role || body.status) && before.role === 'MANAGER') {
      const others = await queryOne<{ c: number }>(
        "SELECT COUNT(*) AS c FROM tm_users WHERE role = 'MANAGER' AND status = 'ACTIVE' AND deleted_at IS NULL AND id <> ?",
        [id],
      );
      if (Number(others?.c ?? 0) === 0 && (body.role !== 'MANAGER' || body.status === 'DISABLED')) {
        return NextResponse.json(
          { error: 'This is the last active Manager account. Promote someone else first.' },
          { status: 409 },
        );
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      fields.push(`\`${k}\` = ?`);
      values.push(v);
    }
    if (!fields.length) return NextResponse.json({ ok: true });

    values.push(id);
    await execute(`UPDATE tm_users SET ${fields.join(', ')} WHERE id = ?`, values);

    if (body.role && body.role !== before.role) {
      await audit(me.id, 'USER_ROLE_CHANGED', 'USER', id, before.role, body.role);
      await notify({
        userId: id,
        type: 'ROLE_CHANGED',
        title: `Your role is now ${body.role}`,
        link: '/tm/profile',
        actorId: me.id,
        priority: 'HIGH',
      });
    }
    if (body.status && body.status !== before.status) {
      await audit(me.id, `USER_${body.status}`, 'USER', id, before.status, body.status);
    }
    await audit(me.id, 'USER_UPDATED', 'USER', id, { role: before.role, status: before.status }, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Soft delete of a person. Manager-only.
 *
 * The row stays so every task, comment and audit entry they ever touched still
 * resolves to a name — only their access ends. Four things block a delete, and
 * each one says what to do about it rather than failing vaguely:
 * deleting yourself, removing the last Manager, leaving open work unassigned,
 * and leaving a team without its Leader.
 *
 * Their email address is released (kept, prefixed, in the audit trail) so the
 * same person can be re-registered later — signup rejects an address that is
 * still on any row, deleted or not.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const me = await requireUser();
    if (me.role !== 'MANAGER') throw forbidden('Only a Manager can delete a person.');

    const id = Number((await params).id);
    if (id === me.id) throw badRequest('You cannot delete your own account.');

    const person = await queryOne<{ full_name: string; email: string; role: string }>(
      'SELECT full_name, email, role FROM tm_users WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!person) throw notFound('That person could not be found.');

    if (person.role === 'MANAGER') {
      const others = await queryOne<{ c: number }>(
        "SELECT COUNT(*) AS c FROM tm_users WHERE role = 'MANAGER' AND status = 'ACTIVE' AND deleted_at IS NULL AND id <> ?",
        [id],
      );
      if (Number(others?.c ?? 0) === 0) {
        return NextResponse.json(
          { error: 'This is the last active Manager account. Promote someone else first.' },
          { status: 409 },
        );
      }
    }

    const open = await queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM tm_tasks
        WHERE assignee_id = ? AND deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED')`,
      [id],
    );
    const openCount = Number(open?.c ?? 0);
    if (openCount > 0) {
      return NextResponse.json(
        {
          error: `${person.full_name} still has ${openCount} open ${openCount === 1 ? 'task' : 'tasks'}. Reassign them first.`,
        },
        { status: 409 },
      );
    }

    const leads = await query<{ name: string }>(
      'SELECT name FROM tm_teams WHERE leader_user_id = ? AND deleted_at IS NULL',
      [id],
    );
    if (leads.length) {
      return NextResponse.json(
        {
          error: `${person.full_name} leads ${leads.map((t) => t.name).join(', ')}. Assign a new Leader first.`,
        },
        { status: 409 },
      );
    }

    // Prefixed rather than blanked: still readable in an export, no longer in
    // the way of a future signup, and the original is in the audit entry below.
    const released = `deleted+${id}+${person.email}`.slice(0, 190);

    await execute(
      `UPDATE tm_users
          SET deleted_at = NOW(), status = 'DISABLED', email = ?, team_id = NULL
        WHERE id = ?`,
      [released, id],
    );
    // Any browser they are signed in on stops working on the next request.
    await execute('UPDATE tm_user_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    await execute(
      'UPDATE tm_team_members SET left_at = NOW(), is_active = 0 WHERE user_id = ? AND is_active = 1',
      [id],
    );

    await audit(me.id, 'USER_DELETED', 'USER', id, person, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
