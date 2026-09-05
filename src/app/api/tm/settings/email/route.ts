import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query, queryOne } from '@/lib/db';
import { audit, badRequest, parseBody, requirePermission, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { graphConfigured, sendMail, verifyGraph } from '@/lib/graphMail';
import { DAILY_MAIL_DEFAULTS, DAILY_MAIL_SETTING_KEY, getDailyMailConfig } from '@/lib/dailyMail';
import { testEmail } from '@/lib/emailTemplates';

const SCOPES = ['DAILY_UPDATE', 'WEEKLY_SUMMARY', 'APPROVAL', 'TASK_ALERT'] as const;

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const scope = searchParams(req).get('scope') ?? 'DAILY_UPDATE';

    const [recipients, config, log] = await Promise.all([
      query(
        `SELECT r.*, u.full_name AS user_name, u.avatar_url
           FROM tm_email_recipients r
           LEFT JOIN tm_users u ON u.id = r.user_id
          WHERE r.scope = ? ORDER BY FIELD(r.mode,'TO','CC','BCC'), r.display_name, r.email`,
        [scope],
      ),
      getDailyMailConfig(),
      user.role === 'MANAGER'
        ? query('SELECT * FROM tm_email_log ORDER BY created_at DESC LIMIT 20')
        : Promise.resolve([]),
    ]);

    // Managers see the live permission state so a misconfigured Azure app is
    // obvious before anyone tries to send.
    const graph = user.role === 'MANAGER' && graphConfigured() ? await verifyGraph() : null;

    return NextResponse.json({
      recipients,
      config,
      graph_configured: graphConfigured(),
      graph,
      recent: log,
      can_manage: user.role === 'MANAGER',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const recipientSchema = z.object({
  scope: z.enum(SCOPES).default('DAILY_UPDATE'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(190),
  display_name: z.string().trim().max(150).nullable().optional(),
  user_id: z.coerce.number().int().positive().nullable().optional(),
  mode: z.enum(['TO', 'CC', 'BCC']).default('TO'),
});

export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const body = await parseBody(req, recipientSchema);

    await execute(
      `INSERT INTO tm_email_recipients (scope, email, display_name, user_id, mode, created_by)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), user_id = VALUES(user_id), is_active = 1`,
      [body.scope, body.email, body.display_name ?? null, body.user_id ?? null, body.mode, user.id],
    );
    await audit(user.id, 'EMAIL_RECIPIENT_ADDED', 'SETTING', null, null, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const id = Number(searchParams(req).get('id'));
    if (!id) throw badRequest('Missing recipient.');

    const before = await queryOne('SELECT * FROM tm_email_recipients WHERE id = ?', [id]);
    await execute('DELETE FROM tm_email_recipients WHERE id = ?', [id]);
    await audit(user.id, 'EMAIL_RECIPIENT_REMOVED', 'SETTING', id, before, null);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const configSchema = z.object({
  enabled: z.boolean().optional(),
  include_items: z.boolean().optional(),
  notify_leader: z.boolean().optional(),
  // Copy each author on their own Daily Update.
  copy_author: z.boolean().optional(),
  // Salutation and sign-off of the letter the daily update mail opens with.
  greeting: z.string().trim().max(120).optional(),
  sign_off: z.string().trim().max(120).optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const body = await parseBody(req, configSchema);

    const current = await getDailyMailConfig();
    const merged = { ...DAILY_MAIL_DEFAULTS, ...current, ...body };

    await execute(
      `INSERT INTO tm_settings (setting_key, value, description, updated_by)
       VALUES (?, CAST(? AS JSON), 'Daily Update email delivery settings', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [DAILY_MAIL_SETTING_KEY, JSON.stringify(merged), user.id],
    );
    await audit(user.id, 'EMAIL_SETTINGS_CHANGED', 'SETTING', null, current, merged);

    return NextResponse.json({ ok: true, config: merged });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Sends a real test message to the configured TO recipients. */
export async function PUT(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const body = (await req.json().catch(() => ({}))) as { verify_only?: boolean };

    if (body.verify_only) {
      const check = await verifyGraph();
      return NextResponse.json(check, { status: check.ok ? 200 : 400 });
    }

    const rows = await query<{ email: string; display_name: string | null; mode: string }>(
      "SELECT email, display_name, mode FROM tm_email_recipients WHERE scope = 'DAILY_UPDATE' AND is_active = 1",
    );
    const to = rows.filter((r) => r.mode === 'TO').map((r) => ({ email: r.email, name: r.display_name }));
    const cc = rows.filter((r) => r.mode === 'CC').map((r) => ({ email: r.email, name: r.display_name }));

    if (!to.length) throw badRequest('Add at least one "To" recipient before sending a test.');

    const { subject, html } = testEmail(user.full_name);
    const result = await sendMail({
      subject,
      html,
      to,
      cc,
      scope: 'TEST',
      triggeredBy: user.id,
    });

    return NextResponse.json(
      {
        ok: result.ok,
        error: result.error,
        message: result.ok ? `Test email sent to ${to.length + cc.length} recipient(s).` : result.error,
      },
      { status: result.ok ? 200 : 400 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
