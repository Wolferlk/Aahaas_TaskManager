import { NextResponse } from 'next/server';
import { execute, query, queryOne, transaction } from '@/lib/db';
import { audit, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { teamSchema } from '@/lib/validation';
import { notify } from '@/lib/notifications';

export async function GET() {
  try {
    await requireUser();
    const rows = await query(
      `SELECT t.*, d.name AS department_name, d.code AS department_code,
              l.full_name AS leader_name, l.avatar_url AS leader_avatar,
              (SELECT COUNT(*) FROM tm_users u WHERE u.team_id = t.id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL) AS member_count,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.team_id = t.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.team_id = t.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED') AND tk.deadline < NOW()) AS overdue_tasks
         FROM tm_teams t
         JOIN tm_departments d ON d.id = t.department_id
         LEFT JOIN tm_users l ON l.id = t.leader_user_id
        WHERE t.deleted_at IS NULL
        ORDER BY d.name, t.name`,
    );
    return NextResponse.json({ teams: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.team.manage');
    const body = await parseBody(req, teamSchema);

    const clash = await queryOne<{ id: number }>('SELECT id FROM tm_teams WHERE code = ?', [body.code]);
    if (clash) return NextResponse.json({ error: 'That team code is already in use.' }, { status: 409 });

    const id = await transaction(async (cx) => {
      const [res] = await cx.query(
        `INSERT INTO tm_teams (name, code, department_id, leader_user_id, description, status)
         VALUES (?,?,?,?,?,?)`,
        [
          body.name,
          body.code.toUpperCase(),
          body.department_id,
          body.leader_user_id ?? null,
          body.description ?? null,
          body.status,
        ],
      );
      const teamId = (res as { insertId: number }).insertId;

      if (body.leader_user_id) {
        await cx.query(
          "INSERT INTO tm_team_members (team_id, user_id, role_in_team) VALUES (?,?, 'LEADER')",
          [teamId, body.leader_user_id],
        );
        // Assigning someone as team Leader grants the LEADER role.
        await cx.query("UPDATE tm_users SET role = 'LEADER', team_id = ?, department_id = ? WHERE id = ? AND role = 'EMPLOYEE'", [
          teamId,
          body.department_id,
          body.leader_user_id,
        ]);
      }
      return teamId;
    });

    if (body.leader_user_id) {
      await notify({
        userId: body.leader_user_id,
        type: 'LEADER_ASSIGNED',
        title: `You now lead ${body.name}`,
        body: 'You can assign and review work for this team.',
        link: '/tm/teams',
        entityType: 'TEAM',
        entityId: id,
        actorId: user.id,
        priority: 'HIGH',
      });
    }
    await audit(user.id, 'TEAM_CREATED', 'TEAM', id, null, body);

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
