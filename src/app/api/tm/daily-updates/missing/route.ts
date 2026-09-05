import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { badRequest, forbidden, intParam, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { canViewDailyUpdatesOf, dailyUpdateScope } from '@/lib/dailyUpdates';
import { localDate } from '@/lib/autoDailyUpdate';

/**
 * The days a person has *not* recorded.
 *
 * Gaps are what people actually come here to fix, so they are computed on the
 * server rather than inferred in the browser from a page of history. Weekends
 * are excluded by default — an empty Sunday is not a gap — and the window
 * never starts before the person joined, so a new hire is not shown a month of
 * days that were never theirs to record.
 */

const DAY_MS = 864e5;

function isWeekend(iso: string) {
  const day = new Date(`${iso}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

function addDays(iso: string, delta: number) {
  return localDate(new Date(new Date(`${iso}T00:00:00`).getTime() + delta * DAY_MS));
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const targetId = Number(sp.get('user_id') ?? user.id);
    if (!Number.isFinite(targetId)) throw badRequest('That is not a person.');
    if (!(await canViewDailyUpdatesOf(user, targetId))) {
      throw forbidden('You can only look at gaps for yourself or someone you lead.');
    }

    const days = intParam(sp, 'days', 30, 180);
    const includeWeekends = sp.get('weekends') === '1';
    const today = localDate();
    const windowStart = addDays(today, -(days - 1));

    const joined = await query<{ created_at: string }>(
      'SELECT DATE(created_at) AS created_at FROM tm_users WHERE id = ?',
      [targetId],
    );
    const joinDate = joined[0]?.created_at ? localDate(new Date(joined[0].created_at)) : windowStart;
    const from = joinDate > windowStart ? joinDate : windowStart;

    const rows = await query<{ update_date: string; status: string; item_count: number }>(
      `SELECT DATE_FORMAT(d.update_date, '%Y-%m-%d') AS update_date, d.status,
              (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = d.id) AS item_count
         FROM tm_daily_updates d
        WHERE d.user_id = ? AND d.update_date BETWEEN ? AND ?`,
      [targetId, from, today],
    );

    const byDate = new Map(rows.map((r) => [r.update_date, r]));

    const calendar: Array<{
      date: string;
      weekend: boolean;
      state: 'SUBMITTED' | 'DRAFT' | 'MISSING' | 'OFF';
      items: number;
    }> = [];

    for (let d = from; d <= today; d = addDays(d, 1)) {
      const weekend = isWeekend(d);
      const row = byDate.get(d);
      const state = row
        ? row.status === 'SUBMITTED'
          ? ('SUBMITTED' as const)
          : ('DRAFT' as const)
        : weekend && !includeWeekends
          ? ('OFF' as const)
          : ('MISSING' as const);
      calendar.push({ date: d, weekend, state, items: row?.item_count ?? 0 });
    }

    const missing = calendar.filter((c) => c.state === 'MISSING').map((c) => c.date);
    const expected = calendar.filter((c) => c.state !== 'OFF').length;
    const recorded = calendar.filter((c) => c.state === 'SUBMITTED' || c.state === 'DRAFT').length;

    // The run of consecutive recorded working days ending today (or, if today
    // is still open, ending yesterday — a day in progress does not break it).
    let streak = 0;
    for (let i = calendar.length - 1; i >= 0; i--) {
      const day = calendar[i];
      if (day.state === 'OFF') continue;
      if (day.state === 'MISSING') {
        if (day.date === today) continue;
        break;
      }
      streak++;
    }

    const scope = await dailyUpdateScope(user);

    return NextResponse.json({
      user_id: targetId,
      from,
      to: today,
      today,
      include_weekends: includeWeekends,
      calendar,
      missing,
      expected,
      recorded,
      coverage: expected ? Math.round((recorded / expected) * 100) : 100,
      streak,
      can_view_others: scope.canViewOthers,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
