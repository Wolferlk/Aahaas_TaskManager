import { NextResponse } from 'next/server';
import { parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { dailyUpdateBulkSchema } from '@/lib/validation';
import { saveDailyUpdate } from '@/lib/dailyUpdates';
import { awardBadgesQuietly } from '@/lib/badges';

/**
 * Records several days in one request.
 *
 * A pasted tracker can cover a fortnight of missed days, and asking someone to
 * save each one separately is asking them not to bother. Every day still goes
 * through `saveDailyUpdate`, so a back-filled day is stored, summarised and
 * audited exactly like one typed on the day itself.
 *
 * Days are written one at a time and on purpose: each is its own transaction,
 * so one bad day cannot undo the rest. A day that fails is reported with its
 * reason alongside the days that succeeded, never in place of them.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, dailyUpdateBulkSchema);

    const results: Array<{
      date: string;
      ok: boolean;
      id?: number;
      items?: number;
      summary?: string;
      error?: string;
      mail?: { attempted: boolean; sent?: boolean; recipients?: number; error?: string };
    }> = [];

    for (const day of [...body.days].sort((a, b) => a.update_date.localeCompare(b.update_date))) {
      try {
        const saved = await saveDailyUpdate(user, day, { sendMail: body.send_mail });
        results.push({
          date: day.update_date,
          ok: true,
          id: saved.id,
          items: saved.stats.items,
          summary: saved.summary,
          mail: saved.mail,
        });
      } catch (err) {
        console.error('[tm] bulk daily update failed for', day.update_date, err);
        results.push({
          date: day.update_date,
          ok: false,
          error: err instanceof Error ? err.message : 'That day could not be recorded.',
        });
      }
    }

    const saved = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    // Badges are counted once for the whole batch rather than per day.
    if (saved.length) await awardBadgesQuietly(user.id);

    return NextResponse.json({
      ok: failed.length === 0,
      saved: saved.length,
      failed: failed.length,
      items: saved.reduce((sum, r) => sum + (r.items ?? 0), 0),
      mailed: saved.filter((r) => r.mail?.sent).length,
      results,
      message: failed.length
        ? `${saved.length} day${saved.length === 1 ? '' : 's'} recorded, ${failed.length} could not be saved.`
        : `${saved.length} day${saved.length === 1 ? '' : 's'} recorded.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
