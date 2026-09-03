import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query, queryOne } from '@/lib/db';
import { audit, notFound, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { teamSchema } from '@/lib/validation';
import { notify } from '@/lib/notifications';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireUser();
    const id = Number((await params).id);

    const team = await queryOne(
      `SELECT t.*, d.name AS department_name, l.full_name AS leader_name, l.avatar_url AS leader_avatar
         FROM tm_teams t
         JOIN tm_departments d ON d.id = t.department_id
         LEFT JOIN tm_users l ON l.id = t.leader_user_id
        WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id],
    );
    if (!team) throw notFound('Team not found.');

    const members = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.avatar_url, u.job_title, u.availability,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.assignee_id = u.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.assignee_id = u.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED') AND tk.deadline < NOW()) AS overdue_tasks
         FROM tm_users u
        WHERE u.team_id = ? AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
        ORDER BY FIELD(u.role,'LEADER','EMPLOYEE'), u.full_name`,
      [id],
    );

    // Leader changes never rewrite task history — the assignment log is kept.
    const history = await query(
      `SELECT m.*, u.full_name FROM tm_team_members m
         JOIN tm_users u ON u.id = m.user_id
        WHERE m.team_id = ? ORDER BY m.joined_at DESC LIMIT 100`,
      [id],
    );

    return NextResponse.json({ team, members, history });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.team.manage');
    const id = Number((await params).id);
    const body = await parseBody(req, teamSchema.partial());

    const before = await queryOne<{ leader_user_id: number | null; name: string; department_id: number }>(
      'SELECT * FROM tm_teams WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!before) throw notFound('Team not found.');

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      fields.push(`\`${k}\` = ?`);
      values.push(k === 'code' && typeof v === 'string' ? v.toUpperCase() : v);
    }
    if (fields.length) {
      values.push(id);
      await execute(`UPDATE tm_teams SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    // A leader handover closes the previous membership row rather than deleting it.
    if (body.leader_user_id !== undefined && body.leader_user_id !== before.leader_user_id) {
      if (before.leader_user_id) {
        await execute(
          "UPDATE tm_team_members SET left_at = NOW(), is_active = 0 WHERE team_id = ? AND user_id = ? AND role_in_team = 'LEADER' AND is_active = 1",
          [id, before.leader_user_id],
        );
      }
      if (body.leader_user_id) {
        await execute(
          "INSERT INTO tm_team_members (team_id, user_id, role_in_team) VALUES (?,?, 'LEADER')",
          [id, body.leader_user_id],
        );
        await execute("UPDATE tm_users SET role = 'LEADER', team_id = ? WHERE id = ? AND role = 'EMPLOYEE'", [
          id,
          body.leader_user_id,
        ]);
        await notify({
          userId: body.leader_user_id,
          type: 'LEADER_ASSIGNED',
          title: `You now lead ${body.name ?? before.name}`,
          link: '/tm/teams',
          entityType: 'TEAM',
          entityId: id,
          actorId: user.id,
          priority: 'HIGH',
        });
      }
      await audit(user.id, 'TEAM_LEADER_CHANGED', 'TEAM', id, before.leader_user_id, body.leader_user_id);
    }

    await audit(user.id, 'TEAM_UPDATED', 'TEAM', id, before, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const memberSchema = z.object({
  user_ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  action: z.enum(['add', 'remove']).default('add'),
});

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.team.manage');
    const id = Number((await params).id);
    const body = await parseBody(req, memberSchema);

    const team = await queryOne<{ department_id: number; name: string }>(
      'SELECT department_id, name FROM tm_teams WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!team) throw notFound('Team not found.');

    for (const uid of body.user_ids) {
      if (body.action === 'add') {
        await execute(
          "INSERT INTO tm_team_members (team_id, user_id, role_in_team) VALUES (?,?, 'MEMBER')",
          [id, uid],
        );
        await execute('UPDATE tm_users SET team_id = ?, department_id = ? WHERE id = ?', [id, team.department_id, uid]);
        await notify({
          userId: uid,
          type: 'TEAM_ASSIGNED',
          title: `You have been added to ${team.name}`,
          link: '/tm/teams',
          entityType: 'TEAM',
          entityId: id,
          actorId: user.id,
        });
      } else {
        await execute(
          'UPDATE tm_team_members SET left_at = NOW(), is_active = 0 WHERE team_id = ? AND user_id = ? AND is_active = 1',
          [id, uid],
        );
        await execute('UPDATE tm_users SET team_id = NULL WHERE id = ? AND team_id = ?', [uid, id]);
      }
    }

    await audit(user.id, body.action === 'add' ? 'TEAM_MEMBERS_ADDED' : 'TEAM_MEMBERS_REMOVED', 'TEAM', id, null, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
