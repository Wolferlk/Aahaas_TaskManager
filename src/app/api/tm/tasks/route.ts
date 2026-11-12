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
import {
  logActivity,
  logStatusChange,
  nextTaskNumber,
  refreshProjectProgress,
  taskMemberScopeCheck,
  taskScope,
} from '@/lib/tasks';
import { notify, notifyMany, taskStakeholderIds } from '@/lib/notifications';
import { dailyUpdateScope } from '@/lib/dailyUpdates';
import { hideDevAdmin } from '@/lib/devAdmin';
import type { SessionUser } from '@/lib/types';

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

const TASK_COLUMNS = `t.id, t.task_number, t.title, t.status, t.priority, t.progress, t.task_type,
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
                (t.deadline IS NOT NULL AND t.deadline < NOW() AND t.status NOT IN ('COMPLETED','CANCELLED')) AS is_overdue`;

const TASK_FROM = `FROM tm_tasks t
           LEFT JOIN tm_users a ON a.id = t.assignee_id
           LEFT JOIN tm_users c ON c.id = t.created_by
           LEFT JOIN tm_projects p ON p.id = t.project_id
           LEFT JOIN tm_teams tm ON tm.id = t.team_id
           LEFT JOIN tm_departments d ON d.id = t.department_id
           LEFT JOIN tm_task_categories cat ON cat.id = t.category_id`;

/** Tables behind a Daily Update entry, aliased so the filters below can refer to them. */
const DAILY_FROM = `FROM tm_daily_update_items i
           JOIN tm_daily_updates du ON du.id = i.daily_update_id
           JOIN tm_users dau ON dau.id = du.user_id
           LEFT JOIN tm_tasks lt ON lt.id = i.task_id AND lt.deleted_at IS NULL`;

/**
 * How Daily Update entries sort next to tasks. An entry has no deadline or
 * task number, so those sorts put it after every task; "newest" places it on
 * the day it was filed for, at the time it was written.
 */
const DAILY_SORT: Record<string, string> = {
  created_at: 'TIMESTAMP(du.update_date, TIME(i.created_at))',
  updated_at: 'TIMESTAMP(du.update_date, TIME(i.created_at))',
  deadline: 'NULL',
  priority: "FIELD(i.priority,'CRITICAL','HIGH','MEDIUM','LOW')",
  status: 'i.status',
  title: 'i.title',
  progress: 'i.progress',
  task_number: 'NULL',
};

interface DailyFilter {
  /** Set when a filter in use has no meaning for a Daily Update entry (deadline, team, …). */
  excluded: boolean;
  where: string;
  params: unknown[];
}

/**
 * The Daily Update entries that belong in Team Tasks, filtered the same way
 * as the task list. Returns null when the reader may not see other people's
 * Daily Updates, so the option is never offered to them.
 *
 * An entry tied to a live, shared task is left out: that task is already a
 * row of its own, and listing both would count the same work twice.
 */
async function teamDailyFilter(user: SessionUser, sp: URLSearchParams): Promise<DailyFilter | null> {
  const scope = await dailyUpdateScope(user);
  if (!scope.canViewOthers) return null;

  const where: string[] = [hideDevAdmin('dau'), '(lt.id IS NULL OR lt.is_personal = 1)'];
  const params: unknown[] = [];

  if (scope.userIds !== null) {
    where.push('du.user_id IN (?)');
    params.push(scope.userIds);
  }
  // Same rule as the task list: a Manager's own work lives in their own views.
  if (user.role === 'MANAGER') {
    where.push('du.user_id <> ?');
    params.push(user.id);
  }

  const notApplicable = [
    'created_by', 'team_id', 'department_id', 'category_id', 'parent_task_id',
    'task_type', 'deadline_from', 'deadline_to',
  ].some((key) => {
    const v = sp.get(key);
    return v !== null && v !== '' && v !== 'ALL';
  });

  for (const [key, column] of [['status', 'i.status'], ['priority', 'i.priority']] as const) {
    const raw = sp.get(key);
    if (!raw || raw === 'ALL') continue;
    const list = raw.split(',').filter(Boolean);
    if (!list.length) continue;
    where.push(`${column} IN (?)`);
    params.push(list);
  }

  const assignee = sp.get('assignee_id');
  if (assignee) {
    where.push('du.user_id = ?');
    params.push(Number(assignee));
  }
  const project = sp.get('project_id');
  if (project) {
    where.push('i.project_id = ?');
    params.push(Number(project));
  }

  const q = sp.get('q');
  if (q) {
    where.push('(i.title LIKE ? OR i.topic LIKE ? OR i.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  return { excluded: notApplicable, where: where.join(' AND '), params };
}

/**
 * One page of tasks and Daily Update entries together. The two are merged and
 * paged in SQL, so sorting and page boundaries hold across both kinds; the
 * full rows are then loaded for just the ids on the page.
 */
async function mixedWorkPage(opts: {
  includeTasks: boolean;
  taskWhere: string;
  taskParams: unknown[];
  taskSort: string;
  daily: DailyFilter;
  sortKey: string;
  dir: 'ASC' | 'DESC';
  page: number;
  limit: number;
}) {
  const { includeTasks, taskWhere, taskParams, taskSort, daily, sortKey, dir, page, limit } = opts;
  const includeDaily = !daily.excluded;

  const parts: string[] = [];
  const unionParams: unknown[] = [];
  if (includeTasks) {
    parts.push(`SELECT 'task' AS kind, t.id AS id, ${taskSort} AS sk FROM tm_tasks t WHERE ${taskWhere}`);
    unionParams.push(...taskParams);
  }
  if (includeDaily) {
    const dailySort = DAILY_SORT[sortKey] ?? DAILY_SORT.created_at;
    parts.push(`SELECT 'daily' AS kind, i.id AS id, ${dailySort} AS sk ${DAILY_FROM} WHERE ${daily.where}`);
    unionParams.push(...daily.params);
  }

  const empty = {
    tasks: [],
    daily_items: [],
    order: [],
    daily_available: true,
    pagination: { page, limit, total: 0, pages: 1 },
  };
  if (!parts.length) return empty;

  const [keys, taskCount, dailyCount] = await Promise.all([
    query<{ kind: 'task' | 'daily'; id: number }>(
      `SELECT kind, id FROM (${parts.join(' UNION ALL ')}) work
        ORDER BY sk IS NULL, sk ${dir}, kind DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...unionParams, limit, (page - 1) * limit],
    ),
    includeTasks
      ? queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM tm_tasks t WHERE ${taskWhere}`, taskParams)
      : Promise.resolve({ total: 0 }),
    includeDaily
      ? queryOne<{ total: number }>(`SELECT COUNT(*) AS total ${DAILY_FROM} WHERE ${daily.where}`, daily.params)
      : Promise.resolve({ total: 0 }),
  ]);

  const taskIds = keys.filter((k) => k.kind === 'task').map((k) => Number(k.id));
  const itemIds = keys.filter((k) => k.kind === 'daily').map((k) => Number(k.id));

  const [tasks, items] = await Promise.all([
    taskIds.length ? query(`SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.id IN (?)`, [taskIds]) : Promise.resolve([]),
    itemIds.length
      ? query(
          `SELECT i.id, i.daily_update_id, DATE_FORMAT(du.update_date, '%Y-%m-%d') AS update_date,
                  du.status AS update_status, du.user_id,
                  dau.full_name AS user_name, dau.avatar_url AS user_avatar,
                  i.title, i.topic, i.description, i.work_type, i.status, i.priority, i.progress,
                  i.hours, i.blockers, i.outcome, i.created_at,
                  pr.name AS project_name, pr.color AS project_color
             ${DAILY_FROM}
             LEFT JOIN tm_projects pr ON pr.id = i.project_id
            WHERE i.id IN (?)`,
          [itemIds],
        )
      : Promise.resolve([]),
  ]);

  const total = Number(taskCount?.total ?? 0) + Number(dailyCount?.total ?? 0);
  return {
    tasks,
    daily_items: items,
    order: keys.map((k) => ({ kind: k.kind, id: Number(k.id) })),
    daily_available: true,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

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
        // Work other people are doing. Requiring t.team_id hid every task
        // created by someone who is not in a team yet, which is most of them,
        // so the view is scoped by who the work belongs to instead.
        where.push('t.is_personal = 0');
        if (user.role === 'MANAGER') {
          // Everything except the Manager's own solo work, which lives in My Tasks.
          where.push('NOT (t.created_by = ? AND t.assignee_id <=> ?)');
          params.push(user.id, user.id);
        } else {
          // Teams led either through tm_teams.leader_user_id or a LEADER row in
          // tm_team_members, and members resolved through both tm_users.team_id
          // and the membership table - otherwise a Leader's team view is empty.
          where.push(
            `(t.team_id IN (SELECT id FROM tm_teams WHERE leader_user_id = ? AND deleted_at IS NULL)
              OR t.team_id IN (SELECT m0.team_id FROM tm_team_members m0
                                WHERE m0.user_id = ? AND m0.is_active = 1 AND m0.role_in_team = 'LEADER')
              OR t.assignee_id IN (
                   SELECT u2.id FROM tm_users u2
                    WHERE u2.deleted_at IS NULL
                      AND u2.team_id IN (SELECT id FROM tm_teams WHERE leader_user_id = ? AND deleted_at IS NULL)
                   UNION
                   SELECT m2.user_id FROM tm_team_members m2
                    WHERE m2.is_active = 1
                      AND m2.team_id IN (SELECT id FROM tm_teams WHERE leader_user_id = ? AND deleted_at IS NULL)
                   UNION
                   SELECT m3.user_id FROM tm_team_members m3
                    WHERE m3.is_active = 1
                      AND m3.team_id IN (SELECT m4.team_id FROM tm_team_members m4
                                          WHERE m4.user_id = ? AND m4.is_active = 1 AND m4.role_in_team = 'LEADER'))
              ${user.team_id ? 'OR t.team_id = ?' : ''})`,
          );
          params.push(user.id, user.id, user.id, user.id, user.id);
          if (user.team_id) params.push(user.team_id);
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

    // Team Tasks can also list the work people filed in their Daily Updates.
    // Only offered to readers who may see other people's Daily Updates.
    const daily = view === 'team' ? await teamDailyFilter(user, sp) : null;
    const requestedSource = sp.get('source');
    const source: 'tasks' | 'all' | 'daily' =
      daily && (requestedSource === 'all' || requestedSource === 'daily') ? requestedSource : 'tasks';

    if (source !== 'tasks' && daily) {
      return NextResponse.json(
        await mixedWorkPage({
          includeTasks: source === 'all',
          taskWhere: whereSql,
          taskParams: params,
          taskSort: sortCol,
          daily,
          sortKey,
          dir,
          page,
          limit,
        }),
      );
    }

    const [rows, totalRow] = await Promise.all([
      query(
        `SELECT ${TASK_COLUMNS}
           ${TASK_FROM}
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
      daily_available: daily !== null,
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

    // Tasks used to inherit only the *creator's* team, so anything raised by
    // someone without a team landed with team_id NULL - which made every
    // team-scoped view (Leader portal, team boards, team counts) come up empty.
    // Fall back to the assignee's team, via the membership table if their
    // profile column is unset.
    const assigneeId = body.assignee_id ?? user.id;
    let resolvedTeamId: number | null = body.team_id ?? null;
    if (resolvedTeamId == null && !body.is_personal) {
      const owner = await queryOne<{ team_id: number | null }>(
        `SELECT COALESCE(u.team_id,
                  (SELECT m.team_id FROM tm_team_members m
                    WHERE m.user_id = u.id AND m.is_active = 1
                    ORDER BY (m.role_in_team = 'LEADER') DESC, m.team_id LIMIT 1)) AS team_id
           FROM tm_users u WHERE u.id = ?`,
        [assigneeId],
      );
      resolvedTeamId = owner?.team_id ?? user.team_id ?? null;
    }

    // Recording the responsible leader lets review and escalation find a person
    // instead of falling back to the creator.
    const resolvedLeaderId = resolvedTeamId
      ? (await queryOne<{ leader_user_id: number | null }>(
          'SELECT leader_user_id FROM tm_teams WHERE id = ? AND deleted_at IS NULL',
          [resolvedTeamId],
        ))?.leader_user_id ?? null
      : null;

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
          body.is_personal ? null : resolvedTeamId,
          // Never leave a task ownerless — an unassigned task appears in
          // nobody's list and is effectively lost.
          assigneeId,
          user.id,
          body.is_personal ? null : resolvedLeaderId,
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
    await logStatusChange(taskId, null, body.status ?? 'TODO', user.id, 'Task created');

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
    // Raising a task is reported upwards the same way a status move is.
    // Without this, work an Employee created for themselves reached nobody:
    // the Manager only ever learned of it by going looking for it, which is
    // exactly the complaint that it "never appears in the portal".
    if (!body.is_personal) {
      const departmentId = body.department_id ?? user.department_id ?? null;
      const supervisors = (
        await taskStakeholderIds({
          created_by: user.id,
          team_id: body.is_personal ? null : resolvedTeamId,
          department_id: departmentId,
        })
      ).filter((uid) => uid !== user.id && uid !== assigneeId);

      await notifyMany(supervisors, {
        type: 'TASK_CREATED',
        title: `New task: ${body.title}`,
        body: `${user.full_name} raised ${created?.task_number}${
          assigneeId !== user.id ? '' : ' for themselves'
        }.`,
        link: `/tm/tasks?task=${taskId}`,
        entityType: 'TASK',
        entityId: taskId,
        actorId: user.id,
        priority: body.priority === 'CRITICAL' ? 'HIGH' : 'NORMAL',
      });
    }

    await refreshProjectProgress(body.project_id ?? null);
    await audit(user.id, 'TASK_CREATED', 'TASK', taskId, null, { title: body.title, assignee_id: body.assignee_id });

    return NextResponse.json({ ok: true, id: taskId, task_number: created?.task_number }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
