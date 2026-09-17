import { NextResponse } from 'next/server';
import { execute, query, queryOne } from '@/lib/db';
import { audit, notFound, parseBody, requirePermission, toErrorResponse } from '@/lib/api';
import { departmentSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.department.manage');
    const id = Number((await params).id);
    const body = await parseBody(req, departmentSchema.partial());

    const before = await queryOne('SELECT * FROM tm_departments WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!before) throw notFound('Department not found.');

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      fields.push(`\`${k}\` = ?`);
      values.push(k === 'code' && typeof v === 'string' ? v.toUpperCase() : v);
    }
    if (!fields.length) return NextResponse.json({ ok: true });

    values.push(id);
    await execute(`UPDATE tm_departments SET ${fields.join(', ')} WHERE id = ?`, values);
    await audit(user.id, 'DEPARTMENT_UPDATED', 'DEPARTMENT', id, before, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Soft delete only — history stays intact and a Manager can restore it. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requirePermission('tm.department.manage');
    const id = Number((await params).id);

    const department = await queryOne<{ name: string }>(
      'SELECT name FROM tm_departments WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    if (!department) throw notFound('Department not found.');

    const people = await queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM tm_users WHERE department_id = ? AND deleted_at IS NULL',
      [id],
    );
    const peopleCount = Number(people?.c ?? 0);
    if (peopleCount > 0) {
      return NextResponse.json(
        {
          error: `${department.name}: ${peopleCount} ${peopleCount === 1 ? 'person is' : 'people are'} still in this department. Move them first.`,
          code: 'DEPARTMENT_NOT_EMPTY',
        },
        { status: 409 },
      );
    }

    // A department with no people can still own teams, and a team cannot exist
    // without one — tm_teams.department_id is NOT NULL.
    const teams = await query<{ name: string }>(
      'SELECT name FROM tm_teams WHERE department_id = ? AND deleted_at IS NULL',
      [id],
    );
    if (teams.length) {
      return NextResponse.json(
        {
          error: `${department.name} still owns ${teams.map((t) => t.name).join(', ')}. Delete or move ${teams.length === 1 ? 'that team' : 'those teams'} first.`,
          code: 'DEPARTMENT_HAS_TEAMS',
        },
        { status: 409 },
      );
    }

    await execute("UPDATE tm_departments SET deleted_at = NOW(), status = 'DISABLED' WHERE id = ?", [id]);
    await audit(user.id, 'DEPARTMENT_DELETED', 'DEPARTMENT', id, department, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
