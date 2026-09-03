import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { audit, parseBody, requirePermission, requireUser, toErrorResponse } from '@/lib/api';
import { z } from 'zod';
import { aiConfigured } from '@/lib/ai';

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await query<{ setting_key: string; value: unknown; description: string | null }>(
      'SELECT setting_key, value, description FROM tm_settings',
    );
    const settings = Object.fromEntries(
      rows.map((r) => [r.setting_key, typeof r.value === 'string' ? JSON.parse(r.value) : r.value]),
    );

    const prefs = await query('SELECT * FROM tm_user_preferences WHERE user_id = ?', [user.id]);

    return NextResponse.json({
      settings,
      descriptions: Object.fromEntries(rows.map((r) => [r.setting_key, r.description])),
      preferences: prefs[0] ?? null,
      ai_available: aiConfigured(),
      can_manage: user.role === 'MANAGER',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const schema = z.object({
  key: z.string().min(1).max(80),
  value: z.unknown(),
});

export async function PUT(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    const body = await parseBody(req, schema);

    await execute(
      `INSERT INTO tm_settings (setting_key, value, updated_by) VALUES (?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [body.key, JSON.stringify(body.value), user.id],
    );
    await audit(user.id, 'SETTING_CHANGED', 'SETTING', null, body.key, body.value);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const prefSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  sidebar_collapsed: z.boolean().optional(),
  dashboard_widgets: z.array(z.string()).optional(),
  notification_prefs: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, prefSchema);

    await execute('INSERT INTO tm_user_preferences (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [
      user.id,
    ]);

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.theme) {
      fields.push('theme = ?');
      values.push(body.theme);
    }
    if (body.sidebar_collapsed !== undefined) {
      fields.push('sidebar_collapsed = ?');
      values.push(body.sidebar_collapsed ? 1 : 0);
    }
    if (body.dashboard_widgets) {
      fields.push('dashboard_widgets = CAST(? AS JSON)');
      values.push(JSON.stringify(body.dashboard_widgets));
    }
    if (body.notification_prefs) {
      fields.push('notification_prefs = CAST(? AS JSON)');
      values.push(JSON.stringify(body.notification_prefs));
    }
    if (fields.length) {
      values.push(user.id);
      await execute(`UPDATE tm_user_preferences SET ${fields.join(', ')} WHERE user_id = ?`, values);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
