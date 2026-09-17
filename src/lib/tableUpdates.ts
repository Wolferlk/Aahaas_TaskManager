/**
 * Pasted-table parsing.
 *
 * People keep their work in a sheet long before they keep it here: a tracker
 * exported from Excel, a Jira grid, a table in a status document. Pasting that
 * grid is a third way of recording days, alongside free-form text and GitHub —
 * and unlike either of those, the paste carries its OWN dates, so one paste can
 * fill in a fortnight of missed days at once.
 *
 * Splitting a grid is a deterministic job, so it is done in code rather than by
 * the model: the same paste always yields the same rows, with the same dates
 * and the same statuses. AI is asked only to expand each terse row into a
 * written work item — see `itemsFromTableRows` in ./ai.
 *
 * This module is deliberately free of server imports so the review screen can
 * run the same parse as you type and show what it found before anything is
 * sent. The server re-parses before it writes: the browser's read is a preview,
 * never the record.
 */

/** How ambiguous numeric dates (09/07/2026) should be read. */
export type DateOrder = 'AUTO' | 'DMY' | 'MDY';

/** A resolved order — what the parser actually used. */
export type SettledOrder = Exclude<DateOrder, 'AUTO'>;

export interface TableRow {
  /** The row's own number in the sheet, when the first column carried one. */
  index: number | null;
  /** The ISO day this row belongs to. */
  date: string;
  /** Exactly what the date cell said, so the review screen can show its source. */
  raw_date: string | null;
  /** False when the row carried no date and inherited the fallback day. */
  dated: boolean;
  /** The work itself — the widest text cell of the row. */
  text: string;
  /** Anything else the row carried besides the work, the date and the status. */
  notes: string | null;
  /** The sheet's status word mapped onto this module's vocabulary. */
  status: string | null;
  /** The status word as written, kept for the review screen. */
  raw_status: string | null;
  /** The line as pasted, so a row can always be traced back. */
  line: string;
}

export interface RejectedLine {
  line: string;
  reason: string;
}

export interface TableParseResult {
  rows: TableRow[];
  /** Lines that were read but cannot be recorded, each with the reason. */
  rejected: RejectedLine[];
  /** Lines with nothing in them worth keeping — headers, rules, blank cells. */
  skipped: string[];
  /** The order the dates were finally read in. */
  date_order: SettledOrder;
  /**
   * True when nothing in the paste could settle the order — every numeric date
   * had both parts at 12 or below. The reader is then offered the choice.
   */
  ambiguous: boolean;
  /** How the order was arrived at, in one phrase, for the review screen. */
  order_reason: string;
  /** Distinct days found, ascending. */
  dates: string[];
}

/** A paste is a tracker export, not a novel — this is far above a real one. */
export const MAX_TABLE_ROWS = 400;

/** The module's own status vocabulary, keyed by what a sheet tends to say. */
const STATUS_WORDS: Array<[RegExp, string]> = [
  [/^(completed?|done|finished|closed|delivered|shipped|resolved|fixed|live|deployed)$/i, 'COMPLETED'],
  [/^(in[\s_-]?progress|ongoing|wip|started|doing|continuing|working)$/i, 'IN_PROGRESS'],
  [/^(blocked|stuck|on[\s_-]?hold|halted)$/i, 'BLOCKED'],
  [/^(waiting|pending|awaiting|hold|paused|deferred)$/i, 'WAITING'],
  [/^(in[\s_-]?review|review|qa|testing|verification|uat)$/i, 'REVIEW'],
  [/^(to[\s_-]?do|not[\s_-]?started|planned|backlog|new|open)$/i, 'TODO'],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Header cells that name a column rather than hold a value. */
const HEADER_WORDS =
  /^(#|no\.?|s\.?no\.?|sr\.?|sl\.?|index|date|day|task|tasks?|work|description|details?|title|item|status|state|remarks?|notes?|comments?|owner|assignee|project|module|hours?|time|priority)$/i;

const HORIZONTAL_RULE = /^[\s|+_=~*-]+$/;

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const squash = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Today, in the machine's own timezone rather than UTC. */
export function todayISO(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** A real day, not the 31st of February that `new Date` would roll forward. */
function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/** "26" is this century; "97" is the last one. */
function fullYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n >= 70 ? 1900 + n : 2000 + n;
}

type DateCell =
  /** Already unambiguous — nothing to decide. */
  | { kind: 'fixed'; iso: string }
  /** Two numbers whose meaning depends on the order in force. */
  | { kind: 'numeric'; first: number; second: number; year: number };

/**
 * Reads one cell as a date, or returns null if it is not one.
 *
 * Everything a tracker realistically writes is accepted: ISO, either numeric
 * order with any of `/ - .` between the parts, and spelled months on either
 * side of the day.
 */
export function readDateCell(value: string): DateCell | null {
  const cell = squash(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cell || cell.length > 24) return null;

  const isoMatch = cell.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [y, m, d] = isoMatch.slice(1).map(Number);
    return validDate(y, m, d) ? { kind: 'fixed', iso: iso(y, m, d) } : null;
  }

  const numeric = cell.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = fullYear(numeric[3]);
    // A part above 12 can only be a day, so the cell settles itself.
    if (first > 12 && validDate(year, second, first)) return { kind: 'fixed', iso: iso(year, second, first) };
    if (second > 12 && validDate(year, first, second)) return { kind: 'fixed', iso: iso(year, first, second) };
    if (first > 12 || second > 12) return null;
    return { kind: 'numeric', first, second, year };
  }

  const dayFirst = cell.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.? (\d{2,4})$/);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase().slice(0, 4)] ?? MONTHS[dayFirst[2].toLowerCase().slice(0, 3)];
    const y = fullYear(dayFirst[3]);
    const d = Number(dayFirst[1]);
    if (month && validDate(y, month, d)) return { kind: 'fixed', iso: iso(y, month, d) };
    return null;
  }

  const monthFirst = cell.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{2,4})$/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase().slice(0, 4)] ?? MONTHS[monthFirst[1].toLowerCase().slice(0, 3)];
    const y = fullYear(monthFirst[3]);
    const d = Number(monthFirst[2]);
    if (month && validDate(y, month, d)) return { kind: 'fixed', iso: iso(y, month, d) };
    return null;
  }

  return null;
}

/** Applies a settled order to a cell that needed one. */
function resolveDateCell(cell: DateCell, order: SettledOrder): string | null {
  if (cell.kind === 'fixed') return cell.iso;
  const day = order === 'DMY' ? cell.first : cell.second;
  const month = order === 'DMY' ? cell.second : cell.first;
  return validDate(cell.year, month, day) ? iso(cell.year, month, day) : null;
}

/** Maps a sheet's own status word onto the module's vocabulary. */
export function readStatusCell(value: string): string | null {
  const cell = squash(value).replace(/[.:;]+$/, '');
  if (!cell || cell.length > 24) return null;
  for (const [pattern, status] of STATUS_WORDS) if (pattern.test(cell)) return status;
  return null;
}

/**
 * Splits a pasted line into its cells.
 *
 * A copy out of Excel or Sheets arrives tab-separated; the same grid pasted
 * through a document or a chat window arrives as runs of spaces, or fenced with
 * pipes. All three are the same grid, so all three are read as one.
 */
function cellsOf(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes('|')) return line.split('|').map((c) => c.trim());
  if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((c) => c.trim());
  return [line.trim()];
}

interface ReadRow {
  index: number | null;
  dateCell: DateCell | null;
  rawDate: string | null;
  status: string | null;
  rawStatus: string | null;
  text: string;
  notes: string | null;
  line: string;
}

/**
 * Reads one line by the SHAPE of its cells rather than by their position.
 *
 * Trackers do not agree on column order — some lead with the date, some with a
 * row number, some put the status first. Picking each field out by what it
 * looks like means a paste does not have to be rearranged before it is
 * understood.
 */
function readRow(line: string): ReadRow | null {
  let cells = cellsOf(line).filter(Boolean);

  // A line that arrived as one cell still usually carries its number and date
  // up front, so the same fields are teased out of the single string.
  if (cells.length === 1) {
    // A pasted list loses its grid but keeps its shape — a bullet or a number,
    // then the date, then the work, then the state.
    let rest = cells[0].replace(/^[\s*•·–—]+/, '').replace(/^-\s+/, '').trim();
    const parts: string[] = [];
    const numbered = rest.match(/^(\d{1,3})[.)\]:-]?\s+(.+)$/);
    if (numbered) {
      parts.push(numbered[1]);
      rest = numbered[2];
    }
    const dated = rest.match(/^([\dA-Za-z]{1,9}[-/. ][\dA-Za-z]{1,9}[-/. ,]{1,2}\d{2,4})\s+(.+)$/);
    if (dated && readDateCell(dated[1])) {
      parts.push(dated[1]);
      rest = dated[2];
    }
    // A trailing status word, with or without a dash before it. The split is
    // greedy so it lands on the LAST separator rather than the first.
    const tail = rest.match(/^(.*[^\s—–|-])[\s—–|-]+([A-Za-z][A-Za-z\s_-]{1,18})$/);
    if (tail && readStatusCell(tail[2])) {
      parts.push(tail[1].trim(), tail[2]);
    } else {
      parts.push(rest);
    }
    cells = parts.filter(Boolean);
  }

  let index: number | null = null;
  let dateCell: DateCell | null = null;
  let rawDate: string | null = null;
  let status: string | null = null;
  let rawStatus: string | null = null;
  const text: string[] = [];

  for (let position = 0; position < cells.length; position++) {
    const value = squash(cells[position]);
    if (!value) continue;

    // A bare small integer in the first column is the row number, not work.
    if (index === null && position === 0 && /^\d{1,3}[.)]?$/.test(value)) {
      index = Number(value.replace(/[.)]/, ''));
      continue;
    }
    if (!dateCell) {
      const asDate = readDateCell(value);
      if (asDate) {
        dateCell = asDate;
        rawDate = value;
        continue;
      }
    }
    if (!status) {
      const asStatus = readStatusCell(value);
      // A status word is only a status when it stands alone in its own cell —
      // "Fixed the export" is work, "Fixed" is a state.
      if (asStatus && value.split(' ').length <= 3) {
        status = asStatus;
        rawStatus = value;
        continue;
      }
    }
    text.push(value);
  }

  if (!text.length) return null;

  // The longest remaining cell is the work; the rest are remarks beside it.
  const widest = text.reduce((best, cell) => (cell.length > best.length ? cell : best), '');
  const notes = text.filter((cell) => cell !== widest).join(' — ') || null;

  return {
    index,
    dateCell,
    rawDate,
    status,
    rawStatus,
    text: widest,
    notes,
    line: squash(line),
  };
}

/** A header row names its columns and holds no work. */
function isHeaderRow(line: string): boolean {
  const cells = cellsOf(line).map(squash).filter(Boolean);
  if (!cells.length || cells.length > 10) return false;
  if (cells.some((c) => readDateCell(c))) return false;
  const named = cells.filter((c) => HEADER_WORDS.test(c)).length;
  return named >= Math.max(2, Math.ceil(cells.length / 2));
}

/**
 * Decides how to read 09/07/2026 across the WHOLE paste rather than row by row.
 *
 * One unambiguous row settles every ambiguous one: a sheet written by one
 * person on one day does not switch conventions halfway down. Only when no row
 * in the paste can decide it is the reader asked — and day-first is assumed
 * meanwhile, being the convention nearly everywhere outside the US.
 */
function settleOrder(rows: ReadRow[], requested: DateOrder): { order: SettledOrder; ambiguous: boolean; reason: string } {
  if (requested !== 'AUTO') {
    return {
      order: requested,
      ambiguous: false,
      reason: requested === 'DMY' ? 'Day first, as you chose.' : 'Month first, as you chose.',
    };
  }

  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  let undecided = 0;

  for (const row of rows) {
    const cell = row.dateCell;
    if (!cell) continue;
    if (cell.kind === 'fixed') continue;
    // Both parts are 12 or below in a `numeric` cell, so it cannot help on its
    // own; the evidence has to come from cells that already settled themselves.
    undecided++;
  }

  for (const row of rows) {
    if (!row.rawDate) continue;
    const numeric = row.rawDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (!numeric) continue;
    if (Number(numeric[1]) > 12) dayFirstEvidence++;
    else if (Number(numeric[2]) > 12) monthFirstEvidence++;
  }

  if (dayFirstEvidence && !monthFirstEvidence) {
    return { order: 'DMY', ambiguous: false, reason: 'Day first — some dates in the paste have a day above 12.' };
  }
  if (monthFirstEvidence && !dayFirstEvidence) {
    return { order: 'MDY', ambiguous: false, reason: 'Month first — some dates in the paste have a day above 12.' };
  }
  if (!undecided) {
    return { order: 'DMY', ambiguous: false, reason: 'Every date in the paste states its month in full.' };
  }
  return {
    order: 'DMY',
    ambiguous: true,
    reason: 'Read as day/month — nothing in the paste says which comes first.',
  };
}

export interface ParseTableOptions {
  dateOrder?: DateOrder;
  /** The day a row with no date of its own belongs to. */
  fallbackDate?: string;
  /** The latest day that may be recorded; later rows are rejected, not saved. */
  maxDate?: string;
}

/**
 * Turns a pasted grid into dated rows.
 *
 * Nothing is dropped quietly: a line that cannot become a work item comes back
 * in `skipped` or, when it is real work that simply cannot be recorded, in
 * `rejected` with the reason written out.
 */
export function parseTableRows(text: string, opts: ParseTableOptions = {}): TableParseResult {
  const fallbackDate = opts.fallbackDate ?? todayISO();
  // A day is recordable late but never early — mirrors `recordableDate`.
  const maxDate = opts.maxDate ?? todayISO(new Date(Date.now() + 864e5));

  const skipped: string[] = [];
  const rejected: RejectedLine[] = [];
  const read: ReadRow[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (HORIZONTAL_RULE.test(line)) continue;
    if (isHeaderRow(line)) {
      skipped.push(squash(line));
      continue;
    }
    const row = readRow(line);
    if (!row || row.text.length < 3) {
      skipped.push(squash(line));
      continue;
    }
    read.push(row);
  }

  const { order, ambiguous, reason } = settleOrder(read, opts.dateOrder ?? 'AUTO');

  const rows: TableRow[] = [];
  for (const row of read) {
    if (rows.length >= MAX_TABLE_ROWS) {
      rejected.push({ line: row.line, reason: `Beyond the ${MAX_TABLE_ROWS}-row limit for one paste.` });
      continue;
    }

    const resolved = row.dateCell ? resolveDateCell(row.dateCell, order) : null;
    if (row.dateCell && !resolved) {
      rejected.push({ line: row.line, reason: `"${row.rawDate}" is not a real date when read ${order === 'DMY' ? 'day first' : 'month first'}.` });
      continue;
    }

    const date = resolved ?? fallbackDate;
    if (date > maxDate) {
      rejected.push({ line: row.line, reason: `Dated ${date}, which has not happened yet.` });
      continue;
    }

    rows.push({
      index: row.index,
      date,
      raw_date: row.rawDate,
      dated: !!resolved,
      text: row.text.slice(0, 2000),
      notes: row.notes ? row.notes.slice(0, 1000) : null,
      status: row.status,
      raw_status: row.rawStatus,
      line: row.line.slice(0, 2000),
    });
  }

  return {
    rows,
    rejected,
    skipped,
    date_order: order,
    ambiguous,
    order_reason: reason,
    dates: [...new Set(rows.map((r) => r.date))].sort(),
  };
}

/** The rows of one paste, gathered into the days they will be recorded as. */
export function groupRowsByDate<T extends { date: string }>(rows: T[]): Array<{ date: string; rows: T[] }> {
  const byDate = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, rows: list }));
}
