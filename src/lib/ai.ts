import 'server-only';
import OpenAI from 'openai';
import { execute } from './db';
import { readStatusCell } from './tableUpdates';
import { splitTaskBlocks, type TaskBlock } from './taskBlocks';

/**
 * AI is strictly advisory in this module.
 *
 * - It never writes to a task, user, reward or approval directly. Callers hand
 *   its output to a human review screen first.
 * - Every entry point returns a usable result when OpenAI is unavailable, so
 *   daily updates, reports and task operations keep working without it.
 */

export const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

let client: OpenAI | null = null;
function getClient() {
  if (!aiConfigured()) return null;
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export interface AiResult<T> {
  ok: boolean;
  data: T;
  /** True when the deterministic fallback produced the result. */
  fallback: boolean;
  message?: string;
}

async function logUsage(
  feature: string,
  userId: number | null,
  success: boolean,
  opts: { tokensIn?: number; tokensOut?: number; ms?: number; error?: string } = {},
) {
  try {
    await execute(
      `INSERT INTO tm_ai_usage_logs (feature, user_id, model, tokens_in, tokens_out, duration_ms, success, error)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        feature,
        userId,
        AI_MODEL,
        opts.tokensIn ?? null,
        opts.tokensOut ?? null,
        opts.ms ?? null,
        success ? 1 : 0,
        opts.error?.slice(0, 500) ?? null,
      ],
    );
  } catch (err) {
    console.error('[tm] ai usage log failed:', err);
  }
}

/** Single JSON completion with logging. Returns null on any failure. */
async function jsonCompletion<T>(
  feature: string,
  userId: number | null,
  system: string,
  user: string,
): Promise<T | null> {
  const api = getClient();
  if (!api) {
    await logUsage(feature, userId, false, { error: 'OPENAI_API_KEY not configured' });
    return null;
  }
  const started = Date.now();
  try {
    const res = await api.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = res.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(text) as T;
    await logUsage(feature, userId, true, {
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
      ms: Date.now() - started,
    });
    return parsed;
  } catch (err) {
    await logUsage(feature, userId, false, {
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(`[tm] ai ${feature} failed:`, err);
    return null;
  }
}

async function textCompletion(
  feature: string,
  userId: number | null,
  system: string,
  user: string,
): Promise<string | null> {
  const api = getClient();
  if (!api) {
    await logUsage(feature, userId, false, { error: 'OPENAI_API_KEY not configured' });
    return null;
  }
  const started = Date.now();
  try {
    const res = await api.chat.completions.create({
      model: AI_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    await logUsage(feature, userId, true, {
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
      ms: Date.now() - started,
    });
    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    await logUsage(feature, userId, false, {
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Daily update parsing
 * ------------------------------------------------------------------ */

export interface ParsedItem {
  topic: string | null;
  title: string;
  project: string | null;
  description: string | null;
  work_type: string | null;
  status: string;
  priority: string;
  progress: number;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  blockers: string | null;
  outcome: string | null;
  tags: string[];
  confidence: number;
  ai_generated_fields: string[];
  /** Long-form depth, kept apart from `description` so the review screen can
   *  show a one-line item and still carry everything underneath it. */
  work_detail?: string | null;
  technical_notes?: string | null;
  impact?: string | null;
  next_steps?: string | null;
  repos?: string[];
  commit_shas?: string[];
  commit_count?: number;
  additions?: number;
  deletions?: number;
  files_changed?: number;
}

/** The work types the review screen offers; the parser is held to this list. */
const WORK_TYPES = [
  'Development', 'Bug Fix', 'Testing', 'Documentation', 'Deployment',
  'Refactor', 'Meeting', 'Support', 'Research', 'Design',
];
const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED'];
const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Upper bound on a single paste. A full end-of-day report runs to ~70 lines. */
const MAX_ITEMS = 150;
/** Small enough that one response never truncates mid-item. */
const MAX_LINES_PER_CHUNK = 12;
const MAX_CHARS_PER_CHUNK = 3200;

const PARSER_SYSTEM = `You convert an employee's daily work update into structured work items.

The text you receive is ONE section of a longer report. Every numbered line in it
is one work item.

Rules:
- Return exactly one item per numbered line, in the same order. Never merge two
  lines into one item, never drop a line, never add work that is not written.
- Never invent work, numbers, people, tickets or outcomes.
- title is REQUIRED and must never be empty. Write a short (3-9 word) title that
  names the work, e.g. "Fixed invoice PDF export". Condense a long line rather
  than copying it verbatim.
- description is REQUIRED and must NEVER be null or empty. Write one or two
  complete sentences, in plain professional English, restating what was done as
  the employee would report it to a manager. Turn a fragment into a full
  sentence. Never return the title again as the description.
- topic: the section heading supplied with the text, when one is given.
- project: the system or module heading supplied with the text, matched to a
  known project name when one clearly corresponds. null otherwise.
- work_type: exactly one of ${WORK_TYPES.join(', ')} — or null when unclear.
- status must be one of: ${STATUSES.join(', ')}. A line written in the past tense
  ("Added", "Implemented", "Improved") is COMPLETED.
- priority must be one of: ${PRIORITIES.join(', ')}. Use MEDIUM when unclear.
- progress is an integer 0-100. Completed work is 100.
- hours is a number or null. Only fill it if the text implies a duration.
- start_time/end_time are "HH:MM" 24h strings or null.
- outcome: the result once it landed, when the line states or clearly implies the
  work was delivered. null otherwise.
- tags: 1-4 short lowercase keywords taken from the words of the line.
- confidence is 0.0-1.0 reflecting how directly the text supports the item.
- work_detail: 2-4 sentences expanding on exactly what was done, in the
  employee's own terms. Use only what the line supports — if the line is one
  short clause, keep work_detail short rather than padding it.
- technical_notes: the technical specifics mentioned (components, endpoints,
  queries, tools). null when the line has none.
- impact: who or what this helps, only when the line says or clearly implies it.
- next_steps: what remains, only when the line mentions it. null otherwise.
- ai_generated_fields lists field names you inferred rather than read.

Example input:
System / module heading: Accounts System
Section heading: Invoice Reporting
Produce exactly 2 items, one per line below, in the same order:
1. Added invoice amount history and previous-value comparison.
2. Improved visibility of amended invoice amounts.

Example output: { "items": [
  { "title": "Added invoice amount history", "description": "Added an amount history to invoices so the previous value can be compared against the current one.", "work_detail": "Extended invoice reporting with a history of the invoice amount and a comparison against the previously recorded value.", "technical_notes": null, "impact": null, "next_steps": null, "status": "COMPLETED", "priority": "MEDIUM", "progress": 100, "topic": "Invoice Reporting", "project": "Accounts System", "work_type": "Development", "start_time": null, "end_time": null, "hours": null, "blockers": null, "outcome": "Invoice amount history is available with previous-value comparison.", "tags": ["invoice","reporting"], "confidence": 0.9, "ai_generated_fields": ["work_type"] },
  { "title": "Improved amended invoice visibility", "description": "Improved how amended invoice amounts are surfaced so changes are visible on the invoice reports.", "work_detail": "Made amended invoice amounts easier to see in the invoice reports.", "technical_notes": null, "impact": null, "next_steps": null, "status": "COMPLETED", "priority": "MEDIUM", "progress": 100, "topic": "Invoice Reporting", "project": "Accounts System", "work_type": "Development", "start_time": null, "end_time": null, "hours": null, "blockers": null, "outcome": null, "tags": ["invoice","amendment"], "confidence": 0.9, "ai_generated_fields": ["work_type"] }
] }

Return JSON: { "items": ParsedItem[] }`;

/* ------------------------------------------------------------------ *
 * Section-aware splitting
 *
 * A daily report is pasted as headings with bullets underneath. Parsing it as
 * one blob loses the tail of a long document, so it is split on its headings,
 * parsed in chunks, and reassembled — every bullet comes back as its own item,
 * carrying the heading it sat under.
 * ------------------------------------------------------------------ */

export interface UpdateSection {
  /** Top-level heading — the system or module, e.g. "Accounts System". */
  group: string | null;
  /** Nearest sub-heading, e.g. "Reporting & Currency Improvements". */
  topic: string | null;
  /** True when the heading names a wrap-up rather than work items. */
  summaryOnly: boolean;
  lines: string[];
}

interface ParseChunk {
  group: string | null;
  topic: string | null;
  lines: string[];
}

/** Wrap-up sections are kept out of the work items and offered as day narrative. */
export interface UpdateNarrative {
  highlights: string[];
  overall: string | null;
}

export interface ParsedUpdate {
  items: ParsedItem[];
  narrative: UpdateNarrative;
}

const SUMMARY_HEADING =
  /^(main\s+outcome|outcome|overall|summary|key\s+(?:outcome|highlight|point)|highlight|conclusion|wrap[\s-]?up)/i;

function headingText(raw: string) {
  return raw.replace(/^[\s#*_\-–—.\d)]+/, '').replace(/[\s*_:]+$/, '').trim();
}

/** An ATX heading, a line that is only bold text, or a bare "Title:" line. */
function headingLevel(line: string): number | null {
  const atx = line.match(/^(#{1,6})\s+\S/);
  if (atx) return atx[1].length;
  if (/^\*\*[^*]+\*\*:?$/.test(line)) return 3;
  if (/^[A-Z][A-Za-z0-9 &/'()-]{2,60}:$/.test(line)) return 3;
  return null;
}

/** Splits a pasted report into its headings and the lines beneath each one. */
export function splitUpdateSections(text: string): UpdateSection[] {
  const sections: UpdateSection[] = [];
  let group: string | null = null;
  let topic: string | null = null;
  let current: UpdateSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const level = headingLevel(line);
    if (level !== null) {
      const label = headingText(line);
      if (!label) continue;
      if (level <= 2) {
        group = label;
        topic = null;
      } else {
        topic = label;
      }
      current = null;
      continue;
    }

    const body = line
      .replace(/^[-*•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (body.length < 3) continue;

    if (!current) {
      current = {
        group,
        topic,
        summaryOnly: SUMMARY_HEADING.test(topic ?? group ?? ''),
        lines: [],
      };
      sections.push(current);
    }
    current.lines.push(body);
  }

  return sections;
}

/** Sentence/bullet split, used when the paste carries no headings at all. */
function looseLines(text: string): string[] {
  return text
    .split(/\n+|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter((s) => s.length > 3);
}

function chunkSections(sections: UpdateSection[]): ParseChunk[] {
  const chunks: ParseChunk[] = [];
  for (const section of sections) {
    let lines: string[] = [];
    let chars = 0;
    const flush = () => {
      if (lines.length) chunks.push({ group: section.group, topic: section.topic, lines });
      lines = [];
      chars = 0;
    };
    for (const line of section.lines) {
      if (lines.length >= MAX_LINES_PER_CHUNK || (lines.length && chars + line.length > MAX_CHARS_PER_CHUNK)) flush();
      lines.push(line);
      chars += line.length;
    }
    flush();
  }
  return chunks;
}

/** Chunks are independent, so they run together rather than one after another. */
async function mapWithConcurrency<T, R>(
  input: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(input.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, input.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= input.length) return;
        out[i] = await fn(input[i]);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

const oneLine = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

function sentence(value: string) {
  const s = oneLine(value);
  if (!s) return '';
  const capped = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * The review screen shows a description on every item, so one is always
 * written: the model's, else the source line, else the long-form detail, else
 * the title. It is never left blank for the submitter to fill in.
 */
function describe(item: Partial<ParsedItem>, title: string, sourceLine?: string): string {
  for (const candidate of [item.description, sourceLine, item.work_detail]) {
    const text = oneLine(candidate);
    if (text && text.toLowerCase() !== title.toLowerCase()) return sentence(text).slice(0, 2000);
  }
  return sentence(title);
}

const pick = (value: unknown, allowed: string[], fallback: string) => {
  const v = oneLine(value).toUpperCase().replace(/[\s-]+/g, '_');
  return allowed.includes(v) ? v : fallback;
};

/** What people write for each work type, beyond the type's own name. */
const WORK_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/^(bug|bugs|bugfix|bug[\s-]?fixing|fix|fixes|hotfix|defect)$/, 'Bug Fix'],
  [/^(dev|feature|features|enhancement|implementation|coding|new feature)$/, 'Development'],
  [/^(test|tests|qa|verification|quality assurance|uat)$/, 'Testing'],
  [/^(docs?|documenting)$/, 'Documentation'],
  [/^(deploy|release|go[\s-]?live|devops)$/, 'Deployment'],
  [/^(refactoring|cleanup|clean[\s-]?up)$/, 'Refactor'],
  [/^(meetings?|call|discussion)$/, 'Meeting'],
  [/^(investigation|analysis|r&d|spike)$/, 'Research'],
  [/^(ui|ux|ui\/ux)$/, 'Design'],
];

function pickWorkType(value: unknown): string | null {
  const v = oneLine(value).toLowerCase();
  if (!v) return null;
  return (
    WORK_TYPES.find((w) => w.toLowerCase() === v) ??
    WORK_TYPE_ALIASES.find(([pattern]) => pattern.test(v))?.[1] ??
    null
  );
}

/** "Normal", "High", "P1" — the words a report uses for priority. */
function pickPriority(value: unknown): string | null {
  const v = oneLine(value).toLowerCase();
  if (!v) return null;
  if (/^(critical|urgent|blocker|highest|p0|asap)$/.test(v)) return 'CRITICAL';
  if (/^(high|important|p1)$/.test(v)) return 'HIGH';
  if (/^(normal|medium|moderate|regular|standard|p2)$/.test(v)) return 'MEDIUM';
  if (/^(low|minor|lowest|trivial|p3|p4)$/.test(v)) return 'LOW';
  return null;
}

const DONE = /\b(completed|finished|done|deployed|delivered|fixed|resolved|closed|added|implemented|improved|updated|refactored|developed|extended|enhanced|integrated|built)\b/i;
const BLOCKED = /\b(blocked|waiting|stuck|pending|on hold)\b/i;
const STARTED = /\b(started|began|working on|in progress|continued|ongoing)\b/i;

/** Everything a line yields without a model — also the per-line safety net. */
function deterministicItem(line: string): Partial<ParsedItem> {
  const status = BLOCKED.test(line) ? 'BLOCKED' : DONE.test(line) ? 'COMPLETED' : STARTED.test(line) ? 'IN_PROGRESS' : 'IN_PROGRESS';
  const hours = line.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b/i);
  const words = oneLine(line).split(' ');

  return {
    title: words.length > 9 ? words.slice(0, 9).join(' ') : oneLine(line),
    description: sentence(line),
    work_detail: sentence(line),
    status,
    priority: /\b(urgent|critical|asap)\b/i.test(line) ? 'HIGH' : 'MEDIUM',
    progress: status === 'COMPLETED' ? 100 : status === 'BLOCKED' ? 40 : 50,
    hours: hours ? Number(hours[1]) : null,
    blockers: BLOCKED.test(line) ? oneLine(line) : null,
    confidence: 0.4,
    ai_generated_fields: ['status', 'priority', 'progress'],
  };
}

/**
 * "Accounts System › Invoice Reporting" — the module and the section it sat
 * under, kept together in the one column the item row has for it. The daily
 * update mail groups on the part before the separator.
 */
function composeTopic(group: string | null, topic: string | null): string | null {
  const parts = [group, topic].map(oneLine).filter(Boolean);
  const unique = parts.filter((p, i) => parts.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i);
  return unique.join(' › ').slice(0, 160) || null;
}

function normaliseParsedItem(
  raw: Partial<ParsedItem>,
  ctx: { group: string | null; topic: string | null; line?: string },
): ParsedItem {
  const title =
    oneLine(raw.title).slice(0, 240) ||
    (ctx.line ? oneLine(ctx.line).slice(0, 120) : '') ||
    'Untitled work item';

  return {
    topic: composeTopic(ctx.group, oneLine(raw.topic) || ctx.topic),
    title,
    project: oneLine(raw.project).slice(0, 160) || ctx.group || null,
    description: describe(raw, title, ctx.line),
    work_type: pickWorkType(raw.work_type),
    status: pick(raw.status, STATUSES, 'IN_PROGRESS'),
    priority: pick(raw.priority, PRIORITIES, 'MEDIUM'),
    progress: Math.max(0, Math.min(100, Math.round(Number(raw.progress ?? 0)) || 0)),
    start_time: oneLine(raw.start_time).slice(0, 5) || null,
    end_time: oneLine(raw.end_time).slice(0, 5) || null,
    hours: Number.isFinite(Number(raw.hours)) && raw.hours !== null ? Number(raw.hours) : null,
    blockers: oneLine(raw.blockers).slice(0, 2000) || null,
    outcome: oneLine(raw.outcome).slice(0, 2000) || null,
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8).map((t) => oneLine(t).slice(0, 40)).filter(Boolean) : [],
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.5))),
    ai_generated_fields: Array.isArray(raw.ai_generated_fields) ? raw.ai_generated_fields.map(String) : [],
    work_detail: oneLine(raw.work_detail).slice(0, 8000) || describe(raw, title, ctx.line),
    technical_notes: oneLine(raw.technical_notes).slice(0, 4000) || null,
    impact: oneLine(raw.impact).slice(0, 2000) || null,
    next_steps: oneLine(raw.next_steps).slice(0, 2000) || null,
  };
}

/** Deterministic fallback: every line of the paste, with its heading kept. */
export function fallbackParse(text: string): ParsedItem[] {
  const sections = splitUpdateSections(text).filter((s) => !s.summaryOnly);
  const source: UpdateSection[] = sections.length
    ? sections
    : [{ group: null, topic: null, summaryOnly: false, lines: looseLines(text) }];

  return source
    .flatMap((section) =>
      section.lines.map((line) =>
        normaliseParsedItem(deterministicItem(line), { group: section.group, topic: section.topic, line }),
      ),
    )
    .slice(0, MAX_ITEMS);
}

const keywords = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );

/**
 * Source lines the model did not represent.
 *
 * A dropped bullet is a lost record, so anything with no matching item is
 * recovered deterministically rather than silently disappearing.
 */
function uncoveredLines(lines: string[], produced: ParsedItem[]): string[] {
  if (!produced.length) return lines;
  const blobs = produced.map((p) => keywords(`${p.title} ${p.description ?? ''} ${p.work_detail ?? ''}`));
  return lines.filter((line) => {
    const words = [...keywords(line)];
    if (!words.length) return false;
    return !blobs.some((b) => words.filter((w) => b.has(w)).length / words.length >= 0.5);
  });
}

/** "Main outcomes"/"Overall status" sections become day narrative, not items. */
function buildNarrative(sections: UpdateSection[]): UpdateNarrative {
  const highlights: string[] = [];
  const overall: string[] = [];

  for (const section of sections) {
    for (const raw of section.lines) {
      const line = raw.replace(/\*\*/g, '').trim();
      if (/^overall\b/i.test(line)) {
        overall.push(line.replace(/^overall(\s+status)?\s*:?\s*/i, ''));
      } else if (line) {
        highlights.push(line.slice(0, 400));
      }
    }
  }

  return { highlights: highlights.slice(0, 15), overall: overall.join(' ').trim() || null };
}

function buildChunkPrompt(
  chunk: ParseChunk,
  context: { projects: string[]; openTasks: Array<{ task_number: string; title: string }> },
) {
  return [
    `Known projects: ${context.projects.join(', ') || 'none recorded'}`,
    `The user's open tasks:\n${
      context.openTasks.map((t) => `- ${t.task_number}: ${t.title}`).join('\n') || 'none'
    }`,
    '',
    chunk.group ? `System / module heading: ${chunk.group}` : '',
    chunk.topic ? `Section heading: ${chunk.topic}` : '',
    `Produce exactly ${chunk.lines.length} item${chunk.lines.length === 1 ? '' : 's'}, one per line below, in the same order:`,
    ...chunk.lines.map((line, i) => `${i + 1}. ${line}`),
  ]
    .filter(Boolean)
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Task blocks
 *
 * "TASK 9: Accounts System — …" followed by a paragraph and "Priority:" /
 * "Kind of Work:" / "Reference:" lines is a task the employee has already
 * identified. Each block becomes exactly one item: its title, system, work
 * type, priority and reference are taken as written, and the model only writes
 * up the detail from the block's own paragraph.
 * ------------------------------------------------------------------ */

/** A block's paragraph can run long, so fewer go in each call than bullets do. */
const BLOCKS_PER_CHUNK = 5;

const BLOCK_SYSTEM = `You write up tasks an employee has already listed one by one in their daily update.

Each numbered block below is ONE task. It gives the task's title, the system it
belongs to, and the employee's own account of the work. The employee decided
what the tasks are — your job is to write each one up, NOT to split, merge or
reinterpret them.

Rules:
- Return exactly one item per block, in the same order. Never merge blocks,
  never split a block, never drop one, never add work that is not written.
- Never invent work, numbers, people, tickets, tools or outcomes. If the
  account does not say it, leave the field null.
- title: repeat the block's title unchanged.
- description (REQUIRED): one or two sentences summarising the account as the
  employee would report it to a manager. Never repeat the title alone.
- work_detail (REQUIRED): 2-4 sentences giving the fullest honest account the
  block supports — what was built, changed or checked, which part of the system
  it touched, and what state it ended in. Use only the block's own content.
- technical_notes: the components, screens, commands, queries, permissions,
  errors or tools the account actually names (e.g. "tm.project.create
  permission", "ONLY_FULL_GROUP_BY"). null when it names none.
- impact: who or what this helps, only where the account says or implies it.
- outcome: the result, when the account reports the work as delivered.
- next_steps: anything the account says still remains ("remains pending",
  "follow-ups", "to be deployed"). null otherwise.
- blockers: only what the account says is in the way. Something merely
  remaining to do is next_steps, not a blocker.
- status: one of ${STATUSES.join(', ')}. When the block states a status, return
  it unchanged. Otherwise work reported in the past tense ("Implemented",
  "Fixed", "Created") is COMPLETED, even when follow-ups remain.
- work_type: when the block states one, return it; otherwise exactly one of
  ${WORK_TYPES.join(', ')}, or null when unclear.
- priority: one of ${PRIORITIES.join(', ')}. When the block states one, map it
  ("Normal" is MEDIUM). MEDIUM when not stated.
- progress: integer 0-100. Completed work is 100.
- hours: a number only if the block states a duration, else null.
- tags: 1-4 short lowercase keywords taken from the block's own words.
- confidence: 0.0-1.0, how directly the block supports what you wrote.
- ai_generated_fields: the field names you inferred rather than read.

Return JSON: { "items": ParsedItem[] }`;

function buildBlockPrompt(chunk: TaskBlock[], context: { projects: string[] }) {
  return [
    `Known projects: ${context.projects.join(', ') || 'none recorded'}`,
    '',
    `Produce exactly ${chunk.length} item${chunk.length === 1 ? '' : 's'}, one per block below, in the same order:`,
    ...chunk.map((b, i) =>
      [
        '',
        `${i + 1}. Title: ${b.title}`,
        b.project ? `   System: ${b.project}` : '',
        `   Account: ${b.body || '(no description written)'}`,
        b.work_type ? `   Kind of work: ${b.work_type}` : '',
        b.priority ? `   Priority: ${b.priority}` : '',
        b.status ? `   Status: ${b.status}` : '',
        b.hours !== null ? `   Hours: ${b.hours}` : '',
        b.blockers ? `   Blockers: ${b.blockers}` : '',
        b.next_steps ? `   Next steps: ${b.next_steps}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n');
}

/** "Accounts system" is the project the team already calls "Accounts System". */
function matchProject(name: string | null, projects: string[]): string | null {
  const wanted = oneLine(name);
  if (!wanted) return null;
  const lower = wanted.toLowerCase();
  return (
    projects.find((p) => p.toLowerCase() === lower) ??
    projects.find((p) => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase())) ??
    wanted
  );
}

const REMAINING = /\b(remains? (?:pending|open|outstanding|to be)|remaining|pending|follow[\s-]?ups?|still to|yet to|to be (?:deployed|tested|done))\b/i;

/** A block's item without a model — the fields as written, the paragraph as the account. */
function deterministicBlockItem(block: TaskBlock): Partial<ParsedItem> {
  const text = block.body || block.title;
  const done = DONE.test(text) || /\b(created|performed|enabled|removed|investigated|committed|documented|tested|verified|introduced|maintained|confirmed)\b/i.test(text);
  const status = /\bblocked\b/i.test(text) ? 'BLOCKED' : done ? 'COMPLETED' : 'IN_PROGRESS';
  const remaining = text.split(/(?<=[.!?])\s+/).filter((s) => REMAINING.test(s));

  return {
    ...deterministicItem(text),
    title: block.title,
    status,
    progress: status === 'COMPLETED' ? 100 : status === 'BLOCKED' ? 40 : 50,
    blockers: null,
    next_steps: remaining.join(' ') || null,
    confidence: 0.6,
  };
}

/**
 * One block, one item. What the employee wrote down wins over what the model
 * inferred: the title, system, work type, priority, status, hours and
 * reference all come from the block whenever it states them.
 */
function itemFromBlock(block: TaskBlock, raw: Partial<ParsedItem> | null, projects: string[]): ParsedItem {
  const base = normaliseParsedItem(raw ?? deterministicBlockItem(block), {
    group: null,
    topic: null,
    line: block.body || undefined,
  });

  const project = matchProject(block.project, projects) ?? base.project;
  const workType = pickWorkType(block.work_type) ?? base.work_type;
  const priority = pickPriority(block.priority) ?? base.priority;
  const status = (block.status && readStatusCell(block.status)) || base.status;
  const progress =
    block.progress ?? (status === 'COMPLETED' ? 100 : status === 'TODO' ? 0 : base.progress || (status === 'BLOCKED' || status === 'WAITING' ? 40 : 50));

  const written = new Set<string>(['title']);
  if (block.project) written.add('project');
  if (pickWorkType(block.work_type)) written.add('work_type');
  if (pickPriority(block.priority)) written.add('priority');
  if (block.status && readStatusCell(block.status)) written.add('status');
  if (block.hours !== null) written.add('hours');

  const reference = block.reference ? `Reference: ${block.reference}` : null;

  return {
    ...base,
    title: oneLine(block.title).slice(0, 240) || base.title,
    project,
    topic: project ? composeTopic(project, null) : base.topic,
    work_type: workType,
    priority,
    status,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    hours: block.hours ?? base.hours,
    blockers: block.blockers ?? base.blockers,
    next_steps: block.next_steps ?? base.next_steps,
    outcome: block.outcome ?? base.outcome,
    technical_notes: [base.technical_notes, reference].filter(Boolean).join(' — ').slice(0, 4000) || null,
    commit_shas: block.commit_shas,
    // The fields the block stated are read, not inferred, and the structure was
    // spelled out by the employee — both raise how far the item can be trusted.
    ai_generated_fields: base.ai_generated_fields.filter((f) => !written.has(f)),
    confidence: raw ? Math.max(base.confidence, 0.85) : 0.7,
  };
}

/**
 * Writes up a list of task blocks, one item per block in the same order.
 * A chunk the model does not answer one-for-one is filled from the blocks
 * themselves, so no task is ever lost or given another task's write-up.
 */
async function writeUpTaskBlocks(
  feature: string,
  userId: number,
  blocks: TaskBlock[],
  context: { projects: string[] },
): Promise<{ items: ParsedItem[]; aiChunks: number; chunks: number }> {
  const chunks: TaskBlock[][] = [];
  for (let i = 0; i < blocks.length; i += BLOCKS_PER_CHUNK) chunks.push(blocks.slice(i, i + BLOCKS_PER_CHUNK));

  const responses = await mapWithConcurrency(chunks, 4, (chunk) =>
    jsonCompletion<{ items: Array<Partial<ParsedItem>> }>(feature, userId, BLOCK_SYSTEM, buildBlockPrompt(chunk, context)),
  );

  const items: ParsedItem[] = [];
  let aiChunks = 0;
  chunks.forEach((chunk, i) => {
    const returned = responses[i]?.items;
    const aligned = !!returned && returned.length === chunk.length;
    if (aligned) aiChunks++;
    chunk.forEach((block, n) => items.push(itemFromBlock(block, aligned ? returned[n] : null, context.projects)));
  });

  return { items, aiChunks, chunks: chunks.length };
}

/**
 * Turns a pasted update into work items.
 *
 * The paste is split on its headings and parsed a chunk at a time so a long
 * end-of-day report comes back whole — one item per bullet, each carrying its
 * heading, a written description and its long-form detail. Any line the model
 * skips is recovered from the text itself, and if the model is unavailable the
 * deterministic split covers the entire paste.
 */
export async function parseDailyUpdate(
  text: string,
  userId: number,
  context: { projects: string[]; openTasks: Array<{ task_number: string; title: string }> },
): Promise<AiResult<ParsedUpdate>> {
  // A list of already-separated tasks is read block by block, not line by line.
  const taskList = splitTaskBlocks(text);
  if (taskList) {
    const narrative: UpdateNarrative = { highlights: taskList.preamble.slice(0, 15), overall: null };
    const { items, aiChunks, chunks } = await writeUpTaskBlocks('daily_update_parse', userId, taskList.blocks.slice(0, MAX_ITEMS), context);
    const data = { items, narrative };
    if (!aiChunks) {
      return {
        ok: false,
        fallback: true,
        data,
        message: `${items.length} tasks found. AI write-up unavailable — each task kept its own title, type and priority; please review the detail before saving.`,
      };
    }
    return {
      ok: true,
      fallback: aiChunks < chunks,
      data,
      message:
        aiChunks < chunks
          ? `${items.length} tasks found. Part of them were written up automatically — please review those items.`
          : `${items.length} tasks found and written up. Review each item below — nothing is saved until you confirm.`,
    };
  }

  const sections = splitUpdateSections(text);
  const narrative = buildNarrative(sections.filter((s) => s.summaryOnly));
  const workSections = sections.filter((s) => !s.summaryOnly);

  const source: UpdateSection[] = workSections.length
    ? workSections
    : [{ group: null, topic: null, summaryOnly: false, lines: looseLines(text) }];

  const chunks = chunkSections(source);
  if (!chunks.length) {
    return { ok: false, fallback: true, data: { items: [], narrative }, message: 'Nothing to extract from that text.' };
  }

  const responses = await mapWithConcurrency(chunks, 4, (chunk) =>
    jsonCompletion<{ items: Array<Partial<ParsedItem>> }>(
      'daily_update_parse',
      userId,
      PARSER_SYSTEM,
      buildChunkPrompt(chunk, context),
    ),
  );

  const items: ParsedItem[] = [];
  let aiChunks = 0;

  chunks.forEach((chunk, i) => {
    const returned = responses[i]?.items;
    const ctx = { group: chunk.group, topic: chunk.topic };

    if (!returned?.length) {
      for (const line of chunk.lines) items.push(normaliseParsedItem(deterministicItem(line), { ...ctx, line }));
      return;
    }

    aiChunks++;
    // Only trust positional pairing when the model returned one item per line.
    const aligned = returned.length === chunk.lines.length;
    const produced = returned.map((raw, n) =>
      normaliseParsedItem(raw, { ...ctx, line: aligned ? chunk.lines[n] : undefined }),
    );
    items.push(...produced);

    for (const missed of uncoveredLines(chunk.lines, produced)) {
      items.push(normaliseParsedItem(deterministicItem(missed), { ...ctx, line: missed }));
    }
  });

  const data = { items: items.slice(0, MAX_ITEMS), narrative };

  if (!aiChunks) {
    return {
      ok: false,
      fallback: true,
      data,
      message: 'AI analysis unavailable. Your text was split automatically — please review each item before saving.',
    };
  }

  return {
    ok: true,
    fallback: aiChunks < chunks.length,
    data,
    message:
      aiChunks < chunks.length
        ? `${data.items.length} work items extracted. Part of the text was split automatically — please review each item.`
        : `${data.items.length} work items extracted from ${chunks.length} section${chunks.length === 1 ? '' : 's'}. Review each item below — nothing is saved until you confirm.`,
  };
}

/* ------------------------------------------------------------------ *
 * Summaries and interpretation
 * ------------------------------------------------------------------ */

export async function summariseDay(
  userId: number,
  stats: Record<string, unknown>,
  items: Array<{ title: string; status: string }>,
): Promise<AiResult<string>> {
  const deterministic = buildDaySummary(stats, items);
  const text = await textCompletion(
    'day_summary',
    userId,
    'You write a short, factual end-of-day work summary in 2-3 sentences. Use only the metrics given. Never invent work or numbers.',
    `Metrics: ${JSON.stringify(stats)}\nItems:\n${items.map((i) => `- [${i.status}] ${i.title}`).join('\n')}`,
  );
  return text ? { ok: true, fallback: false, data: text } : { ok: false, fallback: true, data: deterministic };
}

function buildDaySummary(stats: Record<string, unknown>, items: Array<{ status: string }>) {
  const completed = items.filter((i) => i.status === 'COMPLETED').length;
  const progress = items.filter((i) => i.status === 'IN_PROGRESS').length;
  const blocked = items.filter((i) => i.status === 'BLOCKED').length;
  const parts = [`${completed} item${completed === 1 ? '' : 's'} completed`];
  if (progress) parts.push(`${progress} in progress`);
  if (blocked) parts.push(`${blocked} blocked`);
  const hours = Number(stats.total_hours ?? 0);
  return `${parts.join(', ')}${hours ? `, ${hours}h recorded` : ''}.`;
}

export interface DaySummaryItem {
  title: string;
  status: string;
  work_type?: string | null;
  project?: string | null;
  hours?: number | null;
  work_detail?: string | null;
  blockers?: string | null;
  next_steps?: string | null;
}

export interface DetailedDaySummary {
  /** 2-3 sentences — what tm_daily_updates.summary has always held. */
  summary: string;
  /** The long-form write-up, several paragraphs, stored alongside the update. */
  detailed_summary: string;
  highlights: string[];
  achievements: string[];
  challenges: string[];
  learnings: string[];
  next_day_plan: string[];
}

const DAY_DETAIL_SYSTEM = `You write an employee's end-of-day work record from their confirmed work items.

Rules:
- Use ONLY the items, blockers and metrics supplied. Never invent work, numbers,
  people, tickets or outcomes. If a section has no support in the input, return
  an empty array for it rather than filling it.
- summary: 2-3 factual sentences covering what the day contained.
- detailed_summary: 2-4 short paragraphs (plain text, no markdown headings) that
  a manager could read on its own — what was worked on, how far each thread got,
  what is blocked and what carries into tomorrow. Reference items by their real
  titles.
- highlights: up to 4 one-line points, the most substantial work first.
- achievements: only work whose status is COMPLETED.
- challenges: only blockers, BLOCKED or WAITING items actually present.
- learnings: only what the items state; usually empty. Do not moralise.
- next_day_plan: unfinished items and stated next steps, phrased as short
  forward-looking lines. Empty when everything is complete.

Return JSON: { "summary", "detailed_summary", "highlights": [], "achievements": [],
"challenges": [], "learnings": [], "next_day_plan": [] }`;

/**
 * The long-form counterpart to {@link summariseDay}.
 *
 * Both a person's own submission and the unattended 22:00 run go through this,
 * so an auto-filed day reads the same as a typed one. The deterministic build
 * below is a complete record in its own right, not a placeholder — when OpenAI
 * is unavailable the update still saves with real detail.
 */
export async function detailedDaySummary(
  userId: number,
  stats: Record<string, unknown>,
  items: DaySummaryItem[],
  context: { blockers?: string | null; github?: { commits: number; repos: string[] } | null } = {},
): Promise<AiResult<DetailedDaySummary>> {
  const deterministic = buildDetailedDaySummary(stats, items, context);

  const lines = items.map((i) => {
    const bits = [`- [${i.status}] ${i.title}`];
    if (i.project) bits.push(`(project: ${i.project})`);
    if (i.work_type) bits.push(`(type: ${i.work_type})`);
    if (i.hours) bits.push(`(${i.hours}h)`);
    const head = bits.join(' ');
    const extra = [
      i.work_detail ? `    detail: ${i.work_detail.replace(/\s+/g, ' ').slice(0, 600)}` : null,
      i.blockers ? `    blocker: ${i.blockers.slice(0, 300)}` : null,
      i.next_steps ? `    next: ${i.next_steps.slice(0, 300)}` : null,
    ].filter(Boolean);
    return [head, ...extra].join('\n');
  });

  const parsed = await jsonCompletion<DetailedDaySummary>(
    'day_detailed_summary',
    userId,
    DAY_DETAIL_SYSTEM,
    [
      `Metrics: ${JSON.stringify(stats)}`,
      context.github ? `GitHub activity: ${context.github.commits} commits in ${context.github.repos.join(', ')}` : '',
      context.blockers ? `Blockers the employee recorded: ${context.blockers}` : '',
      '',
      `Work items (${items.length}):`,
      ...lines,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (!parsed?.summary || !parsed.detailed_summary) {
    return {
      ok: false,
      fallback: true,
      data: deterministic,
      message: 'AI analysis unavailable. The update was recorded from your items exactly as entered.',
    };
  }

  const list = (v: unknown, max: number) =>
    Array.isArray(v) ? v.slice(0, max).map((x) => String(x).slice(0, 400)) : [];

  return {
    ok: true,
    fallback: false,
    data: {
      summary: String(parsed.summary).slice(0, 2000),
      detailed_summary: String(parsed.detailed_summary).slice(0, 16000),
      highlights: list(parsed.highlights, 6),
      achievements: list(parsed.achievements, 8),
      challenges: list(parsed.challenges, 8),
      learnings: list(parsed.learnings, 6),
      next_day_plan: list(parsed.next_day_plan, 8),
    },
  };
}

/** Builds the same record from the items alone, with no model involved. */
function buildDetailedDaySummary(
  stats: Record<string, unknown>,
  items: DaySummaryItem[],
  context: { blockers?: string | null; github?: { commits: number; repos: string[] } | null },
): DetailedDaySummary {
  const done = items.filter((i) => i.status === 'COMPLETED');
  const ongoing = items.filter((i) => i.status === 'IN_PROGRESS' || i.status === 'REVIEW');
  const stuck = items.filter((i) => i.status === 'BLOCKED' || i.status === 'WAITING');
  const hours = Number(stats.total_hours ?? 0);

  const paragraphs: string[] = [];
  paragraphs.push(
    `${items.length} work item${items.length === 1 ? '' : 's'} recorded` +
      (hours ? ` across ${hours}h` : '') +
      `: ${done.length} completed, ${ongoing.length} in progress, ${stuck.length} blocked or waiting.` +
      (context.github
        ? ` Drafted from ${context.github.commits} commit${context.github.commits === 1 ? '' : 's'} in ${context.github.repos.join(', ')}.`
        : ''),
  );

  for (const group of [
    { label: 'Completed', list: done },
    { label: 'In progress', list: ongoing },
    { label: 'Blocked or waiting', list: stuck },
  ]) {
    if (!group.list.length) continue;
    paragraphs.push(
      `${group.label}:\n` +
        group.list
          .map((i) => {
            const detail = i.work_detail?.replace(/\s+/g, ' ').trim();
            return `- ${i.title}${i.hours ? ` (${i.hours}h)` : ''}${detail ? ` — ${detail.slice(0, 400)}` : ''}`;
          })
          .join('\n'),
    );
  }

  if (context.blockers) paragraphs.push(`Blockers: ${context.blockers}`);

  return {
    summary: buildDaySummary(stats, items),
    detailed_summary: paragraphs.join('\n\n'),
    highlights: [...done, ...ongoing].slice(0, 4).map((i) => `${i.title} (${i.status.replace('_', ' ').toLowerCase()})`),
    achievements: done.map((i) => i.title),
    challenges: [
      ...stuck.map((i) => `${i.title}${i.blockers ? ` — ${i.blockers}` : ''}`),
      ...(context.blockers ? [context.blockers] : []),
    ],
    learnings: [],
    next_day_plan: [
      ...ongoing.map((i) => i.next_steps?.trim() || `Continue ${i.title}`),
      ...stuck.map((i) => `Unblock ${i.title}`),
    ].slice(0, 8),
  };
}

export async function interpretPerformance(
  userId: number,
  name: string,
  period: string,
  metrics: Record<string, number>,
): Promise<AiResult<{ strengths: string[]; improvements: string[]; summary: string }>> {
  const deterministic = deterministicPerformanceNarrative(name, period, metrics);
  const parsed = await jsonCompletion<{ strengths: string[]; improvements: string[]; summary: string }>(
    'performance_analysis',
    userId,
    `You interpret pre-calculated performance metrics for an internal monthly review.
Use ONLY the numbers supplied. Never invent an achievement, project or metric.
Be constructive and specific. Return JSON with keys: strengths (string[]), improvements (string[]), summary (string, 2 sentences).`,
    `Person: ${name}\nPeriod: ${period}\nMetrics: ${JSON.stringify(metrics)}`,
  );
  if (!parsed?.summary) return { ok: false, fallback: true, data: deterministic };
  return {
    ok: true,
    fallback: false,
    data: {
      strengths: (parsed.strengths ?? []).slice(0, 5),
      improvements: (parsed.improvements ?? []).slice(0, 5),
      summary: parsed.summary,
    },
  };
}

function deterministicPerformanceNarrative(name: string, period: string, m: Record<string, number>) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  if ((m.completion_rate ?? 0) >= 80) strengths.push(`Completed ${Math.round(m.completion_rate)}% of assigned tasks.`);
  else improvements.push(`Completion rate of ${Math.round(m.completion_rate ?? 0)}% has room to improve.`);
  if ((m.deadline_met_rate ?? 0) >= 85) strengths.push(`Met ${Math.round(m.deadline_met_rate)}% of deadlines.`);
  else if (m.deadlines_missed) improvements.push(`${m.deadlines_missed} deadline(s) were missed.`);
  if ((m.critical_completed ?? 0) > 0) strengths.push(`Delivered ${m.critical_completed} critical-priority task(s).`);
  if ((m.daily_update_rate ?? 0) >= 80) strengths.push(`Daily update compliance at ${Math.round(m.daily_update_rate)}%.`);
  else improvements.push('More frequent daily updates would improve visibility.');
  if ((m.tasks_reopened ?? 0) > 2) improvements.push(`${m.tasks_reopened} tasks were reopened after completion.`);
  return {
    strengths,
    improvements,
    summary: `${name} completed ${m.tasks_completed ?? 0} of ${m.tasks_assigned ?? 0} assigned tasks in ${period}, with a ${Math.round(m.completion_rate ?? 0)}% completion rate and ${Math.round(m.deadline_met_rate ?? 0)}% deadline reliability.`,
  };
}

export async function weeklyManagerSummary(
  userId: number,
  metrics: Record<string, unknown>,
): Promise<AiResult<string>> {
  const fallback =
    `This week ${metrics.completed ?? 0} of ${metrics.planned ?? 0} planned tasks were completed. ` +
    `${metrics.overdue ?? 0} task(s) are overdue and ${metrics.blocked ?? 0} are blocked.`;
  const text = await textCompletion(
    'weekly_summary',
    userId,
    'You write a concise weekly operations summary for a manager. Use only the supplied numbers. Cover achievements, risks, overdue items and one suggestion. Maximum 120 words.',
    JSON.stringify(metrics),
  );
  return text ? { ok: true, fallback: false, data: text } : { ok: false, fallback: true, data: fallback };
}

export async function explainReward(
  userId: number,
  name: string,
  reward: string,
  metrics: Record<string, unknown>,
): Promise<AiResult<string>> {
  const fallback = `${name} leads the ${reward} category this month based on the recorded metrics: ${Object.entries(
    metrics,
  )
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
    .join(', ')}.`;
  const text = await textCompletion(
    'reward_explanation',
    userId,
    'You explain in two sentences why a colleague earned an internal monthly award. Use only the supplied metrics. Warm but factual. Never invent achievements.',
    `Person: ${name}\nAward: ${reward}\nMetrics: ${JSON.stringify(metrics)}`,
  );
  return text ? { ok: true, fallback: false, data: text } : { ok: false, fallback: true, data: fallback };
}

export async function improveTaskDescription(userId: number, title: string, description: string) {
  const text = await textCompletion(
    'task_description',
    userId,
    'You rewrite an internal task description so it is clear and actionable. Keep all facts. Add a short "Acceptance" line only if the original implies one. Maximum 120 words. Plain text.',
    `Title: ${title}\nDescription: ${description}`,
  );
  return text
    ? { ok: true, fallback: false, data: text }
    : { ok: false, fallback: true, data: description, message: 'AI is unavailable right now.' };
}

/* ------------------------------------------------------------------ *
 * GitHub activity → daily work items
 * ------------------------------------------------------------------ */

export interface CommitInput {
  sha: string;
  message: string;
  repo: string;
  owner: string;
  committed_at: string;
  additions?: number;
  deletions?: number;
  files_changed?: number;
  project_name?: string | null;
}

const COMMIT_SYSTEM = `You turn a developer's git commits from one day into the work items they would write in a daily update.

Rules:
- Group related commits into ONE work item. Several small commits on the same
  feature are one item, not several. Aim for 1-6 items total.
- title is REQUIRED, 3-9 words, written as human work, not as a commit message.
  Good: "Fixed invoice PDF export". Bad: "fix(pdf): export bug #123".
- description: one or two plain sentences describing what changed and why,
  derived ONLY from the commit messages. Never invent scope, tickets or outcomes.
- status: COMPLETED when the commits read as finished work (fix/add/implement/
  release), otherwise IN_PROGRESS.
- priority: CRITICAL/HIGH only when commits clearly say hotfix, urgent, critical
  or security. Otherwise MEDIUM.
- progress: 100 for COMPLETED, else 50.
- hours: null unless commit messages state a duration. Do not estimate.
- work_type: one of Development, Bug Fix, Testing, Documentation, Deployment,
  Refactor — whichever best fits.
- repos: the repository names the item draws from.
- commit_shas: the short shas (first 7 chars) you grouped into this item.
- tags: up to 4 short lowercase keywords.
- confidence: 0.0-1.0, how clearly the commits support the item.

This update is often filed unattended, so the detail has to stand on its own:
- work_detail: 2-4 sentences a reviewer can read tomorrow without opening the
  repository — which area of the product changed, what the change does, and
  which commits it draws on. Stay strictly within the commit messages.
- technical_notes: the concrete technical surface touched, as the commit
  subjects name it (modules, endpoints, migrations, configs). null if unclear.
- impact: who benefits or what now works, ONLY when the commits state it.
- next_steps: remaining work the commits point to (a TODO, a partial rename,
  a "wip" subject). null when the commits read as finished.

Return JSON: { "items": [ { "title", "description", "work_detail",
"technical_notes", "impact", "next_steps", "status", "priority", "progress",
"hours", "work_type", "project", "repos": [], "commit_shas": [], "tags": [],
"confidence" } ] }`;

/** Deterministic grouping: one item per repository, used when AI is unavailable. */
export function fallbackCommitItems(commits: CommitInput[]): ParsedItem[] {
  const byRepo = new Map<string, CommitInput[]>();
  for (const c of commits) {
    const key = `${c.owner}/${c.repo}`;
    byRepo.set(key, [...(byRepo.get(key) ?? []), c]);
  }

  return [...byRepo.entries()].map(([repoKey, list]) => {
    const subjects = list
      .map((c) => c.message.split('\n')[0].trim())
      .filter((m) => m && !/^merge (branch|pull request)/i.test(m));
    const repoName = repoKey.split('/')[1];
    const additions = list.reduce((s, c) => s + (c.additions ?? 0), 0);
    const deletions = list.reduce((s, c) => s + (c.deletions ?? 0), 0);
    const files = list.reduce((s, c) => s + (c.files_changed ?? 0), 0);
    const times = list.map((c) => new Date(c.committed_at)).sort((a, b) => a.getTime() - b.getTime());

    return {
      topic: repoName,
      title: `Development work on ${repoName}`,
      project: list[0]?.project_name ?? null,
      description:
        `${list.length} commit${list.length === 1 ? '' : 's'} to ${repoKey}` +
        (additions || deletions ? ` (+${additions}/-${deletions} lines)` : '') +
        (subjects.length ? `: ${subjects.slice(0, 6).join('; ')}` : ''),
      work_type: 'Development',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      progress: 50,
      start_time: null,
      end_time: null,
      hours: null,
      blockers: null,
      outcome: null,
      tags: [repoName],
      confidence: 0.5,
      ai_generated_fields: ['title', 'status', 'priority', 'progress'],
      // Without AI grouping the commit list itself is the detail: every
      // subject is kept so the record still says what the day contained.
      work_detail:
        `Committed to ${repoKey} between ${hhmm(times[0])} and ${hhmm(times[times.length - 1])}.\n` +
        subjects.map((m) => `- ${m}`).join('\n'),
      technical_notes:
        additions || deletions || files
          ? `+${additions}/-${deletions} lines across ${files} file${files === 1 ? '' : 's'}.`
          : null,
      impact: null,
      next_steps: null,
      repos: [repoKey],
      commit_shas: list.map((c) => c.sha.slice(0, 7)),
      commit_count: list.length,
      additions,
      deletions,
      files_changed: files,
    };
  });
}

function hhmm(d: Date | undefined) {
  return d ? d.toTimeString().slice(0, 5) : '—';
}

export async function itemsFromCommits(
  commits: CommitInput[],
  userId: number,
  context: { projects: string[]; openTasks: Array<{ task_number: string; title: string }> },
): Promise<AiResult<ParsedItem[]>> {
  if (!commits.length) return { ok: true, fallback: false, data: [] };

  const lines = commits.map(
    (c) =>
      `- [${c.sha.slice(0, 7)}] ${c.owner}/${c.repo}${c.project_name ? ` (project: ${c.project_name})` : ''}: ` +
      `${c.message.split('\n')[0]}` +
      (c.additions !== undefined ? ` (+${c.additions}/-${c.deletions ?? 0}, ${c.files_changed ?? 0} files)` : ''),
  );

  const prompt = [
    `Known projects: ${context.projects.join(', ') || 'none recorded'}`,
    `The developer's open tasks:\n${
      context.openTasks.map((t) => `- ${t.task_number}: ${t.title}`).join('\n') || 'none'
    }`,
    '',
    `Commits (${commits.length}):`,
    ...lines,
  ].join('\n');

  const parsed = await jsonCompletion<{ items: Array<Partial<ParsedItem>> }>(
    'github_commit_items',
    userId,
    COMMIT_SYSTEM,
    prompt,
  );

  if (!parsed?.items?.length) {
    return {
      ok: false,
      fallback: true,
      data: fallbackCommitItems(commits),
      message: 'AI grouping unavailable. Commits were grouped by repository — please review before saving.',
    };
  }

  // Line-change totals are recomputed from the commits the model grouped —
  // never taken from the model itself, which must not invent numbers.
  const bySha = new Map(commits.map((c) => [c.sha.slice(0, 7), c]));

  const clean: ParsedItem[] = parsed.items.slice(0, 12).map((i) => {
    const shas = (Array.isArray(i.commit_shas) ? i.commit_shas : [])
      .map((sha) => String(sha).slice(0, 7))
      .filter((sha) => bySha.has(sha));
    const grouped = shas.map((sha) => bySha.get(sha)!);

    return {
      topic: i.topic ?? null,
      title: String(i.title ?? '').slice(0, 240) || 'Development work',
      project: i.project ?? null,
      description: i.description ?? null,
      work_type: i.work_type ?? 'Development',
      status: i.status ?? 'IN_PROGRESS',
      priority: i.priority ?? 'MEDIUM',
      progress: Math.max(0, Math.min(100, Math.round(Number(i.progress ?? 50)))),
      start_time: null,
      end_time: null,
      hours: i.hours === null || i.hours === undefined ? null : Number(i.hours),
      blockers: null,
      outcome: i.outcome ?? null,
      tags: Array.isArray(i.tags) ? i.tags.slice(0, 6).map(String) : [],
      confidence: Math.max(0, Math.min(1, Number(i.confidence ?? 0.7))),
      ai_generated_fields: Array.isArray(i.ai_generated_fields)
        ? i.ai_generated_fields.map(String)
        : ['title', 'description'],
      work_detail: i.work_detail ?? i.description ?? null,
      technical_notes: i.technical_notes ?? null,
      impact: i.impact ?? null,
      next_steps: i.next_steps ?? null,
      repos: Array.isArray(i.repos)
        ? i.repos.slice(0, 10).map(String)
        : [...new Set(grouped.map((c) => `${c.owner}/${c.repo}`))],
      commit_shas: shas,
      commit_count: grouped.length || undefined,
      additions: grouped.length ? grouped.reduce((sum, c) => sum + (c.additions ?? 0), 0) : undefined,
      deletions: grouped.length ? grouped.reduce((sum, c) => sum + (c.deletions ?? 0), 0) : undefined,
      files_changed: grouped.length ? grouped.reduce((sum, c) => sum + (c.files_changed ?? 0), 0) : undefined,
    };
  });

  return { ok: true, fallback: false, data: clean };
}

/* ------------------------------------------------------------------ *
 * Pasted tables
 *
 * A tracker row is a fact, not prose: it already states its day, its work and
 * its state. Splitting it is therefore done in code (see ./tableUpdates), and
 * the model is asked for one thing only — to turn a terse cell into the written
 * work item a reader of the daily update would expect, without inventing
 * anything that is not in the cell.
 * ------------------------------------------------------------------ */

export interface TableRowInput {
  /** Position in the paste, 1-based — responses are aligned back by it. */
  n: number;
  date: string;
  text: string;
  notes?: string | null;
  /** The sheet's own status. Authoritative: the model never overrides it. */
  status?: string | null;
  /** The written-up task this row came from, when the paste was a task list. */
  task?: TaskBlock | null;
}

/** Small enough that a chunk's reply never truncates mid-item. */
const TABLE_ROWS_PER_CHUNK = 8;

const TABLE_SYSTEM = `You expand rows of an employee's work tracker into full daily-update work items.

Each numbered row below is one completed or in-flight piece of work, written
tersely as a spreadsheet cell. Your job is to write it up properly — NOT to
reinterpret it, split it or merge it.

Rules:
- Return exactly one item per numbered row, in the same order. Never merge rows,
  never drop a row, never add work that is not written.
- Never invent work, numbers, people, tickets, tools or outcomes. If the row
  does not say it, leave the field null.
- title: a short 3-9 word name for the work, e.g. "Rebuilt weekly and monthly
  reports". Condense the row; never copy it whole.
- description (REQUIRED, never null): one or two complete sentences restating
  the row as the employee would report it to a manager. Never repeat the title.
- work_detail (REQUIRED): 2-4 sentences giving the fullest honest account the
  row supports — what was built or changed, which part of the system it touched,
  and what state it ended in. Expand the row's own nouns; do not pad it with
  invented specifics. A one-clause row gets a shorter work_detail.
- technical_notes: the systems, modules, screens, endpoints, formats or tools
  the row actually names (e.g. "Graph API", "Excel workbook", "CSV export").
  null when the row names none.
- impact: who or what this helps, only where the row implies it. null otherwise.
- outcome: the result, when the row is written as delivered. null otherwise.
- next_steps: only if the row mentions something outstanding. null otherwise.
- project: the system or module the row names (e.g. "Accounts System",
  "Query Monitor"), matched to a known project name when one clearly
  corresponds. null when the row names none.
- topic: a 1-3 word grouping for the work, taken from the row's own subject.
- work_type: exactly one of ${WORK_TYPES.join(', ')}, or null when unclear.
- status: one of ${STATUSES.join(', ')}. When the row is given with a status,
  return that status unchanged.
- priority: one of ${PRIORITIES.join(', ')}. MEDIUM unless the row says otherwise.
- progress: integer 0-100. Completed work is 100.
- hours: a number only if the row states a duration, else null.
- blockers: only what the row states is in the way. null otherwise.
- tags: 1-4 short lowercase keywords taken from the row's own words.
- confidence: 0.0-1.0, how directly the row supports what you wrote.
- ai_generated_fields: the field names you inferred rather than read.

Example row: "Added B2C flights-only sale price at cost policy with zero profit." [Completed]
Example item: { "title": "Added B2C flights-only cost-price policy", "description": "Added a policy for B2C flights-only bookings that sets the sale price at cost, so those bookings carry zero profit.", "work_detail": "Introduced a pricing policy covering B2C flights-only sales. The sale price is taken at cost rather than marked up, which makes the profit on those bookings zero by design. The rule applies to the flights-only B2C path specifically.", "technical_notes": "B2C flights-only sale pricing", "impact": "Keeps B2C flights-only pricing at cost as the business intends.", "next_steps": null, "outcome": "B2C flights-only bookings now price at cost with zero profit.", "project": null, "topic": "Pricing", "work_type": "Development", "status": "COMPLETED", "priority": "MEDIUM", "progress": 100, "hours": null, "blockers": null, "tags": ["b2c","pricing","flights"], "confidence": 0.9, "ai_generated_fields": ["work_type","priority"] }

Return JSON: { "items": ParsedItem[] }`;

/** The sheet's status decides the item's state, and its state decides progress. */
function settleRowStatus(item: ParsedItem, row: TableRowInput): ParsedItem {
  const status = row.status ?? item.status;
  const modelled = Number.isFinite(item.progress) ? item.progress : 0;
  const progress =
    status === 'COMPLETED' ? 100
    : status === 'TODO' ? 0
    : modelled > 0 ? modelled
    : status === 'BLOCKED' || status === 'WAITING' ? 40
    : 50;
  return { ...item, status, progress };
}

/** Rows of one day, cut into replies that comfortably fit in one response. */
function chunkTableRows(rows: TableRowInput[]): TableRowInput[][] {
  const chunks: TableRowInput[][] = [];
  for (const { rows: ofDay } of groupByDate(rows)) {
    for (let i = 0; i < ofDay.length; i += TABLE_ROWS_PER_CHUNK) {
      chunks.push(ofDay.slice(i, i + TABLE_ROWS_PER_CHUNK));
    }
  }
  return chunks;
}

/** Local grouping, kept apart from the client-side one in ./tableUpdates. */
function groupByDate(rows: TableRowInput[]): Array<{ date: string; rows: TableRowInput[] }> {
  const byDate = new Map<string, TableRowInput[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.date);
    if (bucket) bucket.push(row);
    else byDate.set(row.date, [row]);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, rows: list }));
}

function buildTablePrompt(chunk: TableRowInput[], context: { projects: string[] }) {
  return [
    `Known projects: ${context.projects.join(', ') || 'none recorded'}`,
    '',
    `These rows were all recorded for ${chunk[0].date}.`,
    `Produce exactly ${chunk.length} item${chunk.length === 1 ? '' : 's'}, one per row below, in the same order:`,
    ...chunk.map((row, i) => {
      const status = row.status ? ` [${row.status.replace('_', ' ').toLowerCase()}]` : '';
      const notes = row.notes ? ` (also noted: ${row.notes})` : '';
      return `${i + 1}. ${row.text}${notes}${status}`;
    }),
  ].join('\n');
}

/**
 * Expands parsed tracker rows into full work items.
 *
 * Every row comes back as an item whatever happens: a chunk the model does not
 * answer is filled deterministically from the row's own words, so a pasted
 * tracker is never partly recorded. The row's date and status survive the round
 * trip untouched — only the prose is the model's.
 */
export async function itemsFromTableRows(
  userId: number,
  rows: TableRowInput[],
  context: { projects: string[] },
): Promise<AiResult<Array<ParsedItem & { row: TableRowInput }>>> {
  if (!rows.length) {
    return { ok: false, fallback: true, data: [], message: 'No rows were found in that paste.' };
  }

  // A pasted task list carries far more than a grid row — its own title,
  // system, type and priority — so it is written up block by block.
  if (rows.every((row) => row.task)) {
    const { items, aiChunks, chunks } = await writeUpTaskBlocks(
      'daily_update_table',
      userId,
      rows.map((row) => row.task as TaskBlock),
      context,
    );
    const data = items.map((item, i) => ({ ...settleRowStatus(item, rows[i]), row: rows[i] }));
    return {
      ok: aiChunks > 0,
      fallback: aiChunks < chunks,
      data,
      message: !aiChunks
        ? `${data.length} tasks read from the paste. AI write-up unavailable — each task kept its own title, type and priority; please review the detail before saving.`
        : aiChunks < chunks
          ? `${data.length} tasks read from the paste. Part of them were written up automatically — please review those items.`
          : `${data.length} tasks read from the paste and written up in full. Nothing is saved until you confirm.`,
    };
  }

  const chunks = chunkTableRows(rows);
  const responses = await mapWithConcurrency(chunks, 4, (chunk) =>
    jsonCompletion<{ items: Array<Partial<ParsedItem>> }>(
      'daily_update_table',
      userId,
      TABLE_SYSTEM,
      buildTablePrompt(chunk, context),
    ),
  );

  const produced = new Map<number, ParsedItem & { row: TableRowInput }>();
  let aiChunks = 0;

  chunks.forEach((chunk, i) => {
    const returned = responses[i]?.items;
    // Positional pairing is only trusted when the model answered one per row;
    // anything else falls back so a row can never take another row's write-up.
    const aligned = !!returned && returned.length === chunk.length;
    if (aligned) aiChunks++;

    chunk.forEach((row, n) => {
      const raw = aligned ? returned[n] : deterministicItem(`${row.text}${row.notes ? ` — ${row.notes}` : ''}`);
      const item = normaliseParsedItem(raw, { group: null, topic: null, line: row.text });
      produced.set(row.n, { ...settleRowStatus(item, row), row });
    });
  });

  const items = rows.map((row) => produced.get(row.n)).filter((i): i is ParsedItem & { row: TableRowInput } => !!i);

  if (!aiChunks) {
    return {
      ok: false,
      fallback: true,
      data: items,
      message:
        'AI write-up unavailable. Every row was kept with its own date and status — please review the detail before saving.',
    };
  }

  return {
    ok: true,
    fallback: aiChunks < chunks.length,
    data: items,
    message:
      aiChunks < chunks.length
        ? `${items.length} tasks read from the paste. Part of it was written up automatically — please review those items.`
        : `${items.length} tasks read from the paste and written up in full. Nothing is saved until you confirm.`,
  };
}
