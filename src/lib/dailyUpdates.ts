import 'server-only';
import { z } from 'zod';
import { execute, query, queryOne, transaction } from './db';
import { audit } from './api';
import { dailyUpdateSchema } from './validation';
import { logActivity, nextTaskNumber } from './tasks';
import { AI_MODEL, detailedDaySummary, type DaySummaryItem } from './ai';
import { graphConfigured, sendMail } from './graphMail';
import { dailyUpdateEmail } from './emailTemplates';
import type { SessionUser } from './types';

/**
 * The one place a Daily Update is written.
 *
 * Both entry points go through here — the review screen a person submits
 * themselves, and the unattended 22:00 sweep that files from GitHub for anyone
 * who did not. That is deliberate: an auto-filed day is stored, summarised,
 * emailed and audited exactly like a typed one, and differs only in the
 * `generated_by` / `is_auto_submitted` flags that mark it for review.
 *
 * The long-form detail lives in tm_daily_update_details and
 * tm_daily_update_item_details, alongside the existing rows rather than
 * replacing anything in them.
 */

/** What a caller hands in — schema defaults may still be missing. */
export type DailyUpdatePayload = z.input<typeof dailyUpdateSchema>;
/** What is actually written, once defaults are applied. */
export type DailyUpdateInput = z.output<typeof dailyUpdateSchema>;

export interface SaveContext {
  /** Filed without the person present, by the cut-off sweep. */
  autoSubmitted?: boolean;
  generatedBy?: 'USER' | 'AI' | 'AUTO_GITHUB';
  github?: {
    commits: number;
    repos: string[];
    additions: number;
    deletions: number;
    files_changed: number;
    first_commit_at?: string | null;
    last_commit_at?: string | null;
  } | null;
  /** Defaults to true for a SUBMITTED update. */
  sendMail?: boolean;
}

export interface SaveResult {
  id: number;
  summary: string;
  detailed_summary: string;
  ai_used: boolean;
  stats: { completed: number; in_progress: number; blocked: number; total_hours: number; items: number };
  mail: { attempted: boolean; sent?: boolean; recipients?: number; error?: string };
  message: string;
}

const blank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

/** AI bullet lists are stored as plain lines so they read the same everywhere. */
const bullets = (list: string[]): string | null => (list.length ? list.map((l) => `- ${l}`).join('\n') : null);

/** The submitter's own words always win; AI only fills what was left empty. */
const preferUser = (userValue: unknown, aiValue: string | null): string | null =>
  blank(userValue) ? aiValue : String(userValue).trim();

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
  detailedSummary: string | null;
  aiGenerated: boolean;
  autoSubmitted: boolean;
  blockers: string | null;
  nextDayPlan: string | null;
  totalHours: number;
  githubCommits?: number;
  items: Array<{
    title: string;
    topic?: string | null;
    description?: string | null;
    status?: string | null;
    priority?: string | null;
    progress?: number | null;
    hours?: number | null;
    project_id?: number | null;
    detail?: { work_detail?: string | null; impact?: string | null; next_steps?: string | null } | null;
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
      greeting?: string | null;
      sign_off?: string | null;
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
      detailedSummary: ctx.detailedSummary,
      aiGenerated: ctx.aiGenerated,
      autoSubmitted: ctx.autoSubmitted,
      blockers: ctx.blockers,
      nextDayPlan: ctx.nextDayPlan,
      totalHours: ctx.totalHours,
      githubCommits: ctx.githubCommits,
      greeting: config.greeting ?? null,
      signOff: config.sign_off ?? null,
      items: ctx.items.map((i) => ({
        title: i.title,
        topic: i.topic ?? null,
        description: i.description ?? null,
        work_detail: i.detail?.work_detail ?? null,
        impact: i.detail?.impact ?? null,
        next_steps: i.detail?.next_steps ?? null,
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

export async function saveDailyUpdate(
  user: SessionUser,
  payload: DailyUpdatePayload,
  ctx: SaveContext = {},
): Promise<SaveResult> {
  // Re-validated here rather than trusted from the caller: the sweep builds its
  // payload in code, so this is the single gate every write passes through.
  const body = dailyUpdateSchema.parse(payload);

  const totalHours = body.items.reduce((sum, i) => sum + Number(i.hours ?? 0), 0);
  const autoSubmitted = !!ctx.autoSubmitted;
  const generatedBy = ctx.generatedBy ?? (autoSubmitted ? 'AUTO_GITHUB' : 'USER');

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
    // The detail rows cascade off the items, so they go with them.
    await cx.query('DELETE FROM tm_daily_update_items WHERE daily_update_id = ?', [id]);

    for (const item of body.items) {
      let taskId = item.task_id ?? null;

      if (item.linked_action === 'CREATED' && !taskId) {
        const taskNumber = await nextTaskNumber(cx, null);
        // The task description carries the full write-up, not just the one
        // line — the item detail is the same text the reviewer will read.
        const taskDescription = [item.description, item.detail?.work_detail]
          .filter((v) => !blank(v))
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join('\n\n');
        const [created] = await cx.query(
          `INSERT INTO tm_tasks
             (task_number, title, description, project_id, department_id, team_id, assignee_id, created_by,
              priority, status, visibility, progress, actual_hours, completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'TEAM',?,?,?)`,
          [
            taskNumber,
            item.title,
            taskDescription || null,
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

      const [inserted] = await cx.query(
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

      // A detail row is written only when there is something to put in it, so
      // a one-line item stays a single row.
      const d = item.detail;
      const hasDetail =
        !!d &&
        ([d.work_detail, d.technical_notes, d.impact, d.next_steps, d.collaborators, d.repos].some((v) => !blank(v)) ||
          !!d.links?.length ||
          !!d.commit_shas?.length ||
          d.commit_count != null);

      if (d && hasDetail) {
        const itemId = (inserted as { insertId: number }).insertId;
        await cx.query(
          `INSERT INTO tm_daily_update_item_details
             (daily_update_item_id, daily_update_id, work_detail, technical_notes, impact, next_steps,
              collaborators, repos, links, commit_shas, commit_count, additions, deletions, files_changed, source)
           VALUES (?,?,?,?,?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),?,?,?,?,?)`,
          [
            itemId,
            id,
            d.work_detail ?? null,
            d.technical_notes ?? null,
            d.impact ?? null,
            d.next_steps ?? null,
            d.collaborators ?? null,
            d.repos ?? null,
            JSON.stringify(d.links ?? []),
            JSON.stringify(d.commit_shas ?? []),
            d.commit_count ?? null,
            d.additions ?? null,
            d.deletions ?? null,
            d.files_changed ?? null,
            d.source ?? 'MANUAL',
          ],
        );
      }
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
    blocked: body.items.filter((i) => i.status === 'BLOCKED' || i.status === 'WAITING').length,
    total_hours: totalHours,
    items: body.items.length,
  };

  // Hours per kind of work, so a month of updates can be read as a breakdown
  // rather than a pile of titles.
  const workBreakdown: Record<string, { items: number; hours: number }> = {};
  for (const i of body.items) {
    const key = i.work_type?.trim() || 'Unspecified';
    workBreakdown[key] ??= { items: 0, hours: 0 };
    workBreakdown[key].items += 1;
    workBreakdown[key].hours += Number(i.hours ?? 0);
  }

  const summaryItems: DaySummaryItem[] = body.items.map((i) => ({
    title: i.title,
    status: i.status ?? 'IN_PROGRESS',
    work_type: i.work_type ?? null,
    hours: i.hours ?? null,
    work_detail: i.detail?.work_detail ?? i.description ?? null,
    blockers: i.blockers ?? null,
    next_steps: i.detail?.next_steps ?? null,
  }));

  const narrative = await detailedDaySummary(user.id, stats, summaryItems, {
    blockers: body.blockers ?? null,
    github: ctx.github ? { commits: ctx.github.commits, repos: ctx.github.repos } : null,
  });

  await execute('UPDATE tm_daily_updates SET summary = ?, ai_summary = ? WHERE id = ?', [
    narrative.data.summary,
    narrative.ok ? narrative.data.summary : null,
    updateId,
  ]);

  const detail = body.detail ?? {};
  const merged = {
    detailed_summary: preferUser(detail.detailed_summary, narrative.data.detailed_summary),
    highlights: preferUser(detail.highlights, bullets(narrative.data.highlights)),
    achievements: preferUser(detail.achievements, bullets(narrative.data.achievements)),
    challenges: preferUser(detail.challenges, bullets(narrative.data.challenges)),
    learnings: preferUser(detail.learnings, bullets(narrative.data.learnings)),
    next_day_plan: preferUser(detail.next_day_plan, bullets(narrative.data.next_day_plan)),
    collaboration: blank(detail.collaboration) ? null : String(detail.collaboration).trim(),
    focus_area: blank(detail.focus_area) ? null : String(detail.focus_area).trim(),
  };

  await execute(
    `INSERT INTO tm_daily_update_details
       (daily_update_id, user_id, update_date, detailed_summary, highlights, achievements, challenges,
        learnings, collaboration, next_day_plan, focus_area, work_breakdown, metrics, github_metrics,
        generated_by, is_auto_submitted, needs_review, ai_model, ai_used)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),CAST(? AS JSON),?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       detailed_summary = VALUES(detailed_summary), highlights = VALUES(highlights),
       achievements = VALUES(achievements), challenges = VALUES(challenges),
       learnings = VALUES(learnings), collaboration = VALUES(collaboration),
       next_day_plan = VALUES(next_day_plan), focus_area = VALUES(focus_area),
       work_breakdown = VALUES(work_breakdown), metrics = VALUES(metrics),
       github_metrics = VALUES(github_metrics), generated_by = VALUES(generated_by),
       is_auto_submitted = VALUES(is_auto_submitted), needs_review = VALUES(needs_review),
       ai_model = VALUES(ai_model), ai_used = VALUES(ai_used)`,
    [
      updateId,
      user.id,
      body.update_date,
      merged.detailed_summary,
      merged.highlights,
      merged.achievements,
      merged.challenges,
      merged.learnings,
      merged.collaboration,
      merged.next_day_plan,
      merged.focus_area,
      JSON.stringify(workBreakdown),
      JSON.stringify(stats),
      ctx.github ? JSON.stringify(ctx.github) : null,
      generatedBy,
      autoSubmitted ? 1 : 0,
      autoSubmitted ? 1 : 0,
      narrative.ok ? AI_MODEL : null,
      narrative.ok ? 1 : 0,
    ],
  );

  await audit(user.id, autoSubmitted ? 'DAILY_UPDATE_AUTO_SUBMITTED' : 'DAILY_UPDATE_SUBMITTED', 'DAILY_UPDATE', updateId, null, {
    date: body.update_date,
    items: body.items.length,
    auto: autoSubmitted,
    github_commits: ctx.github?.commits ?? 0,
  });

  // Mail is best-effort: a delivery failure is reported alongside a
  // successful save, never in place of it.
  const shouldMail = ctx.sendMail ?? body.status === 'SUBMITTED';
  const mail = shouldMail
    ? await deliverDailyUpdateMail({
        user,
        updateId,
        date: body.update_date,
        summary: narrative.data.summary,
        detailedSummary: merged.detailed_summary,
        aiGenerated: narrative.ok,
        autoSubmitted,
        blockers: body.blockers ?? null,
        nextDayPlan: merged.next_day_plan,
        totalHours,
        githubCommits: ctx.github?.commits,
        items: body.items.map((i) => ({ ...i, detail: i.detail ?? null })),
      })
    : { attempted: false as const };

  return {
    id: updateId,
    summary: narrative.data.summary,
    detailed_summary: merged.detailed_summary ?? narrative.data.detailed_summary,
    ai_used: narrative.ok,
    stats,
    mail,
    message: narrative.ok
      ? 'Daily update saved.'
      : 'AI analysis unavailable. Your data has been saved successfully.',
  };
}
