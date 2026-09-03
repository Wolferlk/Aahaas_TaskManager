import { NextResponse } from 'next/server';
import { execute, query, queryOne, transaction } from '@/lib/db';
import {
  audit,
  badRequest,
  forbidden,
  intParam,
  parseBody,
  requirePermission,
  requireUser,
  searchParams,
  toErrorResponse,
} from '@/lib/api';
import { taskCreateSchema } from '@/lib/validation';
import { logActivity, logStatusChange, nextTaskNumber, taskMemberScopeCheck, taskScope } from '@/lib/tasks';
import { notify } from '@/lib/notifications';

const SORTABLE: Record<string, string> = {
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  deadline: 't.deadline',
  priority: "FIELD(t.priority,'CRITICAL','HIGH','MEDIUM','LOW')",
  status: 't.status',
  title: 't.title',
  progress: 't.progress',
  task_number: 't.task_number',
};

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const scope = await taskScope(user, 't');
    const where: string[] = ['t.deleted_at IS NULL', scope.sql];
    const params: unknown[] = [...scope.params];

    const view = sp.get('view');
    switch (view) {
      case 'my':
        where.push('t.assignee_id = ?');
        params.push(user.id);
        break;
      case 'created':
        where.push('t.created_by = ?');
        params.push(user.id);
        break;
      case 'personal':
        where.push('t.is_personal = 1 AND t.created_by = ?');
        params.push(user.id);
        break;
      case 'overdue':
        where.push("t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')");
        break;
      case 'completed':
        where.push("t.status = 'COMPLETED'");
        break;
      case 'today':
        where.push("DATE(t.deadline) = CURDATE() AND t.status NOT IN ('COMPLETED','CANCELLED')");
        break;
      case 'team': {
        where.push('t.team_id IS NOT NULL');
        if (user.role !== 'MANAGER' && user.team_id) {
          where.push('(t.team_id = ? OR t.team_id IN (SELECT id FROM tm_teams WHERE leader_user_id = ?))');
          params.push(user.team_id, user.id);
        }
        break;
      }
      default:
        break;
    }

    const multi = (key: string, column: string) => {
      const raw = sp.get(key);
      if (!raw || raw === 'ALL') return;
      const list = raw.split(',').filter(Boolean);
      if (!list.length) return;
      where.push(`${column} IN (?)`);
      params.push(list);
    };
    multi('status', 't.status');
    multi('priority', 't.priority');
    multi('task_type', 't.task_type');

    for (const [key, column] of [
      ['assignee_id', 't.assignee_id'],
      ['created_by', 't.created_by'],
      ['project_id', 't.project_id'],
      ['team_id', 't.team_id'],
      ['department_id', 't.department_id'],
      ['category_id', 't.category_id'],
      ['parent_task_id', 't.parent_task_id'],
    ] as const) {
      const v = sp.get(key);
      if (v) {
        where.push(`${column} = ?`);
        params.push(Number(v));
      }
    }

    if (sp.get('root_only') === '1') where.push('t.parent_task_id IS NULL');

    const q = sp.get('q');
    if (q) {
      where.push('(t.title LIKE ? OR t.task_number LIKE ? OR t.description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const from = sp.get('deadline_from');
    if (from) {
      where.push('t.deadline >= ?');
      params.push(from);
    }
    const to = sp.get('deadline_to');
    if (to) {
      where.push('t.deadline <= ?');
      params.push(to);
    }

    const sortKey = sp.get('sort') ?? 'created_at';
    const sortCol = SORTABLE[sortKey] ?? SORTABLE.created_at;
    const dir = sp.get('dir')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const limit = intParam(sp, 'limit', 25, 100);
    const page = intParam(sp, 'page', 1);
    const offset = (page - 1) * limit;

    const whereSql = where.join(' AND ');

    const [rows, totalRow] = await Promise.all([
      query(
        `SELECT t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.task_type,
                t.deadline, t.start_date, t.created_at, t.updated_at, t.completed_at,
                t.estimated_hours, t.actual_hours, t.visibility, t.is_personal, t.approval_required,
                t.assignee_id, t.created_by, t.project_id, t.team_id, t.department_id, t.parent_task_id,
                a.full_name AS assignee_name, a.avatar_url AS assignee_avatar,
                c.full_name AS creator_name,
                p.name AS project_name, p.color AS project_color,
                tm.name AS team_name, d.name AS department_name, cat.name AS category_name,
                (SELECT COUNT(*) FROM tm_tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL) AS subtask_count,
                (SELECT COUNT(*) FROM tm_tasks s WHERE s.parent_task_id = t.id AND s.deleted_at IS NULL AND s.status = 'COMPLETED') AS subtask_done,
                (SELECT COUNT(*) FROM tm_task_comments cm WHERE cm.task_id = t.id AND cm.deleted_at IS NULL) AS comment_count,
                (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id) AS checklist_count,
                (SELECT COUNT(*) FROM tm_task_checklists ck WHERE ck.task_id = t.id AND ck.is_done = 1) AS checklist_done,
                (t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')) AS is_overdue
           FROM tm_tasks t
           LEFT JOIN tm_users a ON a.id = t.assignee_id
           LEFT JOIN tm_users c ON c.id = t.created_by
           LEFT JOIN tm_projects p ON p.id = t.project_id
           LEFT JOIN tm_teams tm ON tm.id = t.team_id
           LEFT JOIN tm_departments d ON d.id = t.department_id
           LEFT JOIN tm_task_categories cat ON cat.id = t.category_id
          WHERE ${whereSql}
          ORDER BY ${sortCol} ${dir}, t.id DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      ),
      queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM tm_tasks t WHERE ${whereSql}`, params),
    ]);

    const total = Number(totalRow?.total ?? 0);
    return NextResponse.json({
      tasks: rows,
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.task.create');
    const body = await parseBody(req, taskCreateSchema);

    // Assigning work to someone else is a separate permission from creating it.
    const assigningToOther = body.assignee_id && body.assignee_id !== user.id;
    if (assigningToOther) {
      const allowed = await taskMemberScopeCheck(user, body.assignee_id!);
      if (!allowed) {
        throw forbidden('You can only assign tasks to people in the teams you lead.');
      }
    }

    if (body.parent_task_id) {
      const parent = await queryOne<{ id: number }>(
        'SELECT id FROM tm_tasks WHERE id = ? AND deleted_at IS NULL',
        [body.parent_task_id],
      );
      if (!parent) throw badRequest('The parent task no longer exists.');
    }

    const deptCode = body.department_id
      ? (
          await queryOne<{ code: string }>('SELECT code FROM tm_departments WHERE id = ?', [body.department_id])
        )?.code
      : null;

    const taskId = await transaction(async (cx) => {
      const taskNumber = await nextTaskNumber(cx, deptCode);

      let recurringId: number | null = null;
      if (body.recurring) {
        const [r] = await cx.query(
          `INSERT INTO tm_task_recurring_rules
             (frequency, interval_count, weekdays, day_of_month, starts_on, ends_on, next_run_at, is_active, created_by)
           VALUES (?,?,?,?,?,?,?,1,?)`,
          [
            body.recurring.frequency,
            body.recurring.interval_count,
            body.recurring.weekdays ?? null,
            body.recurring.day_of_month ?? null,
            body.start_date ? new Date(body.start_date) : new Date(),
            body.recurring.ends_on ? new Date(body.recurring.ends_on) : null,
            body.deadline ? new Date(body.deadline) : null,
            user.id,
          ],
        );
        recurringId = (r as { insertId: number }).insertId;
      }

      const [res] = await cx.query(
        `INSERT INTO tm_tasks
           (task_number, title, description, task_type, project_id, department_id, team_id, assignee_id,
            created_by, leader_id, category_id, parent_task_id, recurring_rule_id, recurrence_key,
            priority, status, visibility, is_personal, start_date, deadline, original_deadline,
            estimated_hours, approval_required)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          taskNumber,
          body.title,
          body.description ?? null,
          body.task_type,
          body.project_id ?? null,
          body.department_id ?? user.department_id ?? null,
          body.team_id ?? (body.is_personal ? null : user.team_id) ?? null,
          body.assignee_id ?? (body.is_personal ? user.id : null),
          user.id,
          null,
          body.category_id ?? null,
          body.parent_task_id ?? null,
          recurringId,
          recurringId ? new Date().toISOString().slice(0, 10) : null,
          body.priority,
          body.status,
          body.is_personal ? 'PRIVATE' : body.visibility,
          body.is_personal ? 1 : 0,
          body.start_date ? new Date(body.start_date) : null,
          body.deadline ? new Date(body.deadline) : null,
          body.deadline ? new Date(body.deadline) : null,
          body.estimated_hours ?? null,
          body.approval_required ? 1 : 0,
        ],
      );
      const id = (res as { insertId: number }).insertId;

      if (body.checklist?.length) {
        for (const [i, title] of body.checklist.entries()) {
          await cx.query('INSERT INTO tm_task_checklists (task_id, title, position) VALUES (?,?,?)', [id, title, i]);
        }
      }

      if (body.tags?.length) {
        for (const name of body.tags) {
          await cx.query('INSERT INTO tm_task_tags (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name', [name]);
          await cx.query(
            'INSERT IGNORE INTO tm_task_tag_map (task_id, tag_id) SELECT ?, id FROM tm_task_tags WHERE name = ?',
            [id, name],
          );
        }
      }

      return id;
    });

    const created = await queryOne<{ task_number: string }>('SELECT task_number FROM tm_tasks WHERE id = ?', [taskId]);

    await logActivity(taskId, user.id, 'CREATED', null, null, body.title);
    await logStatusChange(taskId, null, body.status, user.id, 'Task created');

    if (body.assignee_id && body.assignee_id !== user.id) {
      await notify({
        userId: body.assignee_id,
        type: 'TASK_ASSIGNED',
        title: `New task: ${body.title}`,
        body: `${user.full_name} assigned you ${created?.task_number}.`,
        link: `/tm/tasks?task=${taskId}`,
        entityType: 'TASK',
        entityId: taskId,
        actorId: user.id,
        priority: body.priority === 'CRITICAL' ? 'HIGH' : 'NORMAL',
      });
    }
    await audit(user.id, 'TASK_CREATED', 'TASK', taskId, null, { title: body.title, assignee_id: body.assignee_id });

    return NextResponse.json({ ok: true, id: taskId, task_number: created?.task_number }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
