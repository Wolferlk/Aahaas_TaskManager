import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
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

    const inUse = await queryOne<{ c: number }>(
      'SELECT COUNT(*) AS c FROM tm_users WHERE department_id = ? AND deleted_at IS NULL',
      [id],
    );
    if (Number(inUse?.c ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Move the people in this department first, then disable it.' },
        { status: 409 },
      );
    }

    await execute("UPDATE tm_departments SET deleted_at = NOW(), status = 'DISABLED' WHERE id = ?", [id]);
    await audit(user.id, 'DEPARTMENT_DISABLED', 'DEPARTMENT', id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
