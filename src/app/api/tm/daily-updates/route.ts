import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { forbidden, intParam, parseBody, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { dailyUpdateSchema } from '@/lib/validation';
import { dailyUpdateScope, saveDailyUpdate } from '@/lib/dailyUpdates';

/**
 * Reading Daily Updates.
 *
 * Visibility is resolved once by `dailyUpdateScope` and applied as an id list,
 * so an Employee sees only their own days, a Leader sees theirs plus everyone
 * in the teams they lead, and a Manager sees everybody. `scope=mine` narrows
 * that to the reader themselves; `user_id` narrows it to one person, and is
 * refused when that person is outside the reader's scope.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);
    const scope = await dailyUpdateScope(user);

    const where: string[] = [];
    const params: unknown[] = [];

    const target = sp.get('user_id');
    const wants = sp.get('scope') ?? 'mine';

    if (target) {
      const id = Number(target);
      if (!Number.isFinite(id)) throw forbidden('That is not a person.');
      if (id !== user.id && (scope.userIds !== null && !scope.userIds.includes(id))) {
        throw forbidden(
          user.role === 'EMPLOYEE'
            ? 'You can only view your own daily updates.'
            : 'That person is not in a team you lead.',
        );
      }
      where.push('d.user_id = ?');
      params.push(id);
    } else if (wants === 'mine' || !scope.canViewOthers) {
      where.push('d.user_id = ?');
      params.push(user.id);
    } else if (scope.userIds === null) {
      // Manager, whole company.
      where.push('1 = 1');
    } else {
      where.push('d.user_id IN (?)');
      params.push(scope.userIds);
    }

    for (const [key, sql] of [
      ['from', 'd.update_date >= ?'],
      ['to', 'd.update_date <= ?'],
      ['date', 'd.update_date = ?'],
    ] as const) {
      const value = sp.get(key);
      if (value) {
        where.push(sql);
        params.push(value);
      }
    }

    const limit = intParam(sp, 'limit', 30, 200);

    // The long-form detail rides along with each update, so a reader never has
    // to fetch a second endpoint to see what the day actually contained.
    const updates = await query<{ id: number }>(
      `SELECT d.*, u.full_name, u.avatar_url, u.job_title, u.role AS author_role,
              t.name AS team_name, dep.name AS department_name,
              (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = d.id) AS item_count,
              dd.detailed_summary, dd.highlights, dd.achievements, dd.challenges, dd.learnings,
              dd.collaboration, dd.next_day_plan, dd.focus_area, dd.work_breakdown, dd.metrics,
              dd.github_metrics, dd.generated_by, dd.is_auto_submitted, dd.needs_review, dd.ai_used
         FROM tm_daily_updates d
         JOIN tm_users u ON u.id = d.user_id
         LEFT JOIN tm_teams t ON t.id = u.team_id
         LEFT JOIN tm_departments dep ON dep.id = u.department_id
         LEFT JOIN tm_daily_update_details dd ON dd.daily_update_id = d.id
        WHERE ${where.join(' AND ')}
        ORDER BY d.update_date DESC, d.id DESC
        LIMIT ?`,
      [...params, limit],
    );

    const ids = updates.map((u) => u.id);
    const items = ids.length
      ? await query(
          `SELECT i.*, t.task_number, t.title AS task_title, p.name AS project_name,
                  det.work_detail, det.technical_notes, det.impact, det.next_steps,
                  det.collaborators, det.repos, det.links, det.commit_shas, det.commit_count,
                  det.additions, det.deletions, det.files_changed, det.source AS detail_source
             FROM tm_daily_update_items i
             LEFT JOIN tm_tasks t ON t.id = i.task_id
             LEFT JOIN tm_projects p ON p.id = i.project_id
             LEFT JOIN tm_daily_update_item_details det ON det.daily_update_item_id = i.id
            WHERE i.daily_update_id IN (?) ORDER BY i.id`,
          [ids],
        )
      : [];

    // The people this reader may filter by — the picker never offers someone
    // the API would then refuse.
    const people = scope.canViewOthers
      ? await query(
          `SELECT u.id, u.full_name, u.email, u.avatar_url, u.role, u.job_title, t.name AS team_name
             FROM tm_users u
             LEFT JOIN tm_teams t ON t.id = u.team_id
            WHERE u.deleted_at IS NULL AND u.status = 'ACTIVE'
              ${scope.userIds === null ? '' : 'AND u.id IN (?)'}
            ORDER BY u.full_name`,
          scope.userIds === null ? [] : [scope.userIds],
        )
      : [];

    return NextResponse.json({
      updates,
      items,
      people,
      scope: { breadth: scope.breadth, can_view_others: scope.canViewOthers },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Saves a reviewed daily update.
 *
 * The payload is what the user confirmed on the review screen — AI output is
 * never written straight through. The write itself lives in `saveDailyUpdate`
 * so the unattended cut-off sweep files an identical record.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, dailyUpdateSchema);
    const result = await saveDailyUpdate(user, body);

    return NextResponse.json({
      ok: true,
      id: result.id,
      summary: result.summary,
      detailed_summary: result.detailed_summary,
      ai_used: result.ai_used,
      stats: result.stats,
      mail: result.mail,
      message: result.message,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
