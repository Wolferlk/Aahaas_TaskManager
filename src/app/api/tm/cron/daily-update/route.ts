import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { badRequest, forbidden, requireUser, searchParams, toErrorResponse, unauthorized } from '@/lib/api';
import { getAutoConfig, localDate, recentAutoRuns, runAutoDailyUpdates } from '@/lib/autoDailyUpdate';
import { getSessionUser } from '@/lib/auth';

/**
 * The cut-off sweep, exposed as an endpoint.
 *
 * Two callers are allowed, and nothing else:
 *  - an unattended caller presenting TM_CRON_SECRET (the in-process scheduler,
 *    a system cron, or an external scheduler), and
 *  - a signed-in Manager pressing "Run now", which is recorded as a MANUAL run.
 *
 * Without TM_CRON_SECRET configured the secret path is refused outright rather
 * than left open.
 */

export const dynamic = 'force-dynamic';

function presentedSecret(req: Request): string | null {
  const header = req.headers.get('x-cron-secret');
  if (header) return header;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

/** Constant-time-ish comparison so the secret is not probed by timing. */
function secretMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.').optional(),
});

export async function POST(req: Request) {
  try {
    const expected = process.env.TM_CRON_SECRET;
    const presented = presentedSecret(req);

    let trigger: 'CRON' | 'MANUAL' = 'CRON';
    let triggeredBy: number | null = null;

    if (presented) {
      if (!expected || !secretMatches(presented, expected)) throw unauthorized('Invalid cron credentials.');
    } else {
      // No secret presented — fall back to a Manager-initiated run.
      const user = await getSessionUser();
      if (!user) throw unauthorized('This endpoint needs the cron secret or a Manager session.');
      if (user.role !== 'MANAGER') throw forbidden('Only a Manager can trigger this run.');
      trigger = 'MANUAL';
      triggeredBy = user.id;
    }

    let body: z.infer<typeof bodySchema> = {};
    if (req.headers.get('content-type')?.includes('application/json')) {
      const raw = await req.json().catch(() => ({}));
      const parsed = bodySchema.safeParse(raw ?? {});
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid request.');
      body = parsed.data;
    }

    const result = await runAutoDailyUpdates({
      date: body.date,
      trigger,
      triggeredBy,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Configuration, recent sweeps and who is still outstanding today. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    if (user.role !== 'MANAGER') throw forbidden('Only a Manager can view auto-submission runs.');

    const sp = searchParams(req);
    const date = sp.get('date') ?? localDate();
    const config = await getAutoConfig();

    const outstanding = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total
         FROM tm_users u
         JOIN tm_github_connections gc ON gc.user_id = u.id AND gc.is_active = 1
         LEFT JOIN tm_daily_updates du ON du.user_id = u.id AND du.update_date = ?
        WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
          AND (du.id IS NULL OR du.status <> 'SUBMITTED')
          AND EXISTS (SELECT 1 FROM tm_github_repos r WHERE r.user_id = u.id AND r.is_selected = 1)`,
      [date],
    );

    return NextResponse.json({
      config,
      date,
      cron_secret_configured: !!process.env.TM_CRON_SECRET,
      outstanding: outstanding?.total ?? 0,
      runs: await recentAutoRuns(10),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
