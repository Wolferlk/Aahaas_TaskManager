import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { intParam, requireUser, searchParams, toErrorResponse } from '@/lib/api';

/** Directory listing. Password hashes are never selected here. */
export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const sp = searchParams(req);

    const where: string[] = ['u.deleted_at IS NULL'];
    const params: unknown[] = [];

    const status = sp.get('status');
    if (status && status !== 'ALL') {
      where.push('u.status = ?');
      params.push(status);
    } else if (!status) {
      where.push("u.status = 'ACTIVE'");
    }

    const role = sp.get('role');
    if (role && role !== 'ALL') {
      where.push('u.role = ?');
      params.push(role);
    }
    const dept = sp.get('department_id');
    if (dept) {
      where.push('u.department_id = ?');
      params.push(Number(dept));
    }
    const team = sp.get('team_id');
    if (team) {
      where.push('u.team_id = ?');
      params.push(Number(team));
    }
    const q = sp.get('q');
    if (q) {
      where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.employee_code LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    // Employees see the directory but not administrative fields.
    const adminFields =
      me.role === 'MANAGER'
        ? ', u.status, u.requested_role, u.last_login_at, u.approved_at, u.created_at, u.employee_code, u.phone'
        : '';

    const limit = intParam(sp, 'limit', 100, 500);
    const offset = intParam(sp, 'offset', 0) || 0;

    const rows = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.avatar_url, u.job_title, u.availability,
              u.department_id, u.team_id,
              d.name AS department_name, t.name AS team_name${adminFields},
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.assignee_id = u.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.assignee_id = u.id AND tk.deleted_at IS NULL
                 AND tk.status = 'COMPLETED') AS completed_tasks,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.assignee_id = u.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED') AND tk.deadline < NOW()) AS overdue_tasks
         FROM tm_users u
         LEFT JOIN tm_departments d ON d.id = u.department_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(u.role,'MANAGER','LEADER','EMPLOYEE'), u.full_name
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return NextResponse.json({ users: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
