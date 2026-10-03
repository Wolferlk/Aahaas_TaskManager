import { NextResponse } from 'next/server';
import { audit, badRequest, requirePermission, searchParams, toErrorResponse } from '@/lib/api';
import {
  buildMonthlyReport,
  countBy,
  isOpenAtEnd,
  isOverdueAtEnd,
  parseMonth,
  type ReportFilters,
} from '@/lib/monthlyReport';
import { buildMonthlyWorkbook, reportPeople } from '@/lib/monthlyWorkbook';

function idParam(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key);
  if (!raw || raw === 'ALL') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${key}.`);
  return n;
}

/**
 * GET /api/tm/reports/monthly?month=2026-09&tz=-330[&team_id&project_id&assignee_id&daily_updates=1]
 *
 * format=json returns the headline numbers for the export dialog's preview;
 * anything else streams the designed .xlsx workbook.
 */
export async function GET(req: Request) {
  try {
    const user = await requirePermission('tm.report.export');
    const sp = searchParams(req);
    const range = parseMonth(sp.get('month'), sp.get('tz'));
    const filters: ReportFilters = {
      team_id: idParam(sp, 'team_id'),
      project_id: idParam(sp, 'project_id'),
      assignee_id: idParam(sp, 'assignee_id'),
    };
    const includeDailyUpdates = sp.get('daily_updates') !== '0';
    const asJson = sp.get('format') === 'json';

    const report = await buildMonthlyReport(user, range, filters, { includeDailyUpdates });

    if (asJson) {
      const { tasks } = report;
      return NextResponse.json({
        month: { key: range.key, label: range.label },
        previous: { key: report.previous.key, label: report.previous.label },
        kpis: report.kpis,
        previous_kpis: report.previousKpis,
        daily: report.daily.map((d) => ({ day: d.day, created: d.created, completed: d.completed })),
        by_status: Object.fromEntries(countBy(tasks, (t) => t.status)),
        sheets: {
          tasks: tasks.length,
          people: new Set(tasks.map((t) => t.assignee_id ?? 0)).size,
          projects: new Set(tasks.map((t) => t.project_id ?? 0)).size,
          teams: new Set(tasks.map((t) => t.team_id ?? 0)).size,
          attention: tasks.filter((t) => isOpenAtEnd(t, range) && (isOverdueAtEnd(t, range) || t.status === 'BLOCKED')).length,
          daily_updates: report.dailyUpdates ? new Set(report.dailyUpdates.map((d) => d.user_id)).size : null,
          person_tabs: reportPeople(report).length,
        },
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const file = await buildMonthlyWorkbook(report);

    await audit(user.id, 'REPORT_EXPORTED', 'REPORT', null, null, {
      dataset: 'monthly-xlsx',
      month: range.key,
      rows: report.tasks.length,
      ...filters,
    });

    const filename = `Aahaas-Task-Report-${range.key}-${range.label.split(' ')[0]}.xlsx`;
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
