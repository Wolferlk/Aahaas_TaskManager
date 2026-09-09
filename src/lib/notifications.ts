import 'server-only';
import { execute, query } from './db';

/**
 * Notification abstraction. Today it writes in-app rows only; an email or push
 * transport can be added behind `deliver` without touching any call site.
 * Email stays off until a Manager explicitly enables it in settings.
 */
export interface NotifyInput {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  actorId?: number | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
}

export async function notify(input: NotifyInput) {
  if (!input.userId) return;
  await execute(
    `INSERT INTO tm_notifications (user_id, type, title, body, link, entity_type, entity_id, actor_id, priority)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.userId,
      input.type,
      input.title.slice(0, 255),
      input.body ?? null,
      input.link ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.actorId ?? null,
      input.priority ?? 'NORMAL',
    ],
  );
}

export async function notifyMany(userIds: Array<number | null | undefined>, input: Omit<NotifyInput, 'userId'>) {
  const unique = [...new Set(userIds.filter((id): id is number => !!id))];
  await Promise.all(unique.map((userId) => notify({ ...input, userId })));
}

/**
 * Everyone who should hear about a change to one task: the person who raised
 * it, the leader of its team, and the manager of its department. Managers are
 * included as a fallback so an update on a task with no team or department
 * still reaches the portal rather than disappearing.
 */
export async function taskStakeholderIds(task: {
  created_by: number | null;
  team_id: number | null;
  department_id: number | null;
}): Promise<number[]> {
  const ids: Array<number | null | undefined> = [task.created_by];

  if (task.team_id) {
    const rows = await query<{ leader_user_id: number | null }>(
      'SELECT leader_user_id FROM tm_teams WHERE id = ? AND deleted_at IS NULL',
      [task.team_id],
    );
    ids.push(rows[0]?.leader_user_id);
  }

  if (task.department_id) {
    const rows = await query<{ manager_user_id: number | null }>(
      'SELECT manager_user_id FROM tm_departments WHERE id = ? AND deleted_at IS NULL',
      [task.department_id],
    );
    ids.push(rows[0]?.manager_user_id);
  }

  if (!ids.some((id) => !!id)) ids.push(...(await managerIds()));

  return [...new Set(ids.filter((id): id is number => !!id))];
}

/** Every Manager, used for signup approvals and escalations. */
export async function managerIds(): Promise<number[]> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM tm_users WHERE role = 'MANAGER' AND status = 'ACTIVE' AND deleted_at IS NULL",
  );
  return rows.map((r) => r.id);
}
