import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { taskScope } from '@/lib/tasks';

/** Global search across the module. Task numbers resolve to a direct hit. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const q = (searchParams(req).get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ tasks: [], people: [], projects: [], comments: [], direct: null });

    const like = `%${q}%`;
    const scope = await taskScope(user, 't');

    const [tasks, people, projects, comments] = await Promise.all([
      query(
        `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.deadline,
                u.full_name AS assignee_name, p.name AS project_name
           FROM tm_tasks t
           LEFT JOIN tm_users u ON u.id = t.assignee_id
           LEFT JOIN tm_projects p ON p.id = t.project_id
          WHERE t.deleted_at IS NULL AND ${scope.sql}
            AND (t.task_number LIKE ? OR t.title LIKE ? OR t.description LIKE ?)
          ORDER BY (t.task_number = ?) DESC, t.updated_at DESC
          LIMIT 12`,
        [...scope.params, like, like, like, q.toUpperCase()],
      ),
      query(
        `SELECT id, full_name, email, role, avatar_url, job_title
           FROM tm_users
          WHERE status = 'ACTIVE' AND deleted_at IS NULL
            AND (full_name LIKE ? OR email LIKE ? OR job_title LIKE ?)
          LIMIT 8`,
        [like, like, like],
      ),
      query(
        `SELECT id, name, code, status, color FROM tm_projects
          WHERE deleted_at IS NULL AND (name LIKE ? OR code LIKE ?) LIMIT 8`,
        [like, like],
      ),
      query(
        `SELECT c.id, c.body, c.created_at, t.id AS task_id, t.task_number, t.title, u.full_name
           FROM tm_task_comments c
           JOIN tm_tasks t ON t.id = c.task_id
           LEFT JOIN tm_users u ON u.id = c.user_id
          WHERE c.deleted_at IS NULL AND t.deleted_at IS NULL AND ${scope.sql}
            AND c.body LIKE ?
          ORDER BY c.created_at DESC LIMIT 8`,
        [...scope.params, like],
      ),
    ]);

    const direct = tasks.find((t) => (t as { task_number: string }).task_number.toUpperCase() === q.toUpperCase()) ?? null;

    return NextResponse.json({ tasks, people, projects, comments, direct });
  } catch (err) {
    return toErrorResponse(err);
  }
}
