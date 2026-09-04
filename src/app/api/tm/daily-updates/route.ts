import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { forbidden, intParam, parseBody, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { dailyUpdateSchema } from '@/lib/validation';
import { ledTeamIds } from '@/lib/tasks';
import { saveDailyUpdate } from '@/lib/dailyUpdates';

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

    // The long-form detail rides along with each update, so a reader never has
    // to fetch a second endpoint to see what the day actually contained.
    const updates = await query<{ id: number }>(
      `SELECT d.*, u.full_name, u.avatar_url, u.job_title,
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

    return NextResponse.json({ updates, items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Saves a reviewed daily update.
 *
 * The payload is what the user confirmed on the review screen — AI output is
 * never written straight through. The write itself lives in `saveDailyUpdate`
 * so the unattended 22:00 sweep files an identical record.
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
