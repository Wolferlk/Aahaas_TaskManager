import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { departmentSchema } from '@/lib/validation';

export async function GET() {
  try {
    await requireUser();
    const rows = await query(
      `SELECT d.*,
              m.full_name AS manager_name,
              (SELECT COUNT(*) FROM tm_teams t WHERE t.department_id = d.id AND t.deleted_at IS NULL) AS team_count,
              (SELECT COUNT(*) FROM tm_users u WHERE u.department_id = d.id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL) AS member_count,
              (SELECT COUNT(*) FROM tm_tasks tk WHERE tk.department_id = d.id AND tk.deleted_at IS NULL
                 AND tk.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks
         FROM tm_departments d
         LEFT JOIN tm_users m ON m.id = d.manager_user_id
        WHERE d.deleted_at IS NULL
        ORDER BY d.name`,
    );
    return NextResponse.json({ departments: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.department.manage');
    const body = await parseBody(req, departmentSchema);

    const clash = await queryOne<{ id: number }>('SELECT id FROM tm_departments WHERE code = ?', [body.code]);
    if (clash) return NextResponse.json({ error: 'That department code is already in use.' }, { status: 409 });

    const res = await execute(
      `INSERT INTO tm_departments (name, code, description, manager_user_id, color, status)
       VALUES (?,?,?,?,?,?)`,
      [body.name, body.code.toUpperCase(), body.description ?? null, body.manager_user_id ?? null, body.color ?? null, body.status],
    );
    await audit(user.id, 'DEPARTMENT_CREATED', 'DEPARTMENT', res.insertId, null, body);

    return NextResponse.json({ ok: true, id: res.insertId }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
