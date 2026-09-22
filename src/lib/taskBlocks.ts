/**
 * Task-block parsing.
 *
 * A lot of end-of-day reports are not bullets under headings — they are a list
 * of tasks the employee has already separated out themselves:
 *
 *   TASK 9: Accounts System — Vietnam Payable Version Switch
 *
 *   Enabled the Vietnam Payable 1.0 tab and added the Payable 1.0 / 1.1 switch.
 *
 *   Kind of Work: Development
 *   Priority: Normal
 *   Reference: 91004d5
 *
 *   ---
 *
 * Read line by line, that one task turns into five "work items" — the heading,
 * the paragraph and every field line separately. Here the block is read as the
 * unit it is: one task, with its title, its system, its account of the work and
 * its fields. The fields the employee wrote are authoritative; a model only
 * writes up the prose around them.
 *
 * Free of server imports, so the tracker-table preview can run it in the
 * browser as well.
 */

export interface TaskBlock {
  /** The task's own number ("TASK 10" → 10), when it carried one. */
  number: number | null;
  /** The task name, with any leading system name split off into `project`. */
  title: string;
  /** "Accounts System" out of "Accounts System — Vietnam Payable…", or a Project: field. */
  project: string | null;
  /** The employee's account of the work, every non-field line joined. */
  body: string;
  /** Field values exactly as written — normalising them is the caller's job. */
  work_type: string | null;
  priority: string | null;
  status: string | null;
  reference: string | null;
  date: string | null;
  hours: number | null;
  progress: number | null;
  blockers: string | null;
  next_steps: string | null;
  outcome: string | null;
  /** Git commit hashes found in the reference, e.g. "812cd9d / 3b2e1d". */
  commit_shas: string[];
  /** The header line as pasted. */
  header: string;
  /** The whole block as pasted, so an item can always be traced back. */
  raw: string;
}

export interface TaskBlockParse {
  blocks: TaskBlock[];
  /** Text above the first task — a greeting or a day summary, never a task. */
  preamble: string[];
}

type FieldName =
  | 'work_type' | 'priority' | 'status' | 'reference' | 'project' | 'date'
  | 'hours' | 'progress' | 'blockers' | 'next_steps' | 'outcome';

/** The labels a report tends to use for each field. Anything else stays prose. */
const FIELD_LABELS: Array<[RegExp, FieldName]> = [
  [/^(kind|type|category)( of work)?$|^work (type|kind|category)$/, 'work_type'],
  [/^(priority|importance|severity)$/, 'priority'],
  [/^(status|state|task status|current status)$/, 'status'],
  [/^(references?|refs?|commits?|commit (ids?|hash(es)?|shas?)|pr|pull requests?|tickets?|jira|links?)$/, 'reference'],
  [/^(project|system|module|application|app|product)$/, 'project'],
  [/^(date|day|worked on|completed on)$/, 'date'],
  [/^(hours?|time spent|duration|effort|time taken)$/, 'hours'],
  [/^(progress|completion|% complete)$/, 'progress'],
  [/^(blockers?|blocked by|impediments?)$/, 'blockers'],
  [/^(next steps?|follow[\s-]?ups?|remaining|pending|to do|todo)$/, 'next_steps'],
  [/^(outcome|result|results)$/, 'outcome'],
];

/** "TASK 10: …", "Task #3 - …", "## Task 2. …", "**Item 4:** …" */
const TASK_HEADER =
  /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:task|item|ticket|work\s*item)\s*#?\s*(\d{1,4})\s*(?:[:.)\]–—-]|\*\*|__)+\s*(.*)$/i;

/** A horizontal rule — the separator between tasks. */
const RULE = /^\s*([-*_=~])(\s*\1){2,}\s*$/;

/** "Label: value", with bold or a bullet allowed around the label. */
const FIELD_LINE = /^[\s*•·-]*(?:\*\*|__)?([A-Za-z%][A-Za-z%/&() -]{0,28}?)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.+?)\s*(?:\*\*|__)?$/;

const squash = (v: string) => v.replace(/\s+/g, ' ').trim();
const unwrap = (v: string) => squash(v.replace(/\*\*|__/g, '')).replace(/^[#\s]+/, '').replace(/[\s:]+$/, '');

function fieldOf(line: string): { name: FieldName; value: string } | null {
  const m = line.match(FIELD_LINE);
  if (!m) return null;
  const label = squash(m[1]).toLowerCase();
  const found = FIELD_LABELS.find(([pattern]) => pattern.test(label));
  const value = unwrap(m[2]);
  return found && value ? { name: found[1], value } : null;
}

/**
 * "Accounts System — Vietnam Payable Version Switch" names its system first.
 * Only a short lead-in counts, so a title that merely contains a dash is left
 * whole.
 */
function splitTitle(raw: string): { project: string | null; title: string } {
  const title = unwrap(raw);
  const m = title.match(/^(.{2,48}?)\s+[—–-]\s+(.{3,})$/) ?? title.match(/^(.{2,48}?)\s*[—–]\s*(.{3,})$/);
  if (m && m[1].split(' ').length <= 5) return { project: m[1].trim(), title: m[2].trim() };
  return { project: null, title };
}

/** Commit hashes: hex, 6-40 long, with at least one digit so words never match. */
export function commitShasIn(value: string | null): string[] {
  if (!value) return [];
  const found = value.match(/\b[0-9a-f]{6,40}\b/gi) ?? [];
  return [...new Set(found.filter((t) => /\d/.test(t) && /[a-f]/i.test(t)).map((t) => t.toLowerCase()))];
}

function toBlock(header: string, lines: string[], number: number | null, rawHeaderTitle: string | null): TaskBlock {
  const fields: Partial<Record<FieldName, string>> = {};
  const body: string[] = [];
  let bodyLines = lines;

  // A block with no "TASK n:" header takes its first line as the title.
  let titleSource = rawHeaderTitle;
  if (titleSource === null) {
    const first = lines.findIndex((l) => l.trim());
    titleSource = first >= 0 ? lines[first] : '';
    bodyLines = lines.slice(first + 1);
  }

  for (const rawLine of bodyLines) {
    const line = rawLine.trim();
    if (!line || RULE.test(line)) continue;
    const field = fieldOf(line);
    if (field) {
      // A repeated field ("Reference:" twice) keeps both values.
      fields[field.name] = fields[field.name] ? `${fields[field.name]}; ${field.value}` : field.value;
      continue;
    }
    body.push(line.replace(/^[-*•·]\s+/, '').replace(/^\d+[.)]\s+/, ''));
  }

  const split = splitTitle(titleSource.replace(/^[-*•·]\s+/, '').replace(/^\d+[.)]\s+/, ''));
  const hours = fields.hours?.match(/(\d+(?:\.\d+)?)/);
  const progress = fields.progress?.match(/(\d{1,3})/);

  return {
    number,
    title: split.title,
    project: fields.project ?? split.project,
    body: squash(body.join(' ')),
    work_type: fields.work_type ?? null,
    priority: fields.priority ?? null,
    status: fields.status ?? null,
    reference: fields.reference ?? null,
    date: fields.date ?? null,
    hours: hours ? Number(hours[1]) : null,
    progress: progress ? Math.min(100, Number(progress[1])) : null,
    blockers: fields.blockers ?? null,
    next_steps: fields.next_steps ?? null,
    outcome: fields.outcome ?? null,
    commit_shas: commitShasIn(fields.reference ?? null),
    header: squash(header),
    raw: [header, ...lines].join('\n').trim(),
  };
}

/** Written fields only — a system name split off the title does not count. */
const hasFields = (b: TaskBlock) =>
  Boolean(b.work_type || b.priority || b.status || b.reference || b.hours || b.date || b.progress);

/**
 * Reads a paste as a list of tasks, or returns null when it is not one.
 *
 * Two shapes count:
 * - "TASK n:" headers — two or more of them, or a single one with fields;
 * - blocks between horizontal rules, where most blocks carry fields such as
 *   "Priority:" or "Kind of Work:".
 *
 * Anything else — bullets under headings, a paragraph, a grid — is left to the
 * parsers built for it.
 */
export function splitTaskBlocks(text: string): TaskBlockParse | null {
  const lines = text.split(/\r?\n/);

  // --- Shape 1: explicit task headers ------------------------------------
  const headerAt = lines
    .map((line, i) => ({ i, m: line.trim().match(TASK_HEADER) }))
    .filter((h): h is { i: number; m: RegExpMatchArray } => !!h.m && !!unwrap(h.m[2] ?? ''));

  if (headerAt.length) {
    const blocks = headerAt.map((h, n) => {
      const end = n + 1 < headerAt.length ? headerAt[n + 1].i : lines.length;
      return toBlock(lines[h.i], lines.slice(h.i + 1, end), Number(h.m[1]), h.m[2]);
    });
    if (blocks.length >= 2 || blocks.some(hasFields)) {
      const preamble = lines
        .slice(0, headerAt[0].i)
        .map((l) => l.trim())
        .filter((l) => l && !RULE.test(l));
      return { blocks: orderBlocks(blocks), preamble };
    }
  }

  // --- Shape 2: rule-separated blocks with fields -------------------------
  const segments: string[][] = [[]];
  for (const line of lines) {
    if (RULE.test(line)) segments.push([]);
    else segments[segments.length - 1].push(line);
  }
  const filled = segments.filter((s) => s.some((l) => l.trim()));
  if (filled.length < 2) return null;

  const blocks = filled.map((s) => toBlock(s.find((l) => l.trim()) ?? '', s, null, null)).filter((b) => b.title);
  if (blocks.filter(hasFields).length < Math.ceil(blocks.length / 2)) return null;
  return { blocks, preamble: [] };
}

/**
 * Numbered tasks are put in their own order — a report written newest-first
 * (TASK 10 down to TASK 1) is still recorded as TASK 1 to TASK 10. Unnumbered
 * or duplicated numbering keeps the paste order.
 */
function orderBlocks(blocks: TaskBlock[]): TaskBlock[] {
  const numbers = blocks.map((b) => b.number);
  if (numbers.some((n) => n === null) || new Set(numbers).size !== numbers.length) return blocks;
  return [...blocks].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}
