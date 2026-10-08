import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { linkOverview, redeemLinkCode, resolveConflict, unlink } from '@/lib/onlineWork';

/**
 * The signed-in person's side of the Online Work link: see it, make it with a
 * code, settle a day both systems wrote, or break it.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await linkOverview(user));
  } catch (err) {
    return toErrorResponse(err);
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('redeem'), code: z.string().trim().min(1).max(20) }),
  z.object({
    action: z.literal('resolve'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    choice: z.enum(['online_work', 'task_manager']),
  }),
]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, actionSchema);

    if (body.action === 'redeem') {
      const result = await redeemLinkCode(user, body.code);
      if (!result.ok) throw new ApiError(result.status, result.error);
      return NextResponse.json({
        ok: true,
        message: `Linked to ${result.ow_email ?? 'your Online Work account'}. Days you save there will appear here.`,
      });
    }

    const outcome = await resolveConflict(user, body.date, body.choice);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    const removed = await unlink(user);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
