import 'server-only';
import { query } from './db';
import { teamMemberIds } from './tasks';
import type { SessionUser } from './types';

/**
 * Who a Manager or Leader is allowed to supervise.
 *
 * `userIds === null` means "everybody" and is reserved for Managers — it is a
 * deliberate distinction from an empty array, which means "nobody", so a Leader
 * with no team never silently widens into a company-wide view.
 */
export interface MemberScope {
  userIds: number[] | null;
  breadth: 'ALL' | 'TEAM' | 'SELF';
  /** Whether this person supervises anyone besides themselves. */
  supervises: boolean;
}

export async function memberScope(user: SessionUser): Promise<MemberScope> {
  if (user.role === 'MANAGER') return { userIds: null, breadth: 'ALL', supervises: true };

  if (user.role === 'LEADER') {
    // Membership is resolved through tm_team_members as well as tm_users.team_id,
    // because the profile column is only the person's primary team and is often
    // unset — reading it alone leaves a Leader looking at an empty portal.
    const members = await teamMemberIds(user.id);
    const ids = [...new Set([user.id, ...members])];
    return { userIds: ids, breadth: 'TEAM', supervises: ids.length > 1 };
  }

  return { userIds: [user.id], breadth: 'SELF', supervises: false };
}

/** Whether `user` may open `targetId`'s workload. Everyone may open their own. */
export async function canViewMember(user: SessionUser, targetId: number): Promise<boolean> {
  if (targetId === user.id) return true;
  const scope = await memberScope(user);
  return scope.userIds === null || scope.userIds.includes(targetId);
}

/**
 * The SQL fragment + params restricting a `tm_users` alias to the scope.
 * Returned as a fragment rather than an id list so the caller can keep the
 * roster query to a single round trip.
 */
export function memberWhere(scope: MemberScope, alias = 'u'): { sql: string; params: unknown[] } {
  if (scope.userIds === null) return { sql: '1 = 1', params: [] };
  if (!scope.userIds.length) return { sql: '1 = 0', params: [] };
  return { sql: `${alias}.id IN (?)`, params: [scope.userIds] };
}

/** Days, most recent first, that a person filed no Daily Update on a workday. */
export async function missingUpdateDays(userId: number, days: number): Promise<string[]> {
  const rows = await query<{ update_date: string }>(
    `SELECT DATE_FORMAT(update_date, '%Y-%m-%d') AS update_date
       FROM tm_daily_updates
      WHERE user_id = ? AND update_date >= (CURDATE() - INTERVAL ? DAY)`,
    [userId, days],
  );
  const filed = new Set(rows.map((r) => r.update_date));

  const missing: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const weekday = d.getDay();
    if (weekday === 0 || weekday === 6) continue; // Weekends are not expected.
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!filed.has(key)) missing.push(key);
  }
  return missing;
}
