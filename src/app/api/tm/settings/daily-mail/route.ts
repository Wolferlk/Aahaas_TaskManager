import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query, queryOne } from '@/lib/db';
import {
  audit,
  badRequest,
  intParam,
  parseBody,
  requirePermission,
  requireUser,
  searchParams,
  toErrorResponse,
} from '@/lib/api';
import {
  AUTHOR_PREF_DEFAULTS,
  DAILY_MAIL_SETTING_KEY,
  getDailyMailConfig,
  resolveDailyUpdateRecipients,
  type MailRoute,
} from '@/lib/dailyMail';
import { graphConfigured, senderAddress, verifyGraph } from '@/lib/graphMail';

/**
 * Daily-task auto-send mail management.
 *
 * This is the per-person layer: which addresses receive *this* author's Daily
 * Update when they file one. The global list stays where it was, on
 * /api/tm/settings/email — everything here stacks on top of it.
 *
 * Everyone may read their own routing, so a person can see where their day is
 * going. Only a Manager may change anything.
 */

interface PersonRow {
  id: number;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  job_title: string | null;
  team_name: string | null;
  enabled: number | null;
  copy_self: number | null;
  use_global_list: number | null;
  notify_leader: number | null;
  last_update_date: string | null;
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);
    const canManage = user.role === 'MANAGER';

    // A non-Manager only ever sees their own row.
    const focusParam = sp.get('user_id');
    const focusId = focusParam ? Number(focusParam) : canManage ? null : user.id;
    if (focusId !== null && !Number.isFinite(focusId)) throw badRequest('That is not a person.');
    if (!canManage && focusId !== user.id) throw badRequest('You can only view your own mail routing.');

    const people = await query<PersonRow>(
      `SELECT u.id, u.full_name, u.email, u.avatar_url, u.role, u.job_title, t.name AS team_name,
              p.enabled, p.copy_self, p.use_global_list, p.notify_leader,
              (SELECT DATE_FORMAT(MAX(d.update_date), '%Y-%m-%d') FROM tm_daily_updates d WHERE d.user_id = u.id)
                AS last_update_date
         FROM tm_users u
         LEFT JOIN tm_teams t ON t.id = u.team_id
         LEFT JOIN tm_daily_mail_prefs p ON p.user_id = u.id
        WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
          ${canManage ? '' : 'AND u.id = ?'}
        ORDER BY u.full_name`,
      canManage ? [] : [user.id],
    );

    const ids = people.map((p) => p.id);
    const routes = ids.length
      ? await query<MailRoute & { recipient_name: string | null; recipient_avatar: string | null }>(
          `SELECT r.id, r.user_id, r.email, r.display_name, r.recipient_user_id, r.mode, r.is_active,
                  ru.full_name AS recipient_name, ru.avatar_url AS recipient_avatar
             FROM tm_daily_mail_routes r
             LEFT JOIN tm_users ru ON ru.id = r.recipient_user_id
            WHERE r.user_id IN (?)
            ORDER BY FIELD(r.mode,'TO','CC','BCC'), r.display_name, r.email`,
          [ids],
        )
      : [];

    const config = await getDailyMailConfig();

    // A live preview of the addressing for one person, so a Manager can see
    // exactly what the next send will look like before it happens.
    let preview = null;
    if (focusId !== null) {
      const author = people.find((p) => p.id === focusId);
      if (author) {
        const teamRow = await queryOne<{ team_id: number | null }>(
          'SELECT team_id FROM tm_users WHERE id = ?',
          [focusId],
        );
        const resolved = await resolveDailyUpdateRecipients({
          id: author.id,
          email: author.email,
          full_name: author.full_name,
          team_id: teamRow?.team_id ?? null,
        });
        preview = {
          user_id: author.id,
          will_send: resolved.willSend,
          reason: resolved.reason ?? null,
          recipients: resolved.resolved,
        };
      }
    }

    return NextResponse.json({
      people: people.map((p) => ({
        ...p,
        prefs: {
          enabled: p.enabled === null ? AUTHOR_PREF_DEFAULTS.enabled : !!p.enabled,
          copy_self: p.copy_self === null ? AUTHOR_PREF_DEFAULTS.copy_self : !!p.copy_self,
          use_global_list: p.use_global_list === null ? AUTHOR_PREF_DEFAULTS.use_global_list : !!p.use_global_list,
          notify_leader: p.notify_leader === null ? AUTHOR_PREF_DEFAULTS.notify_leader : !!p.notify_leader,
        },
      })),
      routes,
      config,
      preview,
      sender: senderAddress(),
      graph_configured: graphConfigured(),
      graph: canManage && graphConfigured() ? await verifyGraph() : null,
      recent: canManage
        ? await query(
            `SELECT id, subject, recipients, success, error, created_at
               FROM tm_email_log WHERE scope = 'DAILY_UPDATE'
              ORDER BY created_at DESC LIMIT ?`,
            [intParam(sp, 'log_limit', 12, 50)],
          )
        : [],
      can_manage: canManage,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const routeSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(190),
  display_name: z.string().trim().max(150).nullable().optional(),
  recipient_user_id: z.coerce.number().int().positive().nullable().optional(),
  mode: z.enum(['TO', 'CC', 'BCC']).default('TO'),
});

/** Adds (or re-activates) one address on one author's route list. */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const body = await parseBody(req, routeSchema);

    const author = await queryOne<{ id: number }>(
      "SELECT id FROM tm_users WHERE id = ? AND deleted_at IS NULL AND status = 'ACTIVE'",
      [body.user_id],
    );
    if (!author) throw badRequest('That person is not an active user.');

    await execute(
      `INSERT INTO tm_daily_mail_routes (user_id, email, display_name, recipient_user_id, mode, created_by)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
                               recipient_user_id = VALUES(recipient_user_id),
                               is_active = 1`,
      [body.user_id, body.email, body.display_name ?? null, body.recipient_user_id ?? null, body.mode, user.id],
    );
    await audit(user.id, 'DAILY_MAIL_ROUTE_ADDED', 'USER', body.user_id, null, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const prefsSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  enabled: z.boolean().optional(),
  copy_self: z.boolean().optional(),
  use_global_list: z.boolean().optional(),
  notify_leader: z.boolean().optional(),
});

/** Updates one author's switches, or the workspace-wide defaults. */
export async function PATCH(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // A body without user_id targets the workspace-wide config instead.
    if (raw.user_id === undefined) {
      const configPatch = z
        .object({
          enabled: z.boolean().optional(),
          copy_author: z.boolean().optional(),
          notify_leader: z.boolean().optional(),
          greeting: z.string().trim().max(120).optional(),
          sign_off: z.string().trim().max(120).optional(),
        })
        .parse(raw);

      const current = await getDailyMailConfig();
      const merged = { ...current, ...configPatch };
      await execute(
        `INSERT INTO tm_settings (setting_key, value, description, updated_by)
         VALUES (?, CAST(? AS JSON), 'Daily Update email delivery settings', ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
        [DAILY_MAIL_SETTING_KEY, JSON.stringify(merged), user.id],
      );
      await audit(user.id, 'DAILY_MAIL_CONFIG_CHANGED', 'SETTING', null, current, merged);
      return NextResponse.json({ ok: true, config: merged });
    }

    const body = prefsSchema.parse(raw);
    const d = AUTHOR_PREF_DEFAULTS;

    // The row is created with the defaults first, so a partial patch on a
    // person who has never been configured changes only what was asked for.
    await execute(
      `INSERT INTO tm_daily_mail_prefs (user_id, enabled, copy_self, use_global_list, notify_leader, updated_by)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [body.user_id, d.enabled ? 1 : 0, d.copy_self ? 1 : 0, d.use_global_list ? 1 : 0, d.notify_leader ? 1 : 0, user.id],
    );

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['enabled', 'copy_self', 'use_global_list', 'notify_leader'] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key] ? 1 : 0);
      }
    }
    if (fields.length) {
      fields.push('updated_by = ?');
      values.push(user.id, body.user_id);
      await execute(`UPDATE tm_daily_mail_prefs SET ${fields.join(', ')} WHERE user_id = ?`, values);
    }
    await audit(user.id, 'DAILY_MAIL_PREFS_CHANGED', 'USER', body.user_id, null, body);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const id = Number(searchParams(req).get('id'));
    if (!id) throw badRequest('Missing route.');

    const before = await queryOne('SELECT * FROM tm_daily_mail_routes WHERE id = ?', [id]);
    if (!before) throw badRequest('That route no longer exists.');

    await execute('DELETE FROM tm_daily_mail_routes WHERE id = ?', [id]);
    await audit(user.id, 'DAILY_MAIL_ROUTE_REMOVED', 'USER', id, before, null);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
