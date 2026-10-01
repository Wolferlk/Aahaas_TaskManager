import 'server-only';
import ExcelJS from 'exceljs';
import {
  computeKpis,
  countBy,
  cycleDays,
  groupStats,
  isOpenAtEnd,
  isOverdueAtEnd,
  monthActivity,
  onTimeFlag,
  round1,
  toLocal,
  type GroupStats,
  type Kpis,
  type MonthlyReport,
  type ReportTask,
} from './monthlyReport';

/**
 * Renders a MonthlyReport as a designed workbook rather than a data dump:
 * a dashboard-style Overview, a calendar heatmap, the full task register and
 * per-person / project / team scorecards, a follow-up list and (optionally) a
 * daily-update hours heatmap.
 *
 * Everything visual is plain cell styling — fills, merged cells, unicode bars,
 * colour scales — so the file looks the same in Excel, Numbers, LibreOffice
 * and Google Sheets. No charts or data bars, which several of those drop.
 */

/* ------------------------------------------------------------------ *
 * Design tokens
 * ------------------------------------------------------------------ */

const FONT = 'Aptos';

const C = {
  ink: 'FF0F172A',
  body: 'FF334155',
  muted: 'FF64748B',
  faint: 'FF94A3B8',
  line: 'FFE2E8F0',
  canvas: 'FFF4F6FA',
  card: 'FFFFFFFF',
  zebra: 'FFF8FAFC',
  brand: 'FFE6182D',
  brandSoft: 'FFFFF0F1',
  dark: 'FF111827',
  header: 'FF1F2937',
  good: 'FF059669',
  bad: 'FFDC2626',
  warn: 'FFD97706',
  info: 'FF2563EB',
  violet: 'FF7C3AED',
};

type Pair = [fill: string, font: string];

const STATUS: Record<string, Pair> = {
  DRAFT: ['FFF1F5F9', 'FF64748B'],
  TODO: ['FFE2E8F0', 'FF334155'],
  IN_PROGRESS: ['FFDBEAFE', 'FF1D4ED8'],
  REOPENED: ['FFE0E7FF', 'FF4338CA'],
  BLOCKED: ['FFFEE2E2', 'FFB91C1C'],
  WAITING: ['FFFEF3C7', 'FFB45309'],
  REVIEW: ['FFF3E8FF', 'FF7E22CE'],
  COMPLETED: ['FFD1FAE5', 'FF047857'],
  REJECTED: ['FFFFE4E6', 'FFBE123C'],
  CANCELLED: ['FFF1F5F9', 'FF94A3B8'],
};

const PRIORITY: Record<string, Pair> = {
  CRITICAL: ['FFFEE2E2', 'FFB91C1C'],
  HIGH: ['FFFFEDD5', 'FFC2410C'],
  MEDIUM: ['FFFEF3C7', 'FFB45309'],
  LOW: ['FFE0F2FE', 'FF0369A1'],
};

const HEALTH: Record<string, Pair> = {
  HEALTHY: ['FFD1FAE5', 'FF047857'],
  NEEDS_ATTENTION: ['FFFEF3C7', 'FFB45309'],
  AT_RISK: ['FFFFEDD5', 'FFC2410C'],
  CRITICAL: ['FFFEE2E2', 'FFB91C1C'],
};

const HEAT_GREEN = ['FFF8FAFC', 'FFD1FAE5', 'FFA7F3D0', 'FF6EE7B7', 'FF34D399', 'FF10B981'];
const HEAT_BLUE = ['FFFFFFFF', 'FFDBEAFE', 'FFBFDBFE', 'FF93C5FD', 'FF60A5FA', 'FF3B82F6'];

const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'REOPENED', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DRAFT'];
const PRIORITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/* ------------------------------------------------------------------ *
 * Styling helpers
 * ------------------------------------------------------------------ */

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function font(size = 10, color = C.body, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: FONT, size, color: { argb: color }, ...extra };
}

const thin = (argb = C.line): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });

function humanise(code: string | null | undefined): string {
  if (!code) return '';
  if (code === 'TODO') return 'To Do';
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function duration(days: number): string {
  if (days < 1) {
    const hours = days * 24;
    return hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} hours`;
  }
  return `${days.toFixed(1)} days`;
}

function bar(share: number, width = 20): string {
  if (!Number.isFinite(share) || share <= 0) return '';
  return '█'.repeat(Math.max(1, Math.round(share * width)));
}

function heat(scale: string[], value: number, max: number): string {
  if (value <= 0 || max <= 0) return scale[0];
  return scale[Math.min(scale.length - 1, Math.max(1, Math.ceil((value / max) * (scale.length - 1))))];
}

function pill(cell: ExcelJS.Cell, label: string, pair: Pair | undefined) {
  cell.value = label;
  if (!pair) return;
  cell.fill = fill(pair[0]);
  cell.font = font(9, pair[1], { bold: true });
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/** Lays the sheet's background so cards and tables read as panels on it. */
function paintCanvas(ws: ExcelJS.Worksheet, rows: number, cols: number) {
  for (let r = 1; r <= rows; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) row.getCell(c).fill = fill(C.canvas);
  }
}

function merge(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number): ExcelJS.Cell {
  if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
  return ws.getCell(r1, c1);
}

/** Dark title band with a brand-red strip under it — shared by every sheet. */
function banner(ws: ExcelJS.Worksheet, report: MonthlyReport, title: string, subtitle: string, lastCol: number) {
  ws.getRow(1).height = 10;
  ws.getRow(2).height = 34;
  ws.getRow(3).height = 20;
  ws.getRow(4).height = 6;

  for (let c = 1; c <= lastCol; c++) {
    ws.getCell(1, c).fill = fill(C.dark);
    ws.getCell(2, c).fill = fill(C.dark);
    ws.getCell(3, c).fill = fill(C.dark);
    ws.getCell(4, c).fill = fill(C.brand);
  }

  // Narrow sheets have no room for the month badge beside the title.
  const wide = lastCol >= 8;
  const titleEnd = wide ? lastCol - 4 : lastCol - 1;

  const t = merge(ws, 2, 2, 2, titleEnd);
  t.value = title;
  t.font = font(20, 'FFFFFFFF', { bold: true });
  t.alignment = { vertical: 'middle' };

  const s = merge(ws, 3, 2, 3, titleEnd);
  s.value = wide ? subtitle : `${report.range.label}  ·  ${subtitle}`;
  s.font = font(10, 'FFCBD5E1');
  s.alignment = { vertical: 'top' };

  if (!wide) return;
  const badge = merge(ws, 2, lastCol - 3, 3, lastCol - 1);
  badge.value = { richText: [
    { text: report.range.label.toUpperCase() + '\n', font: font(12, 'FFFFFFFF', { bold: true }) },
    { text: 'Aahaas Task Management', font: font(9, 'FFFCA5A5') },
  ] };
  badge.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
}

function sectionTitle(ws: ExcelJS.Worksheet, row: number, c1: number, c2: number, text: string, hint?: string) {
  const cell = merge(ws, row, c1, row, c2);
  cell.value = hint
    ? { richText: [{ text, font: font(12, C.ink, { bold: true }) }, { text: `   ${hint}`, font: font(9, C.muted) }] }
    : text;
  if (!hint) cell.font = font(12, C.ink, { bold: true });
  cell.alignment = { vertical: 'bottom' };
  ws.getRow(row).height = 24;
  for (let c = c1; c <= c2; c++) ws.getCell(row, c).border = { bottom: { style: 'medium', color: { argb: C.brand } } };
}

/** Header row for a data table: dark fill, white bold, wrapped. */
function tableHeader(ws: ExcelJS.Worksheet, row: number, startCol: number, headers: string[]) {
  const r = ws.getRow(row);
  r.height = 30;
  headers.forEach((h, i) => {
    const cell = r.getCell(startCol + i);
    cell.value = h;
    cell.fill = fill(C.header);
    cell.font = font(9, 'FFFFFFFF', { bold: true });
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
    cell.border = { bottom: thin(C.header) };
  });
}

function bodyCell(cell: ExcelJS.Cell, zebra: boolean) {
  cell.fill = fill(zebra ? C.zebra : C.card);
  cell.font = font(10, C.body);
  cell.border = { bottom: thin() };
  cell.alignment = { vertical: 'middle', ...(cell.alignment ?? {}) };
}

function printSetup(ws: ExcelJS.Worksheet, report: MonthlyReport, landscape = true) {
  ws.pageSetup = {
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
  };
  ws.headerFooter = {
    oddFooter: `&L&8Aahaas Task Management · ${report.range.label}&C&8&A&R&8Page &P of &N`,
  };
}

/** A percentage cell coloured red → amber → green. */
function rateScale(ws: ExcelJS.Worksheet, ref: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'colorScale',
        priority: 1,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.5 }, { type: 'num', value: 1 }],
        color: [{ argb: 'FFFECACA' }, { argb: 'FFFEF3C7' }, { argb: 'FFBBF7D0' }],
      },
    ],
  });
}

const LINK_BASE = (process.env.TM_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const taskLink = (t: ReportTask) => `${LINK_BASE}/tm/tasks/team?task=${t.id}`;

function shortDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

interface KpiCard {
  label: string;
  value: number | null;
  fmt: string;
  accent: string;
  hint: string;
  delta: { now: number | null; prev: number | null; better: 'up' | 'down'; kind: 'count' | 'pts' | 'days' };
}

function deltaText(d: KpiCard['delta'], prevLabel: string): { text: string; color: string } {
  if (d.now === null || d.prev === null) return { text: `No ${prevLabel} data to compare`, color: C.faint };
  const diff = d.now - d.prev;
  const shown =
    d.kind === 'pts' ? `${Math.abs(Math.round(diff * 100))} pts`
      : d.kind === 'days' ? `${Math.abs(diff).toFixed(1)} days`
        : `${Math.abs(Math.round(diff))}`;
  if (Math.abs(diff) < (d.kind === 'count' ? 0.5 : 0.005)) return { text: `● Same as ${prevLabel}`, color: C.muted };
  const up = diff > 0;
  const good = (up && d.better === 'up') || (!up && d.better === 'down');
  return { text: `${up ? '▲' : '▼'} ${shown} vs ${prevLabel}`, color: good ? C.good : C.bad };
}

function drawCard(ws: ExcelJS.Worksheet, row: number, col: number, card: KpiCard, prevLabel: string) {
  const span = col + 2;
  for (let r = row; r <= row + 3; r++) {
    for (let c = col; c <= span; c++) {
      const cell = ws.getCell(r, c);
      cell.fill = fill(C.card);
      cell.border = {
        top: r === row ? { style: 'thick', color: { argb: card.accent } } : undefined,
        bottom: r === row + 3 ? thin() : undefined,
        left: c === col ? thin() : undefined,
        right: c === span ? thin() : undefined,
      };
    }
  }

  const label = merge(ws, row, col, row, span);
  label.value = card.label.toUpperCase();
  label.font = font(8, C.muted, { bold: true });
  label.alignment = { vertical: 'bottom', indent: 1 };

  const value = merge(ws, row + 1, col, row + 1, span);
  value.value = card.value ?? '—';
  value.numFmt = card.fmt;
  value.font = font(24, C.ink, { bold: true });
  value.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const delta = deltaText(card.delta, prevLabel);
  const d = merge(ws, row + 2, col, row + 2, span);
  d.value = delta.text;
  d.font = font(9, delta.color, { bold: true });
  d.alignment = { vertical: 'middle', indent: 1 };

  const hint = merge(ws, row + 3, col, row + 3, span);
  hint.value = card.hint;
  hint.font = font(8, C.faint);
  hint.alignment = { vertical: 'top', indent: 1 };
}

function cards(k: Kpis, p: Kpis): KpiCard[] {
  const withDeadline = k.onTime + k.late;
  return [
    {
      label: 'Tasks in play', value: k.active, fmt: '#,##0', accent: C.ink,
      hint: 'Alive at any point this month',
      delta: { now: k.active, prev: p.active, better: 'up', kind: 'count' },
    },
    {
      label: 'New tasks', value: k.created, fmt: '#,##0', accent: C.info,
      hint: 'Created during the month',
      delta: { now: k.created, prev: p.created, better: 'up', kind: 'count' },
    },
    {
      label: 'Completed', value: k.completed, fmt: '#,##0', accent: C.good,
      hint: `${k.cancelled} cancelled or rejected`,
      delta: { now: k.completed, prev: p.completed, better: 'up', kind: 'count' },
    },
    {
      label: 'Completion rate', value: k.completionRate, fmt: '0%', accent: C.violet,
      hint: 'Completed ÷ tasks in play',
      delta: { now: k.completionRate, prev: p.completionRate, better: 'up', kind: 'pts' },
    },
    {
      label: 'On-time delivery', value: k.onTimeRate, fmt: '0%', accent: C.good,
      hint: withDeadline ? `${k.onTime} of ${withDeadline} finished by deadline` : 'No completed task had a deadline',
      delta: { now: k.onTimeRate, prev: p.onTimeRate, better: 'up', kind: 'pts' },
    },
    {
      label: 'Overdue at month end', value: k.overdue, fmt: '#,##0', accent: C.bad,
      hint: 'Open and past deadline',
      delta: { now: k.overdue, prev: p.overdue, better: 'down', kind: 'count' },
    },
    {
      label: 'Avg cycle time',
      value: k.avgCycleDays === null ? null : k.avgCycleDays < 1 ? round1(k.avgCycleDays * 24) : round1(k.avgCycleDays),
      fmt: k.avgCycleDays !== null && k.avgCycleDays < 1 ? '0.0 "hours"' : '0.0 "days"',
      accent: C.warn,
      hint: 'Start → completion, completed tasks',
      delta: { now: k.avgCycleDays, prev: p.avgCycleDays, better: 'down', kind: 'days' },
    },
    {
      label: 'Carried forward', value: k.carriedOver, fmt: '#,##0', accent: C.brand,
      hint: `Still open at month end · ${k.blocked} blocked`,
      delta: { now: k.carriedOver, prev: p.carriedOver, better: 'down', kind: 'count' },
    },
  ];
}

/** label | count | share | bar — the left or right half of the Overview. */
function breakdown(
  ws: ExcelJS.Worksheet,
  row: number,
  col: number,
  rows: Array<{ label: string; count: number; pair?: Pair; color?: string }>,
  total: number,
): number {
  tableHeader(ws, row, col, ['', '', 'Tasks', 'Share', '', '']);
  merge(ws, row, col, row, col + 1);
  merge(ws, row, col + 4, row, col + 5);
  let r = row + 1;
  rows.forEach((item, i) => {
    for (let c = col; c <= col + 5; c++) bodyCell(ws.getCell(r, c), i % 2 === 1);
    const label = merge(ws, r, col, r, col + 1);
    label.value = item.label;
    if (item.pair) {
      label.font = font(10, item.pair[1], { bold: true });
    }
    label.alignment = { vertical: 'middle', indent: 1 };
    const count = ws.getCell(r, col + 2);
    count.value = item.count;
    count.alignment = { horizontal: 'center', vertical: 'middle' };
    count.font = font(10, C.ink, { bold: true });
    const share = ws.getCell(r, col + 3);
    share.value = total ? item.count / total : 0;
    share.numFmt = '0%';
    share.alignment = { horizontal: 'center', vertical: 'middle' };
    const b = merge(ws, r, col + 4, r, col + 5);
    b.value = bar(total ? item.count / total : 0, 18);
    b.font = font(9, item.color ?? item.pair?.[1] ?? C.brand);
    ws.getRow(r).height = 18;
    r++;
  });
  if (!rows.length) {
    const empty = merge(ws, r, col, r, col + 5);
    empty.value = 'Nothing to show for this month.';
    empty.font = font(9, C.faint, { italic: true });
    r++;
  }
  return r;
}

function overviewSheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const ws = wb.addWorksheet('Overview', {
    properties: { tabColor: { argb: C.brand } },
    views: [{ showGridLines: false, zoomScale: 100 }],
  });
  const LAST = 14;
  ws.columns = [{ width: 2.5 }, ...Array.from({ length: 12 }, () => ({ width: 11.5 })), { width: 2.5 }];
  paintCanvas(ws, 90, LAST);

  const { kpis: k, previousKpis: p, range, previous, tasks } = report;
  const who = `${report.generatedBy.full_name} (${humanise(report.generatedBy.role)})`;
  const generated = toLocal(report.generatedAt, range.tz).toISOString().slice(0, 16).replace('T', ' ');
  banner(
    ws,
    report,
    'Monthly Task Report',
    `${range.label}  ·  Generated ${generated} by ${who}  ·  ${report.filterLabels.length ? report.filterLabels.join(' · ') : 'All tasks visible to you'}`,
    LAST,
  );

  // KPI cards — two rows of four
  const list = cards(k, p);
  ws.getRow(6).height = 8;
  [7, 12].forEach((top, rowIdx) => {
    ws.getRow(top).height = 20;
    ws.getRow(top + 1).height = 40;
    ws.getRow(top + 2).height = 16;
    ws.getRow(top + 3).height = 18;
    for (let i = 0; i < 4; i++) drawCard(ws, top, 2 + i * 3, list[rowIdx * 4 + i], previous.shortLabel);
  });
  ws.getRow(11).height = 8;

  // Status & priority
  let row = 17;
  ws.getRow(16).height = 8;
  sectionTitle(ws, row, 2, 7, 'Status', 'as of today');
  sectionTitle(ws, row, 8, 13, 'Priority mix');
  row++;
  const byStatus = countBy(tasks, (t) => t.status);
  const statusRows = STATUS_ORDER.filter((s) => byStatus.get(s)).map((s) => ({
    label: humanise(s), count: byStatus.get(s) ?? 0, pair: STATUS[s],
  }));
  const byPriority = countBy(tasks, (t) => t.priority);
  const priorityRows = PRIORITY_ORDER.filter((s) => byPriority.get(s)).map((s) => ({
    label: humanise(s), count: byPriority.get(s) ?? 0, pair: PRIORITY[s],
  }));
  const endA = breakdown(ws, row, 2, statusRows, tasks.length);
  const endB = breakdown(ws, row, 8, priorityRows, tasks.length);
  row = Math.max(endA, endB) + 1;

  // Weekly rhythm & task types
  sectionTitle(ws, row, 2, 7, 'Weekly rhythm', 'completed per week');
  sectionTitle(ws, row, 8, 13, 'Kind of work');
  row++;
  const weeks: Array<{ label: string; count: number; color: string }> = [];
  for (let start = 1; start <= range.days; start += 7) {
    const end = Math.min(range.days, start + 6);
    const slice = report.daily.slice(start - 1, end);
    const done = slice.reduce((s, d) => s + d.completed, 0);
    const created = slice.reduce((s, d) => s + d.created, 0);
    weeks.push({
      label: `W${Math.ceil(start / 7)} · ${start}–${end} ${range.shortLabel}  (+${created} new)`,
      count: done,
      color: C.good,
    });
  }
  const totalDone = Math.max(1, weeks.reduce((s, w) => s + w.count, 0));
  const byType = countBy(tasks, (t) => t.task_type);
  const typeRows = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ label: humanise(type), count, color: C.info }));
  const endC = breakdown(ws, row, 2, weeks, totalDone);
  const endD = breakdown(ws, row, 8, typeRows, tasks.length);
  row = Math.max(endC, endD) + 1;

  // Highlights
  sectionTitle(ws, row, 2, 13, 'Highlights', 'what stood out this month');
  row++;
  for (const line of highlights(report)) {
    for (let c = 2; c <= 13; c++) ws.getCell(row, c).fill = fill(C.card);
    const cell = merge(ws, row, 2, row, 13);
    cell.value = { richText: [
      { text: `${line.icon}  `, font: font(11) },
      { text: line.title, font: font(10, C.ink, { bold: true }) },
      { text: `  ${line.text}`, font: font(10, C.body) },
    ] };
    cell.alignment = { vertical: 'middle', indent: 1 };
    cell.border = { bottom: thin() };
    ws.getRow(row).height = 22;
    row++;
  }

  row++;
  const foot = merge(ws, row, 2, row, 13);
  foot.value = 'Tip: every task ID in “All Tasks” links straight to the task in the app. Definitions are on the “How to Read” sheet.';
  foot.font = font(9, C.muted, { italic: true });

  printSetup(ws, report, false);
}

function highlights(report: MonthlyReport): Array<{ icon: string; title: string; text: string }> {
  const { tasks, range, kpis: k } = report;
  const out: Array<{ icon: string; title: string; text: string }> = [];
  const people = groupStats(tasks.filter((t) => t.assignee_id), range, (t) => ({
    key: String(t.assignee_id), label: t.assignee_name ?? 'Unknown',
  }));

  const top = people.find((p) => p.completed > 0);
  if (top) out.push({ icon: '🏆', title: 'Top finisher', text: `${top.label} completed ${top.completed} task${top.completed === 1 ? '' : 's'}.` });

  const fastest = people
    .filter((p) => p.completed >= 3 && p.avgCycleDays !== null)
    .sort((a, b) => (a.avgCycleDays ?? 0) - (b.avgCycleDays ?? 0))[0];
  if (fastest) out.push({ icon: '⚡', title: 'Fastest turnaround', text: `${fastest.label} averaged ${duration(fastest.avgCycleDays!)} from start to done.` });

  const reliable = people
    .filter((p) => p.onTimeRate !== null && p.completed >= 3)
    .sort((a, b) => (b.onTimeRate ?? 0) - (a.onTimeRate ?? 0) || b.completed - a.completed)[0];
  if (reliable) out.push({ icon: '🎯', title: 'Most reliable', text: `${reliable.label} hit ${Math.round((reliable.onTimeRate ?? 0) * 100)}% of deadlines.` });

  const busiest = [...report.daily].sort((a, b) => b.completed - a.completed)[0];
  if (busiest?.completed) {
    const weekday = busiest.date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    out.push({ icon: '🔥', title: 'Busiest day', text: `${weekday} ${shortDate(busiest.date)} — ${busiest.completed} tasks completed.` });
  }

  const projects = groupStats(tasks.filter((t) => t.project_id), range, (t) => ({
    key: String(t.project_id), label: t.project_name ?? 'Unknown',
  }));
  if (projects[0]?.total) out.push({ icon: '📁', title: 'Most active project', text: `${projects[0].label} — ${projects[0].total} tasks, ${projects[0].completed} completed.` });

  const overdueLead = [...people].sort((a, b) => b.overdue - a.overdue)[0];
  if (overdueLead?.overdue) out.push({ icon: '⚠️', title: 'Needs support', text: `${overdueLead.label} has ${overdueLead.overdue} overdue task${overdueLead.overdue === 1 ? '' : 's'} at month end.` });

  if (k.actualHours || k.estimatedHours) {
    const ratio = k.estimatedHours ? Math.round((k.actualHours / k.estimatedHours) * 100) : null;
    out.push({
      icon: '⏱️', title: 'Effort',
      text: `${k.actualHours} h logged against ${k.estimatedHours} h estimated on completed tasks${ratio !== null ? ` (${ratio}% of estimate)` : ''}.`,
    });
  }
  if (k.reopened) out.push({ icon: '🔁', title: 'Rework', text: `${k.reopened} task${k.reopened === 1 ? ' was' : 's were'} reopened at least once.` });

  if (!out.length) out.push({ icon: '🌱', title: 'Quiet month', text: 'No completed work to highlight yet.' });
  return out;
}

/* ------------------------------------------------------------------ *
 * Daily activity: calendar heatmap + day-by-day table
 * ------------------------------------------------------------------ */

function activitySheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const ws = wb.addWorksheet('Daily Activity', {
    properties: { tabColor: { argb: 'FF10B981' } },
    views: [{ showGridLines: false }],
  });
  const LAST = 11;
  ws.columns = [{ width: 2.5 }, ...Array.from({ length: 9 }, () => ({ width: 15 })), { width: 2.5 }];
  paintCanvas(ws, 30 + report.range.days + 12, LAST);
  banner(ws, report, 'Daily Activity', 'Each square is a day — the greener it is, the more work was completed.', LAST);

  const { range, daily } = report;
  let row = 6;
  sectionTitle(ws, row, 2, 8, 'Completion calendar', '✓ completed  ·  + created');
  row++;

  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  names.forEach((n, i) => {
    const cell = ws.getCell(row, 2 + i);
    cell.value = n;
    cell.fill = fill(i >= 5 ? 'FF374151' : C.header);
    cell.font = font(9, 'FFFFFFFF', { bold: true });
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(row).height = 20;
  row++;

  const max = Math.max(1, ...daily.map((d) => d.completed));
  const firstWeekday = (daily[0].date.getUTCDay() + 6) % 7; // Monday = 0
  const weeks = Math.ceil((firstWeekday + range.days) / 7);
  for (let w = 0; w < weeks; w++) {
    ws.getRow(row + w).height = 46;
    for (let i = 0; i < 7; i++) {
      const cell = ws.getCell(row + w, 2 + i);
      const idx = w * 7 + i - firstWeekday;
      cell.border = { top: thin('FFFFFFFF'), left: thin('FFFFFFFF'), right: thin('FFFFFFFF'), bottom: thin('FFFFFFFF') };
      if (idx < 0 || idx >= range.days) {
        cell.fill = fill('FFEEF1F5');
        continue;
      }
      const d = daily[idx];
      const shade = heat(HEAT_GREEN, d.completed, max);
      const strong = shade === HEAT_GREEN[HEAT_GREEN.length - 1] || shade === HEAT_GREEN[HEAT_GREEN.length - 2];
      cell.fill = fill(shade);
      cell.value = { richText: [
        { text: `${d.day}\n`, font: font(11, strong ? 'FFFFFFFF' : C.ink, { bold: true }) },
        { text: d.completed || d.created ? `✓ ${d.completed}   + ${d.created}` : '·', font: font(8, strong ? 'FFF0FDF4' : C.muted) },
      ] };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }
  row += weeks;

  // legend
  const legend = ws.getCell(row, 2);
  legend.value = 'Less';
  legend.font = font(8, C.muted);
  legend.alignment = { horizontal: 'right' };
  const legendCell = merge(ws, row, 3, row, 4);
  legendCell.value = { richText: HEAT_GREEN.map((s) => ({ text: '■ ', font: font(14, s === HEAT_GREEN[0] ? 'FFE2E8F0' : s) })) };
  const more = ws.getCell(row, 5);
  more.value = 'More';
  more.font = font(8, C.muted);
  row += 2;

  // day-by-day table
  sectionTitle(ws, row, 2, 10, 'Day by day');
  row++;
  tableHeader(ws, row, 2, ['Date', 'Weekday', 'Created', 'Completed', 'Deadlines', 'Net flow', 'Completed (to date)', 'Completed', '']);
  merge(ws, row, 9, row, 10);
  const first = row + 1;
  let running = 0;
  daily.forEach((d, i) => {
    const r = row + 1 + i;
    running += d.completed;
    const weekend = [0, 6].includes(d.date.getUTCDay());
    for (let c = 2; c <= 10; c++) {
      bodyCell(ws.getCell(r, c), i % 2 === 1);
      if (weekend) ws.getCell(r, c).fill = fill('FFF1F5F9');
      if (c > 2) ws.getCell(r, c).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    ws.getCell(r, 2).value = d.date;
    ws.getCell(r, 2).numFmt = 'd mmm yyyy';
    ws.getCell(r, 3).value = d.date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    if (weekend) ws.getCell(r, 3).font = font(10, C.faint);
    ws.getCell(r, 4).value = d.created;
    ws.getCell(r, 5).value = d.completed;
    ws.getCell(r, 5).font = font(10, d.completed ? C.good : C.faint, { bold: !!d.completed });
    ws.getCell(r, 6).value = d.due;
    ws.getCell(r, 7).value = d.completed - d.created;
    ws.getCell(r, 7).numFmt = '+0;-0;0';
    ws.getCell(r, 7).font = font(10, d.completed - d.created > 0 ? C.good : d.completed - d.created < 0 ? C.bad : C.faint);
    ws.getCell(r, 8).value = running;
    const b = merge(ws, r, 9, r, 10);
    b.value = bar(d.completed / max, 22);
    b.font = font(9, 'FF10B981');
    b.alignment = { horizontal: 'left', vertical: 'middle' };
  });
  const last = row + daily.length;
  const totals = last + 1;
  ws.getCell(totals, 2).value = 'Total';
  ws.getCell(totals, 4).value = { formula: `SUM(D${first}:D${last})`, result: daily.reduce((s, d) => s + d.created, 0) };
  ws.getCell(totals, 5).value = { formula: `SUM(E${first}:E${last})`, result: running };
  ws.getCell(totals, 6).value = { formula: `SUM(F${first}:F${last})`, result: daily.reduce((s, d) => s + d.due, 0) };
  ws.getCell(totals, 7).value = { formula: `SUM(G${first}:G${last})`, result: running - daily.reduce((s, d) => s + d.created, 0) };
  ws.getCell(totals, 7).numFmt = '+0;-0;0';
  for (let c = 2; c <= 10; c++) {
    const cell = ws.getCell(totals, c);
    cell.fill = fill(C.brandSoft);
    cell.font = font(10, C.ink, { bold: true });
    cell.border = { top: { style: 'medium', color: { argb: C.brand } } };
    if (c > 2) cell.alignment = { horizontal: 'center' };
  }

  printSetup(ws, report, false);
}

/* ------------------------------------------------------------------ *
 * All tasks — the register
 * ------------------------------------------------------------------ */

interface Col {
  header: string;
  width: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  value: (t: ReportTask) => ExcelJS.CellValue;
}

function tasksSheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const { range } = report;
  const ws = wb.addWorksheet('All Tasks', { properties: { tabColor: { argb: C.info } } });
  const now = new Date();
  const cutoff = range.end < now ? range.end : now;
  const local = (d: Date | null) => (d ? toLocal(d, range.tz) : null);

  const daysLate = (t: ReportTask): number | null => {
    if (!t.deadline) return null;
    if (t.status === 'COMPLETED' && t.completed_at) {
      return t.completed_at > t.deadline ? Math.ceil((t.completed_at.getTime() - t.deadline.getTime()) / 86_400_000) : null;
    }
    return isOverdueAtEnd(t, range) ? Math.ceil((cutoff.getTime() - t.deadline.getTime()) / 86_400_000) : null;
  };

  const cols: Col[] = [
    { header: 'Task ID', width: 17, value: (t) => ({ text: t.task_number, hyperlink: taskLink(t), tooltip: 'Open in Aahaas' }) },
    { header: 'Task', width: 48, value: (t) => t.title },
    { header: 'This month', width: 21, value: (t) => monthActivity(t, range) },
    { header: 'Status', width: 13, align: 'center', value: (t) => humanise(t.status) },
    { header: 'Priority', width: 11, align: 'center', value: (t) => humanise(t.priority) },
    { header: 'Type', width: 11, align: 'center', value: (t) => humanise(t.task_type) },
    { header: 'Progress', width: 10, align: 'center', numFmt: '0"%"', value: (t) => t.progress },
    { header: 'Assignee', width: 21, value: (t) => t.assignee_name ?? 'Unassigned' },
    { header: 'Collaborators', width: 22, value: (t) => t.collaborators },
    { header: 'Created by', width: 19, value: (t) => t.creator_name },
    { header: 'Project', width: 20, value: (t) => t.project_name },
    { header: 'Team', width: 16, value: (t) => t.team_name },
    { header: 'Department', width: 14, value: (t) => t.department_name },
    { header: 'Created', width: 16, align: 'center', numFmt: 'd mmm yyyy h:mm', value: (t) => local(t.created_at) },
    { header: 'Start', width: 12, align: 'center', numFmt: 'd mmm yyyy', value: (t) => local(t.start_date) },
    { header: 'Deadline', width: 16, align: 'center', numFmt: 'd mmm yyyy h:mm', value: (t) => local(t.deadline) },
    {
      header: 'Deadline moved (days)', width: 11, align: 'center', numFmt: '+0;-0;0',
      value: (t) => (t.deadline && t.original_deadline
        ? Math.round((t.deadline.getTime() - t.original_deadline.getTime()) / 86_400_000) || null
        : null),
    },
    { header: 'Completed', width: 16, align: 'center', numFmt: 'd mmm yyyy h:mm', value: (t) => (t.status === 'COMPLETED' ? local(t.completed_at) : null) },
    { header: 'Cycle time (days)', width: 10, align: 'center', numFmt: '0.0', value: (t) => (t.status === 'COMPLETED' ? round1(cycleDays(t) ?? 0) : null) },
    {
      header: 'On time', width: 10, align: 'center',
      value: (t) => { const f = onTimeFlag(t); return f === null ? null : f ? '✓ Yes' : '✗ Late'; },
    },
    { header: 'Days late', width: 9, align: 'center', value: daysLate },
    { header: 'Est. hours', width: 9, align: 'center', numFmt: '0.0', value: (t) => t.estimated_hours },
    { header: 'Actual hours', width: 9, align: 'center', numFmt: '0.0', value: (t) => t.actual_hours },
    {
      header: 'Variance (h)', width: 10, align: 'center', numFmt: '+0.0;-0.0;0.0',
      value: (t) => (t.estimated_hours !== null && t.actual_hours !== null ? round1(t.actual_hours - t.estimated_hours) : null),
    },
    { header: 'Subtasks', width: 9, align: 'center', value: (t) => (t.subtask_count ? `${t.subtask_done}/${t.subtask_count}` : null) },
    { header: 'Checklist', width: 9, align: 'center', value: (t) => (t.checklist_count ? `${t.checklist_done}/${t.checklist_count}` : null) },
    { header: 'Comments', width: 9, align: 'center', value: (t) => t.comment_count || null },
    { header: 'Reopened', width: 9, align: 'center', value: (t) => t.reopen_count || null },
    { header: 'Tags', width: 18, value: (t) => t.tags },
    { header: 'Parent task', width: 15, value: (t) => t.parent_number },
    { header: 'Blocked reason', width: 30, value: (t) => t.blocked_reason },
    { header: 'Completion notes', width: 32, value: (t) => t.completion_notes },
    {
      header: 'Description', width: 60,
      value: (t) => {
        const text = (t.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return text ? (text.length > 600 ? text.slice(0, 597) + '…' : text) : null;
      },
    },
  ];

  ws.columns = [{ width: 2.5 }, ...cols.map((c) => ({ width: c.width }))];
  const LAST = cols.length + 1;
  banner(ws, report, 'All Tasks', `${report.tasks.length} tasks alive during ${range.label} — filter, sort and click any Task ID to open it.`, LAST);

  const HEADER = 6;
  ws.getRow(5).height = 8;
  tableHeader(ws, HEADER, 2, cols.map((c) => c.header));
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: HEADER, topLeftCell: 'D7', showGridLines: false }];

  const statusCol = 2 + cols.findIndex((c) => c.header === 'Status');
  const priorityCol = 2 + cols.findIndex((c) => c.header === 'Priority');
  const onTimeCol = 2 + cols.findIndex((c) => c.header === 'On time');
  const lateCol = 2 + cols.findIndex((c) => c.header === 'Days late');
  const varianceCol = 2 + cols.findIndex((c) => c.header === 'Variance (h)');
  const progressCol = 2 + cols.findIndex((c) => c.header === 'Progress');

  const sorted = [...report.tasks].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
      || (a.deadline?.getTime() ?? Infinity) - (b.deadline?.getTime() ?? Infinity),
  );

  sorted.forEach((t, i) => {
    const r = HEADER + 1 + i;
    const row = ws.getRow(r);
    row.height = 20;
    cols.forEach((col, j) => {
      const cell = row.getCell(2 + j);
      const v = col.value(t);
      cell.value = v === undefined || v === '' ? null : v;
      bodyCell(cell, i % 2 === 1);
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.alignment = { vertical: 'middle', horizontal: col.align ?? 'left' };
    });

    const id = row.getCell(2);
    id.font = font(10, C.info, { underline: true, bold: true });
    row.getCell(3).font = font(10, C.ink, { bold: true });
    pill(row.getCell(statusCol), humanise(t.status), STATUS[t.status]);
    pill(row.getCell(priorityCol), humanise(t.priority), PRIORITY[t.priority]);

    const ot = row.getCell(onTimeCol);
    if (ot.value) ot.font = font(10, String(ot.value).startsWith('✓') ? C.good : C.bad, { bold: true });
    const late = row.getCell(lateCol);
    if (late.value) {
      late.font = font(10, C.bad, { bold: true });
      late.fill = fill('FFFEF2F2');
    }
    const variance = row.getCell(varianceCol);
    if (typeof variance.value === 'number' && variance.value !== 0) {
      variance.font = font(10, variance.value > 0 ? C.bad : C.good);
    }
  });

  const lastRow = HEADER + Math.max(1, sorted.length);
  if (!sorted.length) {
    const cell = merge(ws, HEADER + 1, 2, HEADER + 1, 8);
    cell.value = 'No tasks were alive in this month for the filters you chose.';
    cell.font = font(10, C.muted, { italic: true });
  } else {
    ws.autoFilter = { from: { row: HEADER, column: 2 }, to: { row: lastRow, column: LAST } };
    const colLetter = ws.getColumn(progressCol).letter;
    ws.addConditionalFormatting({
      ref: `${colLetter}${HEADER + 1}:${colLetter}${lastRow}`,
      rules: [{
        type: 'colorScale', priority: 2,
        cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 50 }, { type: 'num', value: 100 }],
        color: [{ argb: 'FFFFFFFF' }, { argb: 'FFE0F2FE' }, { argb: 'FFBBF7D0' }],
      }],
    });
  }

  printSetup(ws, report);
}

/* ------------------------------------------------------------------ *
 * Scorecards — people, projects, teams
 * ------------------------------------------------------------------ */

function scorecardSheet(
  wb: ExcelJS.Workbook,
  report: MonthlyReport,
  opts: {
    name: string;
    title: string;
    subtitle: string;
    tab: string;
    first: string;
    second: string;
    groups: GroupStats[];
    ranked?: boolean;
    health?: boolean;
  },
) {
  const ws = wb.addWorksheet(opts.name, {
    properties: { tabColor: { argb: opts.tab } },
    views: [{ showGridLines: false }],
  });

  const headers = [
    ...(opts.ranked ? ['#'] : []),
    opts.first, opts.health ? 'Health' : opts.second,
    'Tasks', 'Completed', 'Open at end', 'Overdue', 'Blocked', 'Critical + High',
    'Completion', 'On time', 'Avg cycle (days)', 'Est. hours', 'Actual hours', 'Completed share',
  ];
  const widths = [
    ...(opts.ranked ? [6] : []),
    26, opts.health ? 16 : 18, 9, 11, 11, 10, 9, 11, 12, 10, 11, 10, 10, 30,
  ];
  ws.columns = [{ width: 2.5 }, ...widths.map((w) => ({ width: w })), { width: 2.5 }];
  const LAST = widths.length + 2;
  paintCanvas(ws, opts.groups.length + 14, LAST);
  banner(ws, report, opts.title, opts.subtitle, LAST);

  const HEADER = 6;
  ws.getRow(5).height = 8;
  tableHeader(ws, HEADER, 2, headers);
  ws.views = [{ state: 'frozen', ySplit: HEADER, showGridLines: false }];

  const off = opts.ranked ? 1 : 0;
  const maxDone = Math.max(1, ...opts.groups.map((g) => g.completed));
  const medals = ['🥇', '🥈', '🥉'];

  opts.groups.forEach((g, i) => {
    const r = HEADER + 1 + i;
    const row = ws.getRow(r);
    row.height = 21;
    const values: ExcelJS.CellValue[] = [
      ...(opts.ranked ? [g.completed > 0 && i < 3 ? medals[i] : i + 1] : []),
      g.label,
      opts.health ? humanise(g.health) : g.sub,
      g.total, g.completed, g.open, g.overdue, g.blocked, g.urgent,
      g.completionRate, g.onTimeRate,
      g.avgCycleDays === null ? null : round1(g.avgCycleDays),
      g.estimatedHours || null, g.actualHours || null,
      bar(g.completed / maxDone, 26),
    ];
    values.forEach((v, j) => {
      const cell = row.getCell(2 + j);
      cell.value = v ?? null;
      bodyCell(cell, i % 2 === 1);
      cell.alignment = { vertical: 'middle', horizontal: j <= off + 1 ? 'left' : 'center' };
    });
    row.getCell(2 + off).font = font(10, C.ink, { bold: true });
    if (opts.ranked) row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    if (opts.health && g.health) pill(row.getCell(3 + off), humanise(g.health), HEALTH[g.health]);
    row.getCell(5 + off).font = font(10, C.good, { bold: true });
    if (g.overdue) row.getCell(7 + off).font = font(10, C.bad, { bold: true });
    if (g.blocked) row.getCell(8 + off).font = font(10, C.warn, { bold: true });
    row.getCell(10 + off).numFmt = '0%';
    row.getCell(11 + off).numFmt = '0%';
    row.getCell(12 + off).numFmt = '0.0';
    row.getCell(13 + off).numFmt = '0.0';
    row.getCell(14 + off).numFmt = '0.0';
    const b = row.getCell(15 + off);
    b.font = font(9, opts.tab);
    b.alignment = { horizontal: 'left', vertical: 'middle' };
  });

  const first = HEADER + 1;
  const last = HEADER + opts.groups.length;
  if (!opts.groups.length) {
    const cell = merge(ws, first, 2, first, 8);
    cell.value = 'Nothing to show for this month.';
    cell.font = font(10, C.muted, { italic: true });
    printSetup(ws, report);
    return;
  }

  // Totals, as live formulas so edits above keep them honest.
  const totals = last + 1;
  const tr = ws.getRow(totals);
  tr.height = 22;
  for (let c = 2; c <= LAST - 1; c++) {
    const cell = tr.getCell(c);
    cell.fill = fill(C.brandSoft);
    cell.font = font(10, C.ink, { bold: true });
    cell.border = { top: { style: 'medium', color: { argb: C.brand } } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  tr.getCell(2 + off).value = 'Total';
  tr.getCell(2 + off).alignment = { horizontal: 'left', vertical: 'middle' };
  const sumCols = [4, 5, 6, 7, 8, 9, 13, 14].map((c) => c + off);
  for (const c of sumCols) {
    const letter = ws.getColumn(c).letter;
    const result = opts.groups.reduce((s, g) => s + valueAt(g, c - off), 0);
    tr.getCell(c).value = { formula: `SUM(${letter}${first}:${letter}${last})`, result: round1(result) };
    if (c - off >= 13) tr.getCell(c).numFmt = '0.0';
  }
  const done = ws.getColumn(5 + off).letter;
  const tasks = ws.getColumn(4 + off).letter;
  const k = computeKpis(report.tasks, report.range);
  tr.getCell(10 + off).value = { formula: `IFERROR(${done}${totals}/${tasks}${totals},0)`, result: k.completionRate ?? 0 };
  tr.getCell(10 + off).numFmt = '0%';

  for (const c of [10, 11]) {
    const letter = ws.getColumn(c + off).letter;
    rateScale(ws, `${letter}${first}:${letter}${last}`);
  }
  ws.autoFilter = { from: { row: HEADER, column: 2 }, to: { row: last, column: LAST - 1 } };

  const note = merge(ws, totals + 2, 2, totals + 2, LAST - 1);
  note.value = opts.ranked
    ? 'Ranked by tasks completed this month. Open at end = still open when the month closed. Completion and On time are shaded red → green.'
    : 'Sorted by tasks completed this month. Completion and On time are shaded red → green.';
  note.font = font(9, C.muted, { italic: true });

  printSetup(ws, report);
}

function valueAt(g: GroupStats, col: number): number {
  switch (col) {
    case 4: return g.total;
    case 5: return g.completed;
    case 6: return g.open;
    case 7: return g.overdue;
    case 8: return g.blocked;
    case 9: return g.urgent;
    case 13: return g.estimatedHours;
    case 14: return g.actualHours;
    default: return 0;
  }
}

/* ------------------------------------------------------------------ *
 * Needs attention
 * ------------------------------------------------------------------ */

function attentionSheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const { range } = report;
  const now = new Date();
  const cutoff = range.end < now ? range.end : now;
  const soon = new Date(cutoff.getTime() + 7 * 86_400_000);

  type Item = { t: ReportTask; flag: string; pair: Pair; rank: number; late: number | null; note: string | null };
  const items: Item[] = [];
  for (const t of report.tasks) {
    if (!isOpenAtEnd(t, range) || t.status === 'DRAFT') continue;
    if (isOverdueAtEnd(t, range)) {
      const late = Math.ceil((cutoff.getTime() - t.deadline!.getTime()) / 86_400_000);
      items.push({ t, flag: '● Overdue', pair: ['FFFEE2E2', 'FFB91C1C'], rank: 0, late, note: t.blocked_reason });
    } else if (t.status === 'BLOCKED') {
      items.push({ t, flag: '■ Blocked', pair: ['FFFFEDD5', 'FFC2410C'], rank: 1, late: null, note: t.blocked_reason });
    } else if (t.deadline && t.deadline <= soon) {
      items.push({ t, flag: '◆ Due within 7 days', pair: ['FFFEF3C7', 'FFB45309'], rank: 2, late: null, note: null });
    } else if (t.priority === 'CRITICAL' && t.progress < 50) {
      items.push({ t, flag: '▲ Critical, < 50%', pair: ['FFFCE7F3', 'FFBE185D'], rank: 3, late: null, note: null });
    }
  }
  items.sort((a, b) => a.rank - b.rank || (b.late ?? 0) - (a.late ?? 0) || PRIORITY_ORDER.indexOf(a.t.priority) - PRIORITY_ORDER.indexOf(b.t.priority));

  const ws = wb.addWorksheet('Needs Attention', {
    properties: { tabColor: { argb: C.bad } },
    views: [{ showGridLines: false }],
  });
  const headers = ['Flag', 'Task ID', 'Task', 'Assignee', 'Priority', 'Status', 'Deadline', 'Days late', 'Progress', 'Note'];
  const widths = [20, 17, 46, 21, 11, 13, 16, 9, 10, 40];
  ws.columns = [{ width: 2.5 }, ...widths.map((w) => ({ width: w })), { width: 2.5 }];
  const LAST = widths.length + 2;
  paintCanvas(ws, items.length + 12, LAST);
  banner(
    ws, report, 'Needs Attention',
    `${items.length} open task${items.length === 1 ? '' : 's'} to follow up — overdue first, then blocked, due soon and stalled critical work.`,
    LAST,
  );

  const HEADER = 6;
  ws.getRow(5).height = 8;
  tableHeader(ws, HEADER, 2, headers);
  ws.views = [{ state: 'frozen', ySplit: HEADER, showGridLines: false }];

  items.forEach((it, i) => {
    const r = ws.getRow(HEADER + 1 + i);
    r.height = 20;
    const t = it.t;
    const values: ExcelJS.CellValue[] = [
      it.flag,
      { text: t.task_number, hyperlink: taskLink(t) },
      t.title,
      t.assignee_name ?? 'Unassigned',
      humanise(t.priority),
      humanise(t.status),
      t.deadline ? toLocal(t.deadline, range.tz) : null,
      it.late,
      t.progress,
      it.note,
    ];
    values.forEach((v, j) => {
      const cell = r.getCell(2 + j);
      cell.value = v ?? null;
      bodyCell(cell, i % 2 === 1);
      cell.alignment = { vertical: 'middle', horizontal: [0, 1, 2, 3, 9].includes(j) ? 'left' : 'center' };
    });
    pill(r.getCell(2), it.flag, it.pair);
    r.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    r.getCell(3).font = font(10, C.info, { underline: true, bold: true });
    r.getCell(4).font = font(10, C.ink, { bold: true });
    pill(r.getCell(6), humanise(t.priority), PRIORITY[t.priority]);
    pill(r.getCell(7), humanise(t.status), STATUS[t.status]);
    r.getCell(8).numFmt = 'd mmm yyyy h:mm';
    if (it.late) r.getCell(9).font = font(10, C.bad, { bold: true });
    r.getCell(10).numFmt = '0"%"';
  });

  if (!items.length) {
    const cell = merge(ws, HEADER + 1, 2, HEADER + 1, 8);
    cell.value = '🎉 Nothing needs chasing — no overdue, blocked or at-risk tasks.';
    cell.font = font(11, C.good, { bold: true });
  } else {
    ws.autoFilter = { from: { row: HEADER, column: 2 }, to: { row: HEADER + items.length, column: LAST - 1 } };
  }

  printSetup(ws, report);
}

/* ------------------------------------------------------------------ *
 * Daily-update hours heatmap
 * ------------------------------------------------------------------ */

function dailyUpdatesSheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const rows = report.dailyUpdates ?? [];
  const { range } = report;

  const people = new Map<number, { name: string; team: string | null; days: Map<number, { hours: number; draft: boolean }> }>();
  for (const r of rows) {
    const p = people.get(r.user_id) ?? { name: r.full_name, team: r.team_name, days: new Map() };
    p.days.set(Number(r.day.slice(8, 10)), { hours: r.hours, draft: r.status !== 'SUBMITTED' });
    people.set(r.user_id, p);
  }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  const maxHours = Math.max(8, ...rows.map((r) => r.hours));

  const ws = wb.addWorksheet('Daily Updates', {
    properties: { tabColor: { argb: C.violet } },
    views: [{ showGridLines: false }],
  });
  const dayCols = range.days;
  ws.columns = [
    { width: 2.5 }, { width: 24 }, { width: 16 },
    ...Array.from({ length: dayCols }, () => ({ width: 5.2 })),
    { width: 10 }, { width: 10 }, { width: 10 }, { width: 2.5 },
  ];
  const LAST = 3 + dayCols + 4;
  paintCanvas(ws, list.length + 14, LAST);
  banner(ws, report, 'Daily Updates', 'Hours logged in daily updates — darker means a longer day. Italic grey = still a draft.', LAST);

  const HEADER = 6;
  ws.getRow(5).height = 8;
  const headers = ['Person', 'Team'];
  for (let d = 1; d <= dayCols; d++) {
    const date = new Date(Date.UTC(range.year, range.month - 1, d));
    headers.push(`${d}\n${date.toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}`);
  }
  headers.push('Total h', 'Days filed', 'Avg h / day');
  tableHeader(ws, HEADER, 2, headers);
  for (let d = 1; d <= dayCols; d++) {
    const dow = new Date(Date.UTC(range.year, range.month - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) ws.getCell(HEADER, 3 + d).fill = fill('FF4B5563');
  }
  ws.getRow(HEADER).height = 32;
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: HEADER, showGridLines: false }];

  list.forEach((p, i) => {
    const r = ws.getRow(HEADER + 1 + i);
    r.height = 20;
    const name = r.getCell(2);
    name.value = p.name;
    bodyCell(name, i % 2 === 1);
    name.font = font(10, C.ink, { bold: true });
    const team = r.getCell(3);
    team.value = p.team;
    bodyCell(team, i % 2 === 1);
    team.font = font(9, C.muted);

    let total = 0;
    for (let d = 1; d <= dayCols; d++) {
      const cell = r.getCell(3 + d);
      const entry = p.days.get(d);
      cell.border = { bottom: thin(), right: thin('FFF1F5F9') };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (!entry) {
        const dow = new Date(Date.UTC(range.year, range.month - 1, d)).getUTCDay();
        cell.fill = fill(dow === 0 || dow === 6 ? 'FFF1F5F9' : C.card);
        continue;
      }
      total += entry.hours;
      cell.value = entry.hours ? round1(entry.hours) : '✓';
      cell.numFmt = '0.#';
      const shade = heat(HEAT_BLUE, entry.hours, maxHours);
      cell.fill = fill(shade);
      const strong = HEAT_BLUE.indexOf(shade) >= 4;
      cell.font = font(9, entry.draft ? C.faint : strong ? 'FFFFFFFF' : C.ink, { italic: entry.draft, bold: !entry.draft });
    }
    const firstDay = ws.getColumn(4).letter;
    const lastDay = ws.getColumn(3 + dayCols).letter;
    const rowNo = HEADER + 1 + i;
    const totalCell = r.getCell(4 + dayCols);
    totalCell.value = { formula: `SUM(${firstDay}${rowNo}:${lastDay}${rowNo})`, result: round1(total) };
    const daysCell = r.getCell(5 + dayCols);
    daysCell.value = { formula: `COUNTA(${firstDay}${rowNo}:${lastDay}${rowNo})`, result: p.days.size };
    const avgCell = r.getCell(6 + dayCols);
    avgCell.value = {
      formula: `IFERROR(${totalCell.address}/${daysCell.address},0)`,
      result: p.days.size ? round1(total / p.days.size) : 0,
    };
    for (const c of [totalCell, daysCell, avgCell]) {
      bodyCell(c, i % 2 === 1);
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.font = font(10, C.ink, { bold: true });
    }
    totalCell.numFmt = '0.0';
    avgCell.numFmt = '0.0';
  });

  if (!list.length) {
    const cell = merge(ws, HEADER + 1, 2, HEADER + 1, 12);
    cell.value = 'No daily updates were filed this month for the people in this report.';
    cell.font = font(10, C.muted, { italic: true });
  }

  printSetup(ws, report);
}

/* ------------------------------------------------------------------ *
 * How to read
 * ------------------------------------------------------------------ */

function guideSheet(wb: ExcelJS.Workbook, report: MonthlyReport) {
  const ws = wb.addWorksheet('How to Read', {
    properties: { tabColor: { argb: C.faint } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 2.5 }, { width: 28 }, { width: 100 }, { width: 2.5 }];
  const terms: Array<[string, string]> = [
    ['Which tasks are included', `Every task alive at some point in ${report.range.label}: created before the month ended and not closed before it began. That covers new work, finished work and the backlog that rolled through the month. Deleted tasks and other people's private tasks are excluded, and you only ever see tasks you are allowed to see in the app.`],
    ['Time zone', `Month boundaries and every date are in your local time (UTC${fmtOffset(report.range.tz)}) as of the moment you downloaded the file.`],
    ['Tasks in play', 'Count of included tasks.'],
    ['Completed', 'Tasks whose status is Completed and whose completion time falls in the month.'],
    ['Completion rate', 'Completed ÷ (tasks in play − tasks cancelled or rejected in the month).'],
    ['On-time delivery', 'Of the tasks completed this month that had a deadline, the share finished on or before it.'],
    ['Overdue at month end', 'Open when the month ended (or right now, for the current month) and already past their deadline.'],
    ['Avg cycle time', 'Average time from start date (or creation, if no start date) to completion, over tasks completed this month. Tasks logged as already done (under 10 minutes) are left out.'],
    ['Carried forward', 'Tasks still open when the month ended. They will appear again in next month’s report.'],
    ['This month (All Tasks)', 'What happened to the task inside the month: Created & completed, Carried in · completed, Created · still open, Carried over, or closed without completing.'],
    ['Status', 'Statuses are as of today, so a task completed last week shows Completed even in an earlier month’s report.'],
    ['Deadline moved', 'Days between the original deadline and the current one. Positive = pushed later.'],
    ['Variance (h)', 'Actual hours − estimated hours. Red when over the estimate, green when under.'],
    ['Needs Attention', 'Open tasks ordered by urgency: overdue, blocked, due within 7 days of month end, then critical tasks under 50%.'],
    ['Comparisons', `The ▲ / ▼ figures on the Overview compare against ${report.previous.label}, using the same filters.`],
  ];
  paintCanvas(ws, terms.length + 10, 4);
  banner(ws, report, 'How to Read This Report', 'Definitions for every number in the workbook.', 4);
  tableHeader(ws, 6, 2, ['Term', 'Meaning']);
  terms.forEach(([term, meaning], i) => {
    const r = ws.getRow(7 + i);
    const a = r.getCell(2);
    const b = r.getCell(3);
    a.value = term;
    b.value = meaning;
    bodyCell(a, i % 2 === 1);
    bodyCell(b, i % 2 === 1);
    a.font = font(10, C.ink, { bold: true });
    a.alignment = { vertical: 'top', wrapText: true, indent: 1 };
    b.alignment = { vertical: 'top', wrapText: true };
    r.height = Math.max(20, Math.ceil(meaning.length / 105) * 15 + 6);
  });
  printSetup(ws, report, false);
}

function fmtOffset(tz: number): string {
  const mins = -tz;
  const sign = mins >= 0 ? '+' : '−';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export async function buildMonthlyWorkbook(report: MonthlyReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.generatedBy.full_name;
  wb.lastModifiedBy = report.generatedBy.full_name;
  wb.company = 'Aahaas';
  wb.title = `Monthly Task Report — ${report.range.label}`;
  wb.subject = 'Task management monthly export';
  wb.created = report.generatedAt;
  wb.modified = report.generatedAt;
  wb.views = [{ x: 0, y: 0, width: 28000, height: 16000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

  const { tasks, range } = report;

  overviewSheet(wb, report);
  activitySheet(wb, report);
  tasksSheet(wb, report);
  scorecardSheet(wb, report, {
    name: 'People',
    title: 'People Scorecard',
    subtitle: `How each person’s work moved in ${range.label} (by primary assignee).`,
    tab: 'FF0EA5E9',
    first: 'Person',
    second: 'Team',
    ranked: true,
    groups: groupStats(tasks, range, (t) => ({
      key: String(t.assignee_id ?? 'none'),
      label: t.assignee_name ?? 'Unassigned',
      sub: t.team_name,
    })),
  });
  scorecardSheet(wb, report, {
    name: 'Projects',
    title: 'Project Scorecard',
    subtitle: 'Delivery by project. Health is the project’s current health in the app.',
    tab: 'FFF59E0B',
    first: 'Project',
    second: 'Health',
    health: true,
    groups: groupStats(tasks, range, (t) => ({
      key: String(t.project_id ?? 'none'),
      label: t.project_name ?? 'No project',
      health: t.project_health,
    })),
  });
  scorecardSheet(wb, report, {
    name: 'Teams',
    title: 'Team Scorecard',
    subtitle: 'Delivery by team and department.',
    tab: 'FF14B8A6',
    first: 'Team',
    second: 'Department',
    groups: groupStats(tasks, range, (t) => ({
      key: String(t.team_id ?? 'none'),
      label: t.team_name ?? 'No team',
      sub: t.department_name,
    })),
  });
  attentionSheet(wb, report);
  if (report.dailyUpdates) dailyUpdatesSheet(wb, report);
  guideSheet(wb, report);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
