import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, searchParams, toErrorResponse } from '@/lib/api';

/**
 * Reference data for pickers. `?public=1` returns only the department and team
 * lists needed by the signup form and requires no session.
 */
export async function GET(req: Request) {
  try {
    const sp = searchParams(req);

    if (sp.get('public') === '1') {
      const [departments, teams] = await Promise.all([
        query("SELECT id, name, code FROM tm_departments WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY name"),
        query(
          "SELECT id, name, code, department_id FROM tm_teams WHERE status = 'ACTIVE' AND deleted_at IS NULL ORDER BY name",
        ),
      ]);
      return NextResponse.json({ departments, teams });
    }

    await requireUser();

    const [departments, teams, projects, categories, users, tags] = await Promise.all([
      query(
        `SELECT d.id, d.name, d.code, d.color, d.status, d.manager_user_id
           FROM tm_departments d WHERE d.deleted_at IS NULL ORDER BY d.name`,
      ),
      query(
        `SELECT t.id, t.name, t.code, t.department_id, t.leader_user_id, t.status
           FROM tm_teams t WHERE t.deleted_at IS NULL ORDER BY t.name`,
      ),
      query(
        `SELECT p.id, p.name, p.code, p.status, p.color, p.department_id
           FROM tm_projects p WHERE p.deleted_at IS NULL AND p.status <> 'CANCELLED' ORDER BY p.name`,
      ),
      query('SELECT id, name, color FROM tm_task_categories WHERE is_active = 1 ORDER BY name'),
      query(
        `SELECT u.id, u.full_name, u.email, u.role, u.avatar_url, u.department_id, u.team_id,
                u.job_title, u.availability
           FROM tm_users u
          WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
          ORDER BY u.full_name`,
      ),
      query('SELECT id, name, color FROM tm_task_tags ORDER BY name LIMIT 200'),
    ]);

    return NextResponse.json({ departments, teams, projects, categories, users, tags });
  } catch (err) {
    return toErrorResponse(err);
  }
}
