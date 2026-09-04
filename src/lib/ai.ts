import 'server-only';
import OpenAI from 'openai';
import { execute } from './db';

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
}

const PARSER_SYSTEM = `You convert an employee's free-form daily work update into structured work items.

Rules:
- Split the text into distinct work items. One sentence may contain several.
- Never invent work that is not implied by the text.
- title is REQUIRED and must never be empty. Write a short (3-8 word) title that
  summarises the work in your own words, e.g. "Fixed invoice PDF export" or
  "Started B2B booking details page". Do not copy the raw sentence verbatim if it
  is long — condense it. If genuinely nothing can be titled, use "Untitled work item".
- status must be one of: TODO, IN_PROGRESS, BLOCKED, WAITING, REVIEW, COMPLETED.
- priority must be one of: CRITICAL, HIGH, MEDIUM, LOW. Use MEDIUM when unclear.
- progress is an integer 0-100. Completed work is 100.
- hours is a number or null. Only fill it if the text implies a duration.
- start_time/end_time are "HH:MM" 24h strings or null.
- confidence is 0.0-1.0 reflecting how directly the text supports the item.
- ai_generated_fields lists field names you inferred rather than read.

Example input: "Completed invoice PDF export, fixed report filters."
Example output: { "items": [
  { "title": "Completed invoice PDF export", "description": "Completed invoice PDF export.", "status": "COMPLETED", "priority": "MEDIUM", "progress": 100, "topic": "Invoice", "project": null, "work_type": null, "start_time": null, "end_time": null, "hours": null, "blockers": null, "outcome": null, "tags": [], "confidence": 0.9, "ai_generated_fields": [] },
  { "title": "Fixed report filters", "description": "Fixed report filters.", "status": "COMPLETED", "priority": "MEDIUM", "progress": 100, "topic": "Reporting", "project": null, "work_type": null, "start_time": null, "end_time": null, "hours": null, "blockers": null, "outcome": null, "tags": [], "confidence": 0.9, "ai_generated_fields": [] }
] }

Return JSON: { "items": ParsedItem[] }`;

/** Deterministic fallback: split on sentence/bullet boundaries. */
export function fallbackParse(text: string): ParsedItem[] {
  const chunks = text
    .split(/\n+|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter((s) => s.length > 3);

  const donePattern = /\b(completed|finished|done|deployed|delivered|fixed|resolved|closed)\b/i;
  const blockedPattern = /\b(blocked|waiting|stuck|pending|on hold)\b/i;
  const startedPattern = /\b(started|began|working on|in progress|continued)\b/i;

  return chunks.slice(0, 25).map((line) => {
    const status = blockedPattern.test(line)
      ? 'BLOCKED'
      : donePattern.test(line)
        ? 'COMPLETED'
        : startedPattern.test(line)
          ? 'IN_PROGRESS'
          : 'IN_PROGRESS';
    const hoursMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours)\b/i);
    return {
      topic: null,
      title: line.length > 120 ? line.slice(0, 117) + '...' : line,
      project: null,
      description: line,
      work_type: null,
      status,
      priority: /\b(urgent|critical|asap)\b/i.test(line) ? 'HIGH' : 'MEDIUM',
      progress: status === 'COMPLETED' ? 100 : status === 'BLOCKED' ? 40 : 50,
      start_time: null,
      end_time: null,
      hours: hoursMatch ? Number(hoursMatch[1]) : null,
      blockers: blockedPattern.test(line) ? line : null,
      outcome: null,
      tags: [],
      confidence: 0.4,
      ai_generated_fields: ['status', 'priority', 'progress'],
    };
  });
}

export async function parseDailyUpdate(
  text: string,
  userId: number,
  context: { projects: string[]; openTasks: Array<{ task_number: string; title: string }> },
): Promise<AiResult<ParsedItem[]>> {
  const prompt = [
    `Known projects: ${context.projects.join(', ') || 'none recorded'}`,
    `The user's open tasks:\n${
      context.openTasks.map((t) => `- ${t.task_number}: ${t.title}`).join('\n') || 'none'
    }`,
    '',
    'Daily update text:',
    text,
  ].join('\n');

  const parsed = await jsonCompletion<{ items: ParsedItem[] }>('daily_update_parse', userId, PARSER_SYSTEM, prompt);

  if (!parsed?.items?.length) {
    return {
      ok: false,
      fallback: true,
      data: fallbackParse(text),
      message: 'AI analysis unavailable. Your text was split automatically — please review each item before saving.',
    };
  }

  const clean = parsed.items.slice(0, 40).map((i) => ({
    ...i,
    title: String(i.title ?? '').slice(0, 240) || 'Untitled work item',
    progress: Math.max(0, Math.min(100, Math.round(Number(i.progress ?? 0)))),
    confidence: Math.max(0, Math.min(1, Number(i.confidence ?? 0.5))),
    tags: Array.isArray(i.tags) ? i.tags.slice(0, 8).map(String) : [],
    ai_generated_fields: Array.isArray(i.ai_generated_fields) ? i.ai_generated_fields.map(String) : [],
  }));

  return { ok: true, fallback: false, data: clean };
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

Return JSON: { "items": [ { "title", "description", "status", "priority",
"progress", "hours", "work_type", "project", "repos": [], "commit_shas": [],
"tags": [], "confidence" } ] }`;

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
    };
  });
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

  const parsed = await jsonCompletion<{ items: Array<Partial<ParsedItem> & { repos?: string[]; commit_shas?: string[] }> }>(
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

  const clean: ParsedItem[] = parsed.items.slice(0, 12).map((i) => ({
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
    ai_generated_fields: Array.isArray(i.ai_generated_fields) ? i.ai_generated_fields.map(String) : ['title', 'description'],
  }));

  return { ok: true, fallback: false, data: clean };
}
