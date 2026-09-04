import { NextResponse } from 'next/server';
import { execute, query, queryOne, transaction } from '@/lib/db';
import { audit, forbidden, intParam, parseBody, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { dailyUpdateSchema } from '@/lib/validation';
import { ledTeamIds, logActivity, nextTaskNumber } from '@/lib/tasks';
import { summariseDay } from '@/lib/ai';
import { graphConfigured, sendMail } from '@/lib/graphMail';
import { dailyUpdateEmail } from '@/lib/emailTemplates';
import type { SessionUser } from '@/lib/types';

/**
 * Sends the Daily Update mail through Microsoft Graph.
 *
 * Resolves recipients from tm_email_recipients, optionally adding the author's
 * team Leader. Any failure is swallowed into the return value so the caller's
 * save is never affected.
 */
async function deliverDailyUpdateMail(ctx: {
  user: SessionUser;
  updateId: number;
  date: string;
  summary: string;
  aiGenerated: boolean;
  blockers: string | null;
  totalHours: number;
  items: Array<{
    title: string;
    description?: string | null;
    status?: string | null;
    priority?: string | null;
    progress?: number | null;
    hours?: number | null;
    project_id?: number | null;
  }>;
}): Promise<{ attempted: boolean; sent?: boolean; recipients?: number; error?: string }> {
  try {
    if (!graphConfigured()) return { attempted: false };

    const configRow = await queryOne<{ value: unknown }>('SELECT value FROM tm_settings WHERE setting_key = ?', [
      'daily_update_email',
    ]);
    const raw = configRow?.value;
    const config = ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}) as {
      enabled?: boolean;
      notify_leader?: boolean;
    };
    if (config.enabled === false) return { attempted: false };

    const rows = await query<{ email: string; display_name: string | null; mode: string }>(
      `SELECT email, display_name, mode FROM tm_email_recipients
        WHERE scope = 'DAILY_UPDATE' AND is_active = 1`,
    );

    const to = rows.filter((r) => r.mode === 'TO').map((r) => ({ email: r.email, name: r.display_name }));
    const cc = rows.filter((r) => r.mode === 'CC').map((r) => ({ email: r.email, name: r.display_name }));
    const bcc = rows.filter((r) => r.mode === 'BCC').map((r) => ({ email: r.email, name: r.display_name }));

    if (config.notify_leader !== false && ctx.user.team_id) {
      const leader = await queryOne<{ email: string; full_name: string }>(
        `SELECT u.email, u.full_name FROM tm_teams t
           JOIN tm_users u ON u.id = t.leader_user_id
          WHERE t.id = ? AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
        [ctx.user.team_id],
      );
      if (leader && !to.some((r) => r.email === leader.email) && leader.email !== ctx.user.email) {
        cc.push({ email: leader.email, name: leader.full_name });
      }
    }

    if (!to.length && !cc.length) return { attempted: false };

    // Project names for the mail body, resolved in one lookup.
    const projectIds = [...new Set(ctx.items.map((i) => i.project_id).filter((v): v is number => !!v))];
    const projects = projectIds.length
      ? await query<{ id: number; name: string }>('SELECT id, name FROM tm_projects WHERE id IN (?)', [projectIds])
      : [];
    const projectName = new Map(projects.map((p) => [p.id, p.name]));

    const { subject, html } = dailyUpdateEmail({
      authorName: ctx.user.full_name,
      authorTitle: ctx.user.job_title,
      teamName: ctx.user.team_name ?? null,
      departmentName: ctx.user.department_name ?? null,
      date: ctx.date,
      summary: ctx.summary,
      aiGenerated: ctx.aiGenerated,
      blockers: ctx.blockers,
      totalHours: ctx.totalHours,
      items: ctx.items.map((i) => ({
        title: i.title,
        description: i.description ?? null,
        status: i.status ?? null,
        priority: i.priority ?? null,
        progress: i.progress ?? null,
        hours: i.hours ?? null,
        project_name: i.project_id ? (projectName.get(i.project_id) ?? null) : null,
      })),
    });

    const result = await sendMail({
      subject,
      html,
      to: to.length ? to : cc,
      cc: to.length ? cc : [],
      bcc,
      replyTo: [{ email: ctx.user.email, name: ctx.user.full_name }],
      scope: 'DAILY_UPDATE',
      entityType: 'DAILY_UPDATE',
      entityId: ctx.updateId,
      triggeredBy: ctx.user.id,
    });

    return {
      attempted: true,
      sent: result.ok,
      recipients: to.length + cc.length + bcc.length,
      error: result.error,
    };
  } catch (err) {
    console.error('[tm] daily update mail failed:', err);
    return { attempted: true, sent: false, error: err instanceof Error ? err.message : 'Mail delivery failed.' };
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const where: string[] = [];
    const params: unknown[] = [];

    // Scope: everyone sees their own; Leaders their team's; Managers all.
    const target = sp.get('user_id');
    if (target && Number(target) !== user.id) {
      if (user.role === 'MANAGER') {
        where.push('d.user_id = ?');
        params.push(Number(target));
      } else if (user.role === 'LEADER') {
        const teams = await ledTeamIds(user.id);
        if (!teams.length) throw forbidden('You do not lead a team yet.');
        where.push('d.user_id = ? AND u.team_id IN (?)');
        params.push(Number(target), teams);
      } else {
        throw forbidden('You can only view your own daily updates.');
      }
    } else if (sp.get('scope') === 'team' && user.role !== 'EMPLOYEE') {
      if (user.role === 'MANAGER') {
        where.push('1 = 1');
      } else {
        const teams = await ledTeamIds(user.id);
        if (!teams.length) throw forbidden('You do not lead a team yet.');
        where.push('u.team_id IN (?)');
        params.push(teams);
      }
    } else {
      where.push('d.user_id = ?');
      params.push(user.id);
    }

    const from = sp.get('from');
    if (from) {
      where.push('d.update_date >= ?');
      params.push(from);
    }
    const to = sp.get('to');
    if (to) {
      where.push('d.update_date <= ?');
      params.push(to);
    }
    const date = sp.get('date');
    if (date) {
      where.push('d.update_date = ?');
      params.push(date);
    }

    const limit = intParam(sp, 'limit', 30, 120);

    const updates = await query<{ id: number }>(
      `SELECT d.*, u.full_name, u.avatar_url, u.job_title,
              t.name AS team_name, dep.name AS department_name,
              (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = d.id) AS item_count
         FROM tm_daily_updates d
         JOIN tm_users u ON u.id = d.user_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
         LEFT JOIN tm_departments dep ON dep.id = u.department_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.update_date DESC, d.id DESC
        LIMIT ?`,
      [...params, limit],
    );

    const ids = updates.map((u) => u.id);
    const items = ids.length
      ? await query(
          `SELECT i.*, t.task_number, t.title AS task_title, p.name AS project_name
             FROM tm_daily_update_items i
             LEFT JOIN tm_tasks t ON t.id = i.task_id
             LEFT JOIN tm_projects p ON p.id = i.project_id
            WHERE i.daily_update_id IN (?) ORDER BY i.id`,
          [ids],
        )
      : [];

    return NextResponse.json({ updates, items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Saves a reviewed daily update.
 *
 * The payload is what the user confirmed on the review screen — AI output is
 * never written straight through. Items may attach to an existing task or
 * create a new one, but only when the user asked for it.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, dailyUpdateSchema);

    const totalHours = body.items.reduce((sum, i) => sum + Number(i.hours ?? 0), 0);

    const updateId = await transaction(async (cx) => {
      const [res] = await cx.query(
        `INSERT INTO tm_daily_updates
           (user_id, update_date, raw_text, source, status, total_hours, blockers, mood, submitted_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           raw_text = VALUES(raw_text), source = VALUES(source), status = VALUES(status),
           total_hours = VALUES(total_hours), blockers = VALUES(blockers), mood = VALUES(mood),
           submitted_at = VALUES(submitted_at)`,
        [
          user.id,
          body.update_date,
          body.raw_text ?? null,
          body.source,
          body.status,
          totalHours || null,
          body.blockers ?? null,
          body.mood ?? null,
          body.status === 'SUBMITTED' ? new Date() : null,
        ],
      );

      const [[row]] = (await cx.query('SELECT id FROM tm_daily_updates WHERE user_id = ? AND update_date = ?', [
        user.id,
        body.update_date,
      ])) as [Array<{ id: number }>, unknown];
      const id = row?.id ?? (res as { insertId: number }).insertId;

      // Re-saving the same day replaces its items rather than duplicating them.
      await cx.query('DELETE FROM tm_daily_update_items WHERE daily_update_id = ?', [id]);

      for (const item of body.items) {
        let taskId = item.task_id ?? null;

        if (item.linked_action === 'CREATED' && !taskId) {
          const taskNumber = await nextTaskNumber(cx, null);
          const [created] = await cx.query(
            `INSERT INTO tm_tasks
               (task_number, title, description, project_id, department_id, team_id, assignee_id, created_by,
                priority, status, visibility, progress, actual_hours, completed_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'TEAM',?,?,?)`,
            [
              taskNumber,
              item.title,
              item.description ?? null,
              item.project_id ?? null,
              user.department_id,
              user.team_id,
              user.id,
              user.id,
              (item.priority as string) || 'MEDIUM',
              (item.status as string) || 'IN_PROGRESS',
              item.progress ?? 0,
              item.hours ?? null,
              item.status === 'COMPLETED' ? new Date() : null,
            ],
          );
          taskId = (created as { insertId: number }).insertId;
        } else if (item.linked_action === 'ATTACHED' && taskId) {
          // Attaching only moves the task forward; it never rewrites its definition.
          await cx.query(
            `UPDATE tm_tasks
                SET progress = GREATEST(progress, ?),
                    actual_hours = COALESCE(actual_hours, 0) + ?,
                    status = CASE WHEN ? = 'COMPLETED' THEN 'COMPLETED' ELSE status END,
                    completed_at = CASE WHEN ? = 'COMPLETED' AND completed_at IS NULL THEN NOW() ELSE completed_at END
              WHERE id = ? AND assignee_id = ?`,
            [item.progress ?? 0, item.hours ?? 0, item.status ?? '', item.status ?? '', taskId, user.id],
          );
        }

        await cx.query(
          `INSERT INTO tm_daily_update_items
             (daily_update_id, task_id, topic, title, project_id, description, work_type, status, priority,
              progress, start_time, end_time, hours, blockers, outcome, tags, confidence, ai_generated, linked_action)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id,
            taskId,
            item.topic ?? null,
            item.title,
            item.project_id ?? null,
            item.description ?? null,
            item.work_type ?? null,
            item.status ?? null,
            item.priority ?? null,
            item.progress ?? null,
            item.start_time || null,
            item.end_time || null,
            item.hours ?? null,
            item.blockers ?? null,
            item.outcome ?? null,
            item.tags ?? null,
            item.confidence ?? null,
            item.ai_generated ? 1 : 0,
            item.linked_action,
          ],
        );
      }

      return id;
    });

    // Task activity is logged outside the transaction so a logging hiccup
    // cannot roll back the user's saved update.
    for (const item of body.items) {
      if (item.task_id && item.linked_action === 'ATTACHED') {
        await logActivity(item.task_id, user.id, 'DAILY_UPDATE_ATTACHED', null, null, item.title);
      }
    }

    const stats = {
      completed: body.items.filter((i) => i.status === 'COMPLETED').length,
      in_progress: body.items.filter((i) => i.status === 'IN_PROGRESS').length,
      blocked: body.items.filter((i) => i.status === 'BLOCKED').length,
      total_hours: totalHours,
    };
    const summary = await summariseDay(
      user.id,
      stats,
      body.items.map((i) => ({ title: i.title, status: i.status ?? 'IN_PROGRESS' })),
    );
    await execute('UPDATE tm_daily_updates SET summary = ?, ai_summary = ? WHERE id = ?', [
      summary.data,
      summary.ok ? summary.data : null,
      updateId,
    ]);

    await audit(user.id, 'DAILY_UPDATE_SUBMITTED', 'DAILY_UPDATE', updateId, null, {
      date: body.update_date,
      items: body.items.length,
    });

    // Mail is best-effort: a delivery failure is reported alongside a
    // successful save, never in place of it.
    const mail =
      body.status === 'SUBMITTED'
        ? await deliverDailyUpdateMail({
            user,
            updateId,
            date: body.update_date,
            summary: summary.data,
            aiGenerated: summary.ok,
            blockers: body.blockers ?? null,
            totalHours,
            items: body.items,
          })
        : { attempted: false as const };

    return NextResponse.json({
      ok: true,
      id: updateId,
      summary: summary.data,
      ai_used: summary.ok,
      stats,
      mail,
      message: summary.ok
        ? 'Daily update saved.'
        : 'AI analysis unavailable. Your data has been saved successfully.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
