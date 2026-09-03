import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { forbidden, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { ledTeamIds } from '@/lib/tasks';
import { weeklyManagerSummary } from '@/lib/ai';

/**
 * Reporting dashboard. Every figure is a live aggregate over tm_tasks — the
 * module never reads Operations System tables for reporting.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    if (user.role === 'EMPLOYEE') throw forbidden('Reports are available to Leaders and Managers.');

    const where: string[] = ['t.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (user.role === 'LEADER') {
      const teams = await ledTeamIds(user.id);
      if (teams.length) {
        where.push('(t.team_id IN (?) OR t.created_by = ? OR t.assignee_id = ?)');
        params.push(teams, user.id, user.id);
      } else {
        where.push('(t.created_by = ? OR t.assignee_id = ?)');
        params.push(user.id, user.id);
      }
    }

    const from = sp.get('from');
    if (from) {
      where.push('t.created_at >= ?');
      params.push(from);
    }
    const to = sp.get('to');
    if (to) {
      where.push('t.created_at <= ?');
      params.push(to);
    }
    for (const [key, col] of [
      ['department_id', 't.department_id'],
      ['team_id', 't.team_id'],
      ['project_id', 't.project_id'],
      ['assignee_id', 't.assignee_id'],
      ['priority', 't.priority'],
      ['status', 't.status'],
    ] as const) {
      const v = sp.get(key);
      if (v && v !== 'ALL') {
        where.push(`${col} = ?`);
        params.push(v);
      }
    }
    const w = where.join(' AND ');

    const [overview, byStatus, byPriority, byDepartment, byTeam, trend, overdueTrend, workload, compliance] =
      await Promise.all([
        queryOne<Record<string, number>>(
          `SELECT COUNT(*) AS total,
                  SUM(t.status = 'COMPLETED') AS completed,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED')) AS open,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue,
                  SUM(t.status = 'BLOCKED') AS blocked,
                  SUM(t.priority = 'CRITICAL') AS critical,
                  AVG(CASE WHEN t.status = 'COMPLETED' THEN TIMESTAMPDIFF(HOUR, t.created_at, t.completed_at) END) AS avg_hours
             FROM tm_tasks t WHERE ${w}`,
          params,
        ),
        query(`SELECT t.status, COUNT(*) AS c FROM tm_tasks t WHERE ${w} GROUP BY t.status`, params),
        query(`SELECT t.priority, COUNT(*) AS c FROM tm_tasks t WHERE ${w} GROUP BY t.priority`, params),
        query(
          `SELECT d.name AS label, COUNT(*) AS total,
                  SUM(t.status = 'COMPLETED') AS completed,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue
             FROM tm_tasks t JOIN tm_departments d ON d.id = t.department_id
            WHERE ${w} GROUP BY d.id, d.name ORDER BY total DESC LIMIT 20`,
          params,
        ),
        query(
          `SELECT tm.name AS label, COUNT(*) AS total,
                  SUM(t.status = 'COMPLETED') AS completed,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue
             FROM tm_tasks t JOIN tm_teams tm ON tm.id = t.team_id
            WHERE ${w} GROUP BY tm.id, tm.name ORDER BY total DESC LIMIT 20`,
          params,
        ),
        query(
          `SELECT DATE(t.created_at) AS day, COUNT(*) AS created,
                  SUM(t.status = 'COMPLETED') AS completed
             FROM tm_tasks t WHERE ${w} AND t.created_at >= (NOW() - INTERVAL 30 DAY)
            GROUP BY DATE(t.created_at) ORDER BY day`,
          params,
        ),
        query(
          `SELECT DATE(t.deadline) AS day, COUNT(*) AS overdue
             FROM tm_tasks t
            WHERE ${w} AND t.deadline BETWEEN (NOW() - INTERVAL 30 DAY) AND NOW()
              AND t.status NOT IN ('COMPLETED','CANCELLED')
            GROUP BY DATE(t.deadline) ORDER BY day`,
          params,
        ),
        query(
          `SELECT u.id, u.full_name, u.avatar_url,
                  COUNT(t.id) AS total,
                  SUM(t.status = 'COMPLETED') AS completed,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED')) AS open,
                  SUM(t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue
             FROM tm_tasks t JOIN tm_users u ON u.id = t.assignee_id
            WHERE ${w} GROUP BY u.id, u.full_name, u.avatar_url
            ORDER BY total DESC LIMIT 25`,
          params,
        ),
        query(
          `SELECT u.full_name, COUNT(d.id) AS updates
             FROM tm_users u
             LEFT JOIN tm_daily_updates d ON d.user_id = u.id AND d.status = 'SUBMITTED'
                  AND d.update_date >= (CURDATE() - INTERVAL 30 DAY)
            WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
            GROUP BY u.id, u.full_name ORDER BY updates DESC LIMIT 25`,
        ),
      ]);

    const projects = await query(
      `SELECT p.id, p.name, p.status, p.target_date,
              COUNT(t.id) AS total,
              SUM(t.status = 'COMPLETED') AS completed,
              SUM(t.status NOT IN ('COMPLETED','CANCELLED') AND t.deadline < NOW()) AS overdue,
              SUM(t.status = 'BLOCKED') AS blocked
         FROM tm_projects p LEFT JOIN tm_tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
        WHERE p.deleted_at IS NULL AND p.status IN ('PLANNING','ACTIVE','ON_HOLD')
        GROUP BY p.id, p.name, p.status, p.target_date
        ORDER BY overdue DESC, total DESC LIMIT 20`,
    );

    return NextResponse.json({
      overview: Object.fromEntries(Object.entries(overview ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
      by_status: byStatus,
      by_priority: byPriority,
      by_department: byDepartment,
      by_team: byTeam,
      trend,
      overdue_trend: overdueTrend,
      workload,
      daily_update_compliance: compliance,
      projects,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** AI weekly narrative for Managers, built from the same live aggregates. */
export async function POST() {
  try {
    const user = await requireUser();
    if (user.role === 'EMPLOYEE') throw forbidden('Reports are available to Leaders and Managers.');

    const stats = await queryOne<Record<string, number>>(
      `SELECT COUNT(*) AS planned,
              SUM(status = 'COMPLETED') AS completed,
              SUM(status NOT IN ('COMPLETED','CANCELLED') AND deadline < NOW()) AS overdue,
              SUM(status = 'BLOCKED') AS blocked,
              SUM(priority = 'CRITICAL' AND status NOT IN ('COMPLETED','CANCELLED')) AS open_critical
         FROM tm_tasks
        WHERE deleted_at IS NULL AND created_at >= (NOW() - INTERVAL 7 DAY)`,
    );

    const topBlocked = await query<{ title: string }>(
      `SELECT title FROM tm_tasks WHERE deleted_at IS NULL AND status = 'BLOCKED' ORDER BY updated_at DESC LIMIT 5`,
    );

    const summary = await weeklyManagerSummary(user.id, {
      ...Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
      blocked_examples: topBlocked.map((t) => t.title),
    });

    return NextResponse.json({
      summary: summary.data,
      ai_used: summary.ok,
      message: summary.ok ? null : 'AI analysis unavailable. The figures below are calculated from your data.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
