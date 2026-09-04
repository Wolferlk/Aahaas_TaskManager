import 'server-only';
import { execute, query, queryOne } from './db';
import { collectGithubDay } from './githubActivity';
import { saveDailyUpdate, type DailyUpdatePayload } from './dailyUpdates';
import { notify } from './notifications';
import type { SessionUser } from './types';

/**
 * Unattended Daily Update submission.
 *
 * When the cut-off passes (22:00 by default) and someone has not submitted
 * their update, their GitHub commits for that day are read and filed as their
 * update. The rules that make this safe to run without anyone watching:
 *
 *  - It never touches a day that is already SUBMITTED.
 *  - An existing DRAFT is preserved, not overwritten: its items are carried
 *    into the submission and the GitHub drafts are appended.
 *  - Nothing is filed for someone with no commits and no draft — an empty day
 *    is left empty rather than invented.
 *  - Every auto-filed update is flagged `is_auto_submitted` / `needs_review`,
 *    disclosed in the email, and the author is notified to correct it.
 *  - Carried-over draft items are re-linked as NONE, so re-filing a draft can
 *    never create a second copy of a task the draft already made.
 *
 * The sweep claims its slot in tm_daily_update_auto_runs before doing any work,
 * so a restart, a second server or a manual trigger cannot double-submit.
 */

export interface AutoConfig {
  enabled: boolean;
  /** Server-local cut-off. */
  hour: number;
  minute: number;
  /** Notify the author that an update was filed for them. */
  notify_user: boolean;
  /** Also notify people who had nothing to file, so the gap is visible. */
  notify_when_empty: boolean;
  /** Safety valve for the size of one sweep. */
  max_users: number;
}

export const AUTO_SETTING_KEY = 'daily_update_auto_submit';

const DEFAULTS: AutoConfig = {
  enabled: true,
  hour: 22,
  minute: 0,
  notify_user: true,
  notify_when_empty: true,
  max_users: 200,
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Reads the Manager-controlled configuration, falling back to the defaults. */
export async function getAutoConfig(): Promise<AutoConfig> {
  try {
    const row = await queryOne<{ value: unknown }>('SELECT value FROM tm_settings WHERE setting_key = ?', [
      AUTO_SETTING_KEY,
    ]);
    if (!row) return { ...DEFAULTS };
    const raw = row.value;
    const cfg = ((typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}) as Partial<AutoConfig>;
    return {
      enabled: cfg.enabled !== false,
      hour: clampInt(cfg.hour, 0, 23, DEFAULTS.hour),
      minute: clampInt(cfg.minute, 0, 59, DEFAULTS.minute),
      notify_user: cfg.notify_user !== false,
      notify_when_empty: cfg.notify_when_empty !== false,
      max_users: clampInt(cfg.max_users, 1, 2000, DEFAULTS.max_users),
    };
  } catch (err) {
    console.error('[tm] could not read auto-submit config:', err);
    return { ...DEFAULTS };
  }
}

/** Server-local calendar date — "today" as the office experiences it. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface AutoRunOutcome {
  user_id: number;
  name: string;
  result: 'SUBMITTED' | 'SKIPPED' | 'FAILED';
  reason?: string;
  items?: number;
  commits?: number;
  update_id?: number;
}

export interface AutoRunResult {
  ran: boolean;
  reason?: string;
  run_key: string;
  date: string;
  considered: number;
  submitted: number;
  skipped: number;
  failed: number;
  commits: number;
  duration_ms: number;
  outcomes: AutoRunOutcome[];
}

type CandidateRow = SessionUser & {
  update_id: number | null;
  update_status: string | null;
};

/**
 * Runs one sweep.
 *
 * @param opts.trigger  SCHEDULER (in-process timer), CRON (external caller) or
 *                      MANUAL (a Manager pressing Run now). Scheduled and cron
 *                      runs share a slot key so only one of them can win.
 */
export async function runAutoDailyUpdates(opts: {
  date?: string;
  trigger?: 'SCHEDULER' | 'CRON' | 'MANUAL';
  triggeredBy?: number | null;
  force?: boolean;
} = {}): Promise<AutoRunResult> {
  const started = Date.now();
  const trigger = opts.trigger ?? 'CRON';
  const date = opts.date ?? localDate();
  const config = await getAutoConfig();

  // A manual run is its own slot so a Manager can always re-run; the scheduled
  // slot is one-per-day and shared by the timer and any external cron.
  const runKey = trigger === 'MANUAL' ? `${date}:manual:${Date.now()}` : `${date}:auto`;

  const empty = (reason: string): AutoRunResult => ({
    ran: false,
    reason,
    run_key: runKey,
    date,
    considered: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    commits: 0,
    duration_ms: Date.now() - started,
    outcomes: [],
  });

  if (!config.enabled && trigger !== 'MANUAL') {
    return empty('Automatic submission is turned off in Settings.');
  }

  // Claim the slot first: whoever inserts the row owns this sweep.
  try {
    await execute(
      `INSERT INTO tm_daily_update_auto_runs (run_key, run_date, trigger_source, triggered_by)
       VALUES (?,?,?,?)`,
      [runKey, date, trigger, opts.triggeredBy ?? null],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY') return empty(`The ${date} sweep has already run.`);
    throw err;
  }

  const candidates = await query<CandidateRow>(
    `SELECT u.id, u.uuid, u.full_name, u.email, u.role, u.status, u.department_id, u.team_id,
            u.job_title, u.avatar_url, u.availability, u.must_change_password,
            dep.name AS department_name, t.name AS team_name,
            du.id AS update_id, du.status AS update_status
       FROM tm_users u
       JOIN tm_github_connections gc ON gc.user_id = u.id AND gc.is_active = 1
       LEFT JOIN tm_departments dep ON dep.id = u.department_id
       LEFT JOIN tm_teams t ON t.id = u.team_id
       LEFT JOIN tm_daily_updates du ON du.user_id = u.id AND du.update_date = ?
      WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
        AND (du.id IS NULL OR du.status <> 'SUBMITTED')
        AND EXISTS (SELECT 1 FROM tm_github_repos r WHERE r.user_id = u.id AND r.is_selected = 1)
      ORDER BY u.id
      LIMIT ?`,
    [date, config.max_users],
  );

  const outcomes: AutoRunOutcome[] = [];
  let commitsUsed = 0;

  for (const candidate of candidates) {
    const user: SessionUser = { ...candidate, must_change_password: !!candidate.must_change_password };
    try {
      const activity = await collectGithubDay(user.id, date);
      const draftItems =
        candidate.update_id && candidate.update_status === 'DRAFT'
          ? await loadDraftItems(candidate.update_id)
          : [];

      const githubItems: DailyUpdatePayload['items'] = activity.items.map((i) => ({
        task_id: null,
        topic: i.topic ?? null,
        title: i.title,
        project_id: i.project_id ?? null,
        description: i.description ?? null,
        work_type: i.work_type ?? 'Development',
        status: i.status,
        priority: i.priority,
        progress: i.progress,
        start_time: null,
        end_time: null,
        hours: i.hours ?? null,
        blockers: null,
        outcome: i.outcome ?? null,
        tags: i.tags.join(','),
        confidence: i.confidence,
        ai_generated: true,
        // The sweep files work items only. It never creates or advances a task
        // on someone's behalf — that stays a decision the person makes.
        linked_action: 'NONE',
        detail: {
          work_detail: i.work_detail ?? null,
          technical_notes: i.technical_notes ?? null,
          impact: i.impact ?? null,
          next_steps: i.next_steps ?? null,
          repos: i.repos?.join(', ') ?? null,
          links: i.links ?? [],
          commit_shas: i.commit_shas ?? [],
          commit_count: i.commit_count ?? null,
          additions: i.additions ?? null,
          deletions: i.deletions ?? null,
          files_changed: i.files_changed ?? null,
          source: 'GITHUB',
        },
      }));

      const items = [...draftItems, ...githubItems];

      if (!items.length) {
        // A revoked token or an unreachable repository must not be reported as
        // "no work happened" — the run log has to say which it was.
        const reason = !activity.connected
          ? 'GitHub is not connected.'
          : activity.errors.length
            ? `Could not read GitHub: ${activity.errors.join('; ')}`
            : `No commits and no draft for ${date}.`;

        outcomes.push({ user_id: user.id, name: user.full_name, result: 'SKIPPED', reason, commits: 0 });

        if (config.notify_when_empty && activity.connected) {
          await notify({
            userId: user.id,
            type: 'DAILY_UPDATE_MISSING',
            title: `No daily update recorded for ${date}`,
            body: activity.errors.length
              ? `Nothing could be filed automatically — ${activity.errors.join('; ')}. Please add your update.`
              : 'Nothing could be filed automatically — no commits were found and no draft was saved. Please add your update.',
            link: '/tm/daily-updates/new',
            priority: 'HIGH',
          });
        }
        continue;
      }

      const saved = await saveDailyUpdate(
        user,
        {
          update_date: date,
          raw_text: null,
          source: 'AI_PARSED',
          status: 'SUBMITTED',
          blockers: null,
          mood: null,
          items,
        },
        {
          autoSubmitted: true,
          generatedBy: 'AUTO_GITHUB',
          github: activity.metrics,
        },
      );

      commitsUsed += activity.metrics.commits;
      outcomes.push({
        user_id: user.id,
        name: user.full_name,
        result: 'SUBMITTED',
        items: items.length,
        commits: activity.metrics.commits,
        update_id: saved.id,
      });

      if (config.notify_user) {
        await notify({
          userId: user.id,
          type: 'DAILY_UPDATE_AUTO_SUBMITTED',
          title: `Your ${date} daily update was filed automatically`,
          body:
            `You had not submitted by the cut-off, so ${items.length} work item${items.length === 1 ? '' : 's'} ` +
            `were drafted from ${activity.metrics.commits} commit${activity.metrics.commits === 1 ? '' : 's'}. ` +
            'Please review and correct it.',
          link: '/tm/daily-updates/history',
          entityType: 'DAILY_UPDATE',
          entityId: saved.id,
          priority: 'HIGH',
        });
      }
    } catch (err) {
      console.error(`[tm] auto daily update failed for user ${candidate.id}:`, err);
      outcomes.push({
        user_id: candidate.id,
        name: candidate.full_name,
        result: 'FAILED',
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const submitted = outcomes.filter((o) => o.result === 'SUBMITTED').length;
  const skipped = outcomes.filter((o) => o.result === 'SKIPPED').length;
  const failed = outcomes.filter((o) => o.result === 'FAILED').length;
  const durationMs = Date.now() - started;

  await execute(
    `UPDATE tm_daily_update_auto_runs
        SET users_considered = ?, users_submitted = ?, users_skipped = ?, users_failed = ?,
            commits_used = ?, detail = CAST(? AS JSON), duration_ms = ?
      WHERE run_key = ?`,
    [
      candidates.length,
      submitted,
      skipped,
      failed,
      commitsUsed,
      JSON.stringify({ outcomes }),
      durationMs,
      runKey,
    ],
  );

  return {
    ran: true,
    run_key: runKey,
    date,
    considered: candidates.length,
    submitted,
    skipped,
    failed,
    commits: commitsUsed,
    duration_ms: durationMs,
    outcomes,
  };
}

/**
 * Carries a saved draft into the automatic submission.
 *
 * `linked_action` is deliberately reset to NONE: the draft's items already
 * created or attached whatever tasks they were going to, and re-running the
 * link step would duplicate them.
 */
async function loadDraftItems(updateId: number): Promise<DailyUpdatePayload['items']> {
  const rows = await query<{
    task_id: number | null;
    topic: string | null;
    title: string;
    project_id: number | null;
    description: string | null;
    work_type: string | null;
    status: string | null;
    priority: string | null;
    progress: number | null;
    start_time: string | null;
    end_time: string | null;
    hours: string | null;
    blockers: string | null;
    outcome: string | null;
    tags: string | null;
    confidence: string | null;
    ai_generated: number;
    work_detail: string | null;
    technical_notes: string | null;
    impact: string | null;
    next_steps: string | null;
    collaborators: string | null;
    repos: string | null;
  }>(
    `SELECT i.task_id, i.topic, i.title, i.project_id, i.description, i.work_type, i.status, i.priority,
            i.progress, i.start_time, i.end_time, i.hours, i.blockers, i.outcome, i.tags, i.confidence,
            i.ai_generated, det.work_detail, det.technical_notes, det.impact, det.next_steps,
            det.collaborators, det.repos
       FROM tm_daily_update_items i
       LEFT JOIN tm_daily_update_item_details det ON det.daily_update_item_id = i.id
      WHERE i.daily_update_id = ?
      ORDER BY i.id`,
    [updateId],
  );

  return rows.map((r) => ({
    task_id: r.task_id,
    topic: r.topic,
    title: r.title,
    project_id: r.project_id,
    description: r.description,
    work_type: r.work_type,
    status: r.status,
    priority: r.priority,
    progress: r.progress,
    start_time: r.start_time,
    end_time: r.end_time,
    hours: r.hours === null ? null : Number(r.hours),
    blockers: r.blockers,
    outcome: r.outcome,
    tags: r.tags,
    confidence: r.confidence === null ? null : Number(r.confidence),
    ai_generated: !!r.ai_generated,
    linked_action: 'NONE' as const,
    detail: {
      work_detail: r.work_detail,
      technical_notes: r.technical_notes,
      impact: r.impact,
      next_steps: r.next_steps,
      collaborators: r.collaborators,
      repos: r.repos,
      source: 'MANUAL' as const,
    },
  }));
}

/** The most recent sweeps, for the Settings screen. */
export async function recentAutoRuns(limit = 10) {
  return query(
    `SELECT run_key, run_date, trigger_source, users_considered, users_submitted, users_skipped,
            users_failed, commits_used, duration_ms, created_at
       FROM tm_daily_update_auto_runs
      ORDER BY id DESC
      LIMIT ?`,
    [limit],
  );
}
