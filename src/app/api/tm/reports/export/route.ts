import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { audit, requirePermission, searchParams, toErrorResponse } from '@/lib/api';
import { ledTeamIds, taskScope } from '@/lib/tasks';

/** RFC 4180 escaping, with a guard against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(','));
  return '﻿' + lines.join('\r\n');
}

export async function GET(req: Request) {
  try {
    const user = await requirePermission('tm.report.export');
    const sp = searchParams(req);
    const dataset = sp.get('dataset') ?? 'tasks';

    let rows: Array<Record<string, unknown>> = [];
    let filename = 'task-management-export';

    if (dataset === 'tasks') {
      const scope = await taskScope(user, 't');
      const where = ['t.deleted_at IS NULL', scope.sql];
      const params: unknown[] = [...scope.params];

      for (const [key, col] of [
        ['project_id', 't.project_id'],
        ['team_id', 't.team_id'],
        ['department_id', 't.department_id'],
        ['assignee_id', 't.assignee_id'],
        ['status', 't.status'],
        ['priority', 't.priority'],
      ] as const) {
        const v = sp.get(key);
        if (v && v !== 'ALL') {
          where.push(`${col} = ?`);
          params.push(v);
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

      rows = await query(
        `SELECT t.task_number AS 'Task ID', t.title AS 'Task', p.name AS 'Project',
                a.full_name AS 'Assignee', c.full_name AS 'Created By',
                tm.name AS 'Team', d.name AS 'Department',
                t.priority AS 'Priority', t.status AS 'Status', t.progress AS 'Progress %',
                t.estimated_hours AS 'Estimated Hours', t.actual_hours AS 'Actual Hours',
                DATE_FORMAT(t.created_at, '%Y-%m-%d') AS 'Created',
                DATE_FORMAT(t.deadline, '%Y-%m-%d %H:%i') AS 'Deadline',
                DATE_FORMAT(t.completed_at, '%Y-%m-%d %H:%i') AS 'Completed',
                IF(t.deadline IS NOT NULL AND t.completed_at IS NOT NULL AND t.completed_at <= t.deadline, 'Yes',
                   IF(t.completed_at IS NOT NULL, 'No', '')) AS 'On Time'
           FROM tm_tasks t
           LEFT JOIN tm_users a ON a.id = t.assignee_id
           LEFT JOIN tm_users c ON c.id = t.created_by
           LEFT JOIN tm_projects p ON p.id = t.project_id
           LEFT JOIN tm_teams tm ON tm.id = t.team_id
           LEFT JOIN tm_departments d ON d.id = t.department_id
          WHERE ${where.join(' AND ')}
          ORDER BY t.created_at DESC
          LIMIT 10000`,
        params,
      );
      filename = 'tm-tasks';
    } else if (dataset === 'daily-updates') {
      const teamFilter =
        user.role === 'MANAGER' ? '' : 'AND u.team_id IN (?)';
      const teams = user.role === 'MANAGER' ? [] : [await ledTeamIds(user.id)];
      if (user.role !== 'MANAGER' && !(teams[0] as number[]).length) {
        rows = [];
      } else {
        rows = await query(
          `SELECT DATE_FORMAT(d.update_date, '%Y-%m-%d') AS 'Date', u.full_name AS 'Person',
                  t.name AS 'Team', d.status AS 'Status', d.total_hours AS 'Hours',
                  (SELECT COUNT(*) FROM tm_daily_update_items i WHERE i.daily_update_id = d.id) AS 'Items',
                  d.summary AS 'Summary'
             FROM tm_daily_updates d
             JOIN tm_users u ON u.id = d.user_id
             LEFT JOIN tm_teams t ON t.id = u.team_id
            WHERE 1 = 1 ${teamFilter}
            ORDER BY d.update_date DESC LIMIT 10000`,
          user.role === 'MANAGER' ? [] : teams,
        );
      }
      filename = 'tm-daily-updates';
    } else if (dataset === 'workload') {
      rows = await query(
        `SELECT u.full_name AS 'Person', d.name AS 'Department', tm.name AS 'Team', u.role AS 'Role',
                COUNT(t.id) AS 'Open Tasks',
                SUM(t.priority = 'CRITICAL') AS 'Critical',
                SUM(t.deadline < NOW()) AS 'Overdue',
                ROUND(COALESCE(SUM(COALESCE(t.estimated_hours,0) * (100 - t.progress) / 100), 0), 1) AS 'Remaining Hours'
           FROM tm_users u
           LEFT JOIN tm_tasks t ON t.assignee_id = u.id AND t.deleted_at IS NULL
                AND t.status NOT IN ('COMPLETED','CANCELLED')
           LEFT JOIN tm_departments d ON d.id = u.department_id
           LEFT JOIN tm_teams tm ON tm.id = u.team_id
          WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
          GROUP BY u.id, u.full_name, d.name, tm.name, u.role
          ORDER BY COUNT(t.id) DESC`,
      );
      filename = 'tm-workload';
    } else {
      return NextResponse.json({ error: 'Unknown export.' }, { status: 400 });
    }

    await audit(user.id, 'REPORT_EXPORTED', 'REPORT', null, null, { dataset, rows: rows.length });

    const csv = toCsv(rows as Array<Record<string, unknown>>);
    const stamp = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
