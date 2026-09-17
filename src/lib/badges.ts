import 'server-only';
import { execute, query, queryOne } from './db';
import { notify } from './notifications';

/**
 * Achievement badges.
 *
 * `tm_badges` ships with a `rule_key` and a `rule_threshold`, but nothing ever
 * evaluated them, so `tm_user_badges` stayed empty and every profile showed an
 * empty Achievements panel. This module is the missing half: one measurement
 * per rule key, compared against the badge's own threshold.
 *
 * Every rule is a plain count or rate over data the app already records — no
 * hidden weighting, so a person can be told exactly why they are short.
 */

export interface BadgeRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  tier: string;
  rule_key: string;
  rule_threshold: number;
}

export interface BadgeProgress extends BadgeRow {
  earned: boolean;
  awarded_at: string | null;
  /** Where the person currently stands against `rule_threshold`, same units. */
  value: number;
  /** 0-100, for the progress bar on a badge that is not earned yet. */
  percent: number;
}

const num = (v: unknown) => Number(v ?? 0);

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const row = await queryOne<{ v: number | null }>(sql, params);
  return num(row?.v);
}

/** The longest run of consecutive days, ending today or yesterday, with a completion. */
function longestCurrentStreak(days: string[]): number {
  if (!days.length) return 0;
  const set = new Set(days);
  const today = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // A streak that ended yesterday still counts — nobody loses it before the
  // day they are standing in is over.
  const cursor = new Date(today);
  if (!set.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (set.has(key(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Current standing for one rule key, in the same units as `rule_threshold`. */
async function measure(userId: number, ruleKey: string): Promise<number> {
  switch (ruleKey) {
    case 'tasks_completed':
      return scalar(
        `SELECT COUNT(*) AS v FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'`,
        [userId],
      );

    case 'critical_completed':
      return scalar(
        `SELECT COUNT(*) AS v FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED' AND priority = 'CRITICAL'`,
        [userId],
      );

    case 'daily_updates':
      return scalar(
        "SELECT COUNT(*) AS v FROM tm_daily_updates WHERE user_id = ? AND status <> 'DRAFT'",
        [userId],
      );

    case 'comments':
      return scalar(
        'SELECT COUNT(*) AS v FROM tm_task_comments WHERE user_id = ? AND deleted_at IS NULL AND is_system = 0',
        [userId],
      );

    case 'projects_completed':
      // A project they actually worked on, not merely one they were listed against.
      return scalar(
        `SELECT COUNT(DISTINCT p.id) AS v
           FROM tm_projects p
           JOIN tm_tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.assignee_id = ?
          WHERE p.deleted_at IS NULL AND p.status = 'COMPLETED'`,
        [userId],
      );

    case 'deadline_rate': {
      // Percentage of the last 30 days' completions that landed on time.
      const row = await queryOne<{ done: number | null; on_time: number | null }>(
        `SELECT COUNT(*) AS done, SUM(completed_at <= deadline) AS on_time
           FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'
            AND deadline IS NOT NULL AND completed_at IS NOT NULL
            AND completed_at >= (NOW() - INTERVAL 30 DAY)`,
        [userId],
      );
      const done = num(row?.done);
      // Under five finished tasks there is not enough evidence to call it.
      if (done < 5) return 0;
      return Math.round((num(row?.on_time) / done) * 100);
    }

    case 'zero_overdue_month': {
      // 1 when the last full 30 days closed with nothing overdue, else 0.
      const overdue = await scalar(
        `SELECT COUNT(*) AS v FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL
            AND status NOT IN ('COMPLETED','CANCELLED','REJECTED')
            AND deadline IS NOT NULL AND deadline < NOW()`,
        [userId],
      );
      const lateInMonth = await scalar(
        `SELECT COUNT(*) AS v FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'
            AND deadline IS NOT NULL AND completed_at > deadline
            AND completed_at >= (NOW() - INTERVAL 30 DAY)`,
        [userId],
      );
      const worked = await scalar(
        `SELECT COUNT(*) AS v FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'
            AND completed_at >= (NOW() - INTERVAL 30 DAY)`,
        [userId],
      );
      return worked > 0 && overdue === 0 && lateInMonth === 0 ? 1 : 0;
    }

    case 'fast_resolver': {
      // 1 when logged hours come in at or under the estimate across the last
      // ten estimated tasks. Needs both numbers or there is nothing to compare.
      const row = await queryOne<{ est: number | null; act: number | null; n: number | null }>(
        `SELECT SUM(estimated_hours) AS est, SUM(actual_hours) AS act, COUNT(*) AS n FROM (
           SELECT estimated_hours, actual_hours FROM tm_tasks
            WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'
              AND estimated_hours > 0 AND actual_hours > 0
            ORDER BY completed_at DESC LIMIT 10) recent`,
        [userId],
      );
      if (num(row?.n) < 5) return 0;
      return num(row?.act) > 0 && num(row?.act) <= num(row?.est) ? 1 : 0;
    }

    case 'streak_days': {
      const rows = await query<{ d: string }>(
        `SELECT DISTINCT DATE_FORMAT(completed_at, '%Y-%m-%d') AS d FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status = 'COMPLETED'
            AND completed_at >= (CURDATE() - INTERVAL 120 DAY)`,
        [userId],
      );
      return longestCurrentStreak(rows.map((r) => r.d));
    }

    default:
      return 0;
  }
}

async function activeBadges(): Promise<BadgeRow[]> {
  return query<BadgeRow>(
    `SELECT id, code, name, description, icon, tier, rule_key, rule_threshold
       FROM tm_badges WHERE is_active = 1 ORDER BY FIELD(tier,'BRONZE','SILVER','GOLD','PLATINUM'), rule_threshold`,
  );
}

/**
 * Awards every badge `userId` now qualifies for and returns the new ones.
 *
 * Safe to call on every completion: a badge already held is never re-awarded,
 * and a failure here must never take a task update down with it, so callers
 * wrap it — see `awardBadgesQuietly`.
 */
export async function evaluateBadges(userId: number): Promise<BadgeRow[]> {
  const badges = await activeBadges();
  if (!badges.length) return [];

  const held = new Set(
    (await query<{ badge_id: number }>('SELECT badge_id FROM tm_user_badges WHERE user_id = ?', [userId])).map(
      (r) => r.badge_id,
    ),
  );

  // One measurement per distinct rule key, not per badge — FIRST_10 and
  // HUNDRED both read `tasks_completed`.
  const values = new Map<string, number>();
  for (const key of new Set(badges.map((b) => b.rule_key))) {
    values.set(key, await measure(userId, key));
  }

  const awarded: BadgeRow[] = [];
  for (const badge of badges) {
    if (held.has(badge.id)) continue;
    const value = values.get(badge.rule_key) ?? 0;
    if (value < Number(badge.rule_threshold)) continue;

    const res = await execute(
      `INSERT INTO tm_user_badges (user_id, badge_id, context)
       SELECT ?, ?, ? FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM tm_user_badges x WHERE x.user_id = ? AND x.badge_id = ?)`,
      [userId, badge.id, `${badge.rule_key} = ${value}`, userId, badge.id],
    );
    if (!res.affectedRows) continue;

    awarded.push(badge);
    await notify({
      userId,
      type: 'BADGE_AWARDED',
      title: `Badge earned: ${badge.name}`,
      body: badge.description,
      link: '/tm/profile',
      entityType: 'BADGE',
      entityId: badge.id,
    });
  }
  return awarded;
}

/**
 * Fire-and-forget award pass. Earning a badge is a side effect of finishing
 * work; it must never be the reason finishing work fails.
 */
export async function awardBadgesQuietly(userId: number | null | undefined) {
  if (!userId) return;
  try {
    await evaluateBadges(userId);
  } catch (err) {
    console.error('[badges] award failed for user', userId, err);
  }
}

/**
 * Every active badge with where this person stands, earned or not.
 * The locked ones carry their progress so the panel says what is missing
 * instead of just being empty.
 */
export async function badgeProgress(userId: number): Promise<BadgeProgress[]> {
  const badges = await activeBadges();
  if (!badges.length) return [];

  const held = new Map(
    (
      await query<{ badge_id: number; awarded_at: string }>(
        'SELECT badge_id, awarded_at FROM tm_user_badges WHERE user_id = ?',
        [userId],
      )
    ).map((r) => [r.badge_id, r.awarded_at]),
  );

  const values = new Map<string, number>();
  for (const key of new Set(badges.map((b) => b.rule_key))) {
    values.set(key, await measure(userId, key));
  }

  return badges.map((badge) => {
    const threshold = Number(badge.rule_threshold) || 1;
    const value = values.get(badge.rule_key) ?? 0;
    const earned = held.has(badge.id);
    return {
      ...badge,
      earned,
      awarded_at: held.get(badge.id) ?? null,
      value,
      percent: earned ? 100 : Math.min(100, Math.round((value / threshold) * 100)),
    };
  });
}
