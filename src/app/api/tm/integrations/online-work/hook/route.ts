import { NextResponse } from 'next/server';
import { hookSchema, issueLinkCode, statusFor, syncFiling, verifySignature } from '@/lib/onlineWork';

/**
 * The one door Aahaas Online Work knocks on.
 *
 * No session here: the caller is the Online Work server, and the request is
 * trusted only because it carries an HMAC made with the shared secret (see
 * `verifySignature`). Three actions, all about the signed-in Online Work person
 * named in the body:
 *
 *   status     who that person is here, linking them by email if it is clear
 *   link-code  a one-time code they type into Task Manager to link by hand
 *   filing     a saved day, to be written as their Daily Update
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const refused = verifySignature(req.headers, raw);
  if (refused) return NextResponse.json({ ok: false, error: refused }, { status: 401 });

  let parsed;
  try {
    parsed = hookSchema.safeParse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request.' },
      { status: 422 },
    );
  }

  try {
    const body = parsed.data;
    if (body.action === 'status') return NextResponse.json({ ok: true, ...(await statusFor(body.identity)) });
    if (body.action === 'link-code') return NextResponse.json({ ok: true, ...(await issueLinkCode(body.identity)) });
    return NextResponse.json({ ok: true, ...(await syncFiling(body.identity, body.filing, { backfill: body.backfill })) });
  } catch (err) {
    console.error('[tm] online work hook failed:', err);
    return NextResponse.json({ ok: false, error: 'Task Manager could not process the filing.' }, { status: 500 });
  }
}
