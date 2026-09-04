import { NextResponse } from 'next/server';
import { badRequest, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { collectGithubDay } from '@/lib/githubActivity';

/**
 * Pulls the signed-in developer's commits for one day across their selected
 * repositories and drafts daily work items from them.
 *
 * Nothing is saved as a task here — the drafts go to the review screen, and
 * only what the developer confirms is written. This is the "review before
 * submit" step the module requires for every AI-assisted flow. The unattended
 * 22:00 sweep calls the same collector, but only for people who never came to
 * this screen at all.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const date = sp.get('date') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Pick a valid date.');

    const result = await collectGithubDay(user.id, date, { projectId: sp.get('project_id') });

    if (!result.connected) {
      return NextResponse.json({ connected: false, error: result.message }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
