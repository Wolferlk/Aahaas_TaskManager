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

/** Every Manager, used for signup approvals and escalations. */
export async function managerIds(): Promise<number[]> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM tm_users WHERE role = 'MANAGER' AND status = 'ACTIVE' AND deleted_at IS NULL",
  );
  return rows.map((r) => r.id);
}
