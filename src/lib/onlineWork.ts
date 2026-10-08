import 'server-only';
import crypto from 'node:crypto';
import { z } from 'zod';
import { execute, query, queryOne } from './db';
import { audit } from './api';
import { sha256 } from './auth';
import { saveDailyUpdate, type DailyUpdatePayload } from './dailyUpdates';
import { awardBadgesQuietly } from './badges';
import { DEV_ADMIN_EMAIL } from './devAdmin';
import type { SessionUser } from './types';

/**
 * The bridge from Aahaas Online Work.
 *
 * Online Work is where most people file their day; this module is where the
 * same day becomes a Daily Update without anyone typing it twice. Online Work
 * pushes every saved filing to one signed endpoint, and everything below
 * decides three things about it:
 *
 *   who it belongs to   — an explicit link if there is one; otherwise the same
 *                         email, or the Online Work username at the same email
 *                         domain. A person nothing matches links by hand with a
 *                         one-time code issued on Online Work and typed here.
 *   whether to write it — a day the person typed or edited here is theirs and
 *                         is never overwritten; it is parked as a conflict they
 *                         settle from their profile.
 *   how to write it     — through `saveDailyUpdate`, the same gate the review
 *                         screen and the 22:00 sweep use, so a synced day is
 *                         summarised, mailed, audited and badged like any other.
 *
 * Trust: the endpoint believes an identity because the request is signed with
 * a secret only the two servers hold, and Online Work only ever sends the
 * identity of the signed-in person who saved the filing.
 */

/* ------------------------------------------------------------------ *
 * Wire format
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const identitySchema = z.object({
  id: z.string().regex(UUID, 'Not an Online Work user id.'),
  email: z.string().trim().max(190),
  username: z.string().trim().max(120).default(''),
  name: z.string().trim().max(150).default(''),
  employeeCode: z.string().trim().max(60).nullable().default(null),
});
export type OwIdentity = z.infer<typeof identitySchema>;

const OW_STATUSES = ['planned', 'in_progress', 'done', 'blocked', 'carried_over'] as const;
const OW_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

const owTaskSchema = z.object({
  id: z.string().max(64),
  title: z.string().trim().max(140),
  description: z.string().max(2000).default(''),
  category: z.string().max(40).default('other'),
  status: z.enum(OW_STATUSES).default('planned'),
  priority: z.enum(OW_PRIORITIES).default('normal'),
  minutes: z.number().int().min(0).max(24 * 60).default(0),
  ref: z.string().trim().max(60).default(''),
});

const owFilingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayStatus: z.string().max(20).default('working'),
  location: z.string().max(20).default('office'),
  start: z.string().max(5),
  end: z.string().max(5),
  breakMinutes: z.number().int().min(0).max(480).default(0),
  tasks: z.array(owTaskSchema).max(40),
  blockers: z.string().max(2000).default(''),
  handover: z.string().max(2000).default(''),
  state: z.enum(['draft', 'submitted']),
  submittedAt: z.string().max(40).nullable().optional(),
  updatedAt: z.string().max(40),
  late: z.boolean().optional(),
});
export type OwFiling = z.infer<typeof owFilingSchema>;

export const hookSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), identity: identitySchema }),
  z.object({ action: z.literal('link-code'), identity: identitySchema }),
  z.object({
    action: z.literal('filing'),
    identity: identitySchema,
    filing: owFilingSchema,
    /** Sent as part of catching up on old days, rather than saved just now. */
    backfill: z.boolean().default(false),
  }),
]);

/* ------------------------------------------------------------------ *
 * Signature
 *
 *   x-aahaas-timestamp  unix milliseconds
 *   x-aahaas-nonce      random, single use
 *   x-aahaas-signature  hex HMAC-SHA256(secret, `${timestamp}.${nonce}.${body}`)
 *
 * Five minutes of clock skew is allowed. A nonce is remembered for twice that,
 * so a captured request cannot be replayed inside the window either — and a
 * replay that slipped through would still find the day unchanged and no-op.
 * ------------------------------------------------------------------ */

const SKEW_MS = 5 * 60_000;
const seenNonces = new Map<string, number>();

/**
 * Whether schema_05 has been applied. Readers that merely decorate a list with
 * "from Online Work" ask first, so a server deployed before `db:migrate` keeps
 * working. Only a yes is cached; a no is asked again until the tables appear.
 */
let tablesReady = false;
export async function onlineWorkTablesReady(): Promise<boolean> {
  if (tablesReady) return true;
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'tm_online_work_filings'`,
  );
  tablesReady = Number(row?.n ?? 0) > 0;
  return tablesReady;
}

export function onlineWorkConfigured(): boolean {
  return (process.env.ONLINE_WORK_SYNC_SECRET ?? '').length >= 32;
}

export function verifySignature(headers: Headers, body: string): string | null {
  const secret = process.env.ONLINE_WORK_SYNC_SECRET ?? '';
  if (secret.length < 32) return 'The Online Work bridge is not configured on Task Manager.';

  const ts = headers.get('x-aahaas-timestamp') ?? '';
  const nonce = headers.get('x-aahaas-nonce') ?? '';
  const signature = headers.get('x-aahaas-signature') ?? '';
  if (!/^\d{13}$/.test(ts) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return 'The request is not signed.';
  }

  const now = Date.now();
  if (Math.abs(now - Number(ts)) > SKEW_MS) return 'The request signature has expired. Check both server clocks.';

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${nonce}.${body}`).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return 'The request signature does not match.';
  }

  for (const [key, at] of seenNonces) if (now - at > SKEW_MS * 2) seenNonces.delete(key);
  if (seenNonces.has(nonce)) return 'That request was already received.';
  seenNonces.set(nonce, now);
  return null;
}

/* ------------------------------------------------------------------ *
 * Who is who
 * ------------------------------------------------------------------ */

type MatchedBy = 'EMAIL' | 'USERNAME' | 'CODE';

interface LinkRow {
  id: number;
  user_id: number;
  ow_user_id: string;
  ow_email: string | null;
  ow_name: string | null;
  matched_by: MatchedBy;
  status: 'ACTIVE' | 'REVOKED';
  linked_at: Date;
  last_sync_at: Date | null;
  sync_count: number;
}

interface CandidateRow {
  id: number;
  email: string;
  full_name: string;
  status: string;
  employee_code: string | null;
}

export type Resolution =
  | { linked: true; link: LinkRow; user: { id: number; email: string; full_name: string; status: string }; created: boolean }
  | { linked: false; reason: 'REVOKED' | 'NO_MATCH' | 'TAKEN' | 'MISMATCH' | 'INACTIVE'; message: string };

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

async function candidateByEmail(email: string): Promise<CandidateRow | null> {
  if (!email || email === DEV_ADMIN_EMAIL) return null;
  const rows = await query<CandidateRow>(
    `SELECT id, email, full_name, status, employee_code
       FROM tm_users WHERE LOWER(email) = ? AND deleted_at IS NULL LIMIT 2`,
    [email],
  );
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Same email, or else the Online Work username at the same domain.
 *
 * The username rule is deliberately narrow: `sasindu` on Online Work whose
 * address there is `s.diluranga@aahaas.com` matches `sasindu@aahaas.com` here,
 * and nothing else. A bare-username match across domains would let anyone who
 * signs up with the right local part at gmail.com collect somebody's filings.
 */
async function autoMatch(identity: OwIdentity): Promise<{ candidate: CandidateRow; by: MatchedBy } | null> {
  const email = norm(identity.email);
  const byEmail = await candidateByEmail(email);
  if (byEmail) return { candidate: byEmail, by: 'EMAIL' };

  const domain = email.includes('@') ? email.split('@')[1] : '';
  const username = norm(identity.username);
  if (domain && /^[a-z0-9._-]{2,64}$/.test(username)) {
    const byUsername = await candidateByEmail(`${username}@${domain}`);
    if (byUsername) return { candidate: byUsername, by: 'USERNAME' };
  }
  return null;
}

async function linkFor(owUserId: string): Promise<LinkRow | null> {
  return queryOne<LinkRow>('SELECT * FROM tm_online_work_links WHERE ow_user_id = ? LIMIT 1', [owUserId]);
}

async function activeLinkOfUser(userId: number): Promise<LinkRow | null> {
  return queryOne<LinkRow>(
    "SELECT * FROM tm_online_work_links WHERE user_id = ? AND status = 'ACTIVE' ORDER BY linked_at DESC LIMIT 1",
    [userId],
  );
}

async function writeLink(identity: OwIdentity, userId: number, by: MatchedBy): Promise<LinkRow> {
  await execute(
    `INSERT INTO tm_online_work_links
       (user_id, ow_user_id, ow_email, ow_username, ow_name, ow_employee_code, matched_by, status, linked_at, revoked_at)
     VALUES (?,?,?,?,?,?,?, 'ACTIVE', NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id), ow_email = VALUES(ow_email), ow_username = VALUES(ow_username),
       ow_name = VALUES(ow_name), ow_employee_code = VALUES(ow_employee_code),
       matched_by = VALUES(matched_by), status = 'ACTIVE', linked_at = NOW(), revoked_at = NULL`,
    [userId, identity.id, identity.email || null, identity.username || null, identity.name || null, identity.employeeCode, by],
  );
  return (await linkFor(identity.id))!;
}

/**
 * The Task Manager person behind an Online Work account, linking them on the
 * way when an automatic match is unambiguous.
 */
export async function resolveLink(identity: OwIdentity): Promise<Resolution> {
  const existing = await linkFor(identity.id);

  if (existing?.status === 'REVOKED') {
    return {
      linked: false,
      reason: 'REVOKED',
      message: 'This account was unlinked in Task Manager. Generate a link code to connect it again.',
    };
  }

  if (existing) {
    const user = await queryOne<{ id: number; email: string; full_name: string; status: string }>(
      'SELECT id, email, full_name, status FROM tm_users WHERE id = ? AND deleted_at IS NULL',
      [existing.user_id],
    );
    if (!user) {
      return { linked: false, reason: 'NO_MATCH', message: 'The linked Task Manager account no longer exists.' };
    }
    // Keep what we know about the Online Work side current, cheaply.
    if (norm(existing.ow_email) !== norm(identity.email) || (existing.ow_name ?? '') !== identity.name) {
      await execute('UPDATE tm_online_work_links SET ow_email = ?, ow_name = ?, ow_username = ? WHERE id = ?', [
        identity.email || null,
        identity.name || null,
        identity.username || null,
        existing.id,
      ]);
    }
    return { linked: true, link: existing, user, created: false };
  }

  const match = await autoMatch(identity);
  if (!match) {
    return {
      linked: false,
      reason: 'NO_MATCH',
      message: `No Task Manager account uses ${identity.email || 'this email'}. Link the two accounts with a code.`,
    };
  }

  const { candidate, by } = match;
  // Two different employee codes is two different people, whatever the email says.
  if (candidate.employee_code && identity.employeeCode && norm(candidate.employee_code) !== norm(identity.employeeCode)) {
    return {
      linked: false,
      reason: 'MISMATCH',
      message: 'A Task Manager account has this email but a different employee code. Link them with a code.',
    };
  }
  if (candidate.status !== 'ACTIVE') {
    return {
      linked: false,
      reason: 'INACTIVE',
      message: 'Your Task Manager account is not active yet, so nothing can be filed into it.',
    };
  }
  const taken = await activeLinkOfUser(candidate.id);
  if (taken && taken.ow_user_id !== identity.id) {
    return {
      linked: false,
      reason: 'TAKEN',
      message: 'That Task Manager account is already linked to another Online Work account.',
    };
  }

  const link = await writeLink(identity, candidate.id, by);
  await audit(candidate.id, 'ONLINE_WORK_LINKED', 'USER', candidate.id, null, {
    matched_by: by,
    ow_email: identity.email,
    ow_username: identity.username,
  });
  return {
    linked: true,
    link,
    user: { id: candidate.id, email: candidate.email, full_name: candidate.full_name, status: candidate.status },
    created: true,
  };
}

/* ------------------------------------------------------------------ *
 * Link codes
 *
 * Eight characters from an alphabet with no 0/O, 1/I/L — about 8.5×10¹¹
 * codes, fifteen minutes to live, one use, at most eight wrong guesses per
 * person per quarter hour. A new code retires the person's previous one.
 * ------------------------------------------------------------------ */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MINUTES = 15;
const MAX_FAILED_REDEEMS = 8;

const codeHash = (code: string) => sha256(`ow-link:${code}`);

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function issueLinkCode(identity: OwIdentity): Promise<{ code: string; expiresAt: string }> {
  const bytes = crypto.randomBytes(8);
  const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await execute(
    'UPDATE tm_online_work_link_codes SET expires_at = NOW() WHERE ow_user_id = ? AND used_at IS NULL AND expires_at > NOW()',
    [identity.id],
  );
  await execute(
    `INSERT INTO tm_online_work_link_codes
       (code_hash, ow_user_id, ow_email, ow_username, ow_name, ow_employee_code, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [codeHash(code), identity.id, identity.email || null, identity.username || null, identity.name || null, identity.employeeCode, expires],
  );
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: expires.toISOString() };
}

export type RedeemResult =
  | { ok: true; ow_email: string | null; ow_name: string | null }
  | { ok: false; status: number; error: string };

export async function redeemLinkCode(user: SessionUser, raw: string): Promise<RedeemResult> {
  const failures = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tm_audit_logs
      WHERE user_id = ? AND action = 'ONLINE_WORK_LINK_FAILED' AND created_at > (NOW() - INTERVAL 15 MINUTE)`,
    [user.id],
  );
  if (Number(failures?.n ?? 0) >= MAX_FAILED_REDEEMS) {
    return { ok: false, status: 429, error: 'Too many wrong codes. Wait a few minutes and generate a fresh one.' };
  }

  const code = normalizeCode(raw);
  const row =
    code.length === 8
      ? await queryOne<{
          id: number; ow_user_id: string; ow_email: string | null; ow_username: string | null;
          ow_name: string | null; ow_employee_code: string | null; expired: number; used_at: Date | null;
        }>(
          `SELECT id, ow_user_id, ow_email, ow_username, ow_name, ow_employee_code, used_at,
                  (expires_at <= NOW()) AS expired
             FROM tm_online_work_link_codes WHERE code_hash = ? LIMIT 1`,
          [codeHash(code)],
        )
      : null;

  if (!row || row.used_at || row.expired) {
    await audit(user.id, 'ONLINE_WORK_LINK_FAILED', 'USER', user.id, null, { reason: row ? 'expired_or_used' : 'unknown' });
    return {
      ok: false,
      status: 400,
      error: row ? 'That code has expired or was already used. Generate a new one on Online Work.' : 'That code is not right. Check it and try again.',
    };
  }

  // Claim the code first, so two tabs redeeming at once cannot both win.
  const claimed = await execute(
    'UPDATE tm_online_work_link_codes SET used_at = NOW(), used_by = ? WHERE id = ? AND used_at IS NULL',
    [user.id, row.id],
  );
  if (!claimed.affectedRows) return { ok: false, status: 409, error: 'That code was just used.' };

  // One Online Work account per person here: linking a new one retires the old.
  await execute(
    "UPDATE tm_online_work_links SET status = 'REVOKED', revoked_at = NOW() WHERE user_id = ? AND status = 'ACTIVE' AND ow_user_id <> ?",
    [user.id, row.ow_user_id],
  );
  await writeLink(
    {
      id: row.ow_user_id,
      email: row.ow_email ?? '',
      username: row.ow_username ?? '',
      name: row.ow_name ?? '',
      employeeCode: row.ow_employee_code,
    },
    user.id,
    'CODE',
  );
  await audit(user.id, 'ONLINE_WORK_LINKED', 'USER', user.id, null, { matched_by: 'CODE', ow_email: row.ow_email });
  return { ok: true, ow_email: row.ow_email, ow_name: row.ow_name };
}

export async function unlink(user: SessionUser): Promise<boolean> {
  const res = await execute(
    "UPDATE tm_online_work_links SET status = 'REVOKED', revoked_at = NOW() WHERE user_id = ? AND status = 'ACTIVE'",
    [user.id],
  );
  if (res.affectedRows) await audit(user.id, 'ONLINE_WORK_UNLINKED', 'USER', user.id);
  return res.affectedRows > 0;
}

/* ------------------------------------------------------------------ *
 * Turning a filing into a Daily Update
 * ------------------------------------------------------------------ */

const STATUS_MAP: Record<(typeof OW_STATUSES)[number], string> = {
  planned: 'TODO',
  in_progress: 'IN_PROGRESS',
  done: 'COMPLETED',
  blocked: 'BLOCKED',
  carried_over: 'IN_PROGRESS',
};

const PRIORITY_MAP: Record<(typeof OW_PRIORITIES)[number], string> = {
  low: 'LOW',
  normal: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
};

/** Online Work's categories, in the words the Daily Update screen already uses. */
const WORK_TYPE: Record<string, string | null> = {
  development: 'Development',
  bug_fix: 'Bug Fix',
  testing: 'Testing',
  support: 'Support',
  maintenance: 'Maintenance',
  deployment: 'Deployment',
  research: 'Research',
  documentation: 'Documentation',
  meeting: 'Meeting',
  admin: 'Admin',
  other: null,
};

const OW_STATUS_WORD: Record<(typeof OW_STATUSES)[number], string> = {
  planned: 'Planned', in_progress: 'In progress', done: 'Done', blocked: 'Blocked', carried_over: 'Carried over',
};

const DAY_WORD: Record<string, string> = { working: 'Working', half_day: 'Half day', leave: 'Leave', holiday: 'Holiday' };
const PLACE_WORD: Record<string, string> = { office: 'Office', home: 'Work from home', client_site: 'Client site' };

const TASK_NUMBER = /\bTM-(?:[A-Z0-9]{1,20}-)?\d{4}-\d{6}\b/gi;

const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/** The filing as text, so "show original" on a synced day shows what was filed. */
function renderRaw(f: OwFiling): string {
  const pretty = new Date(`${f.date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const lines = [
    `Filed on Aahaas Online Work — ${pretty}`,
    `${DAY_WORD[f.dayStatus] ?? f.dayStatus} · ${PLACE_WORD[f.location] ?? f.location} · ${f.start}–${f.end} (${f.breakMinutes} min break)`,
    '',
  ];
  f.tasks
    .filter((t) => t.title.trim())
    .forEach((t, i) => {
      const bits = [WORK_TYPE[t.category] ?? 'Other', t.priority === 'normal' ? null : t.priority, t.ref ? `ref ${t.ref}` : null]
        .filter(Boolean)
        .join(' · ');
      lines.push(`${i + 1}. [${OW_STATUS_WORD[t.status]}] ${t.title}${t.minutes ? ` (${duration(t.minutes)})` : ''} — ${bits}`);
      if (t.description.trim()) lines.push(`   ${t.description.trim().replace(/\n/g, '\n   ')}`);
    });
  if (f.blockers.trim()) lines.push('', `Blockers: ${f.blockers.trim()}`);
  if (f.handover.trim()) lines.push('', `Handover: ${f.handover.trim()}`);
  return lines.join('\n');
}

/**
 * The person's own open tasks a filing names by number — "TM-2026-000042" in
 * the reference, title or description. Those items are attached, so a task
 * marked done on Online Work is completed here too.
 */
async function referencedTasks(userId: number, f: OwFiling): Promise<Map<string, number>> {
  const numbers = new Set<string>();
  for (const t of f.tasks) {
    for (const m of `${t.ref} ${t.title} ${t.description}`.matchAll(TASK_NUMBER)) numbers.add(m[0].toUpperCase());
  }
  if (!numbers.size) return new Map();
  const rows = await query<{ id: number; task_number: string }>(
    `SELECT id, task_number FROM tm_tasks
      WHERE task_number IN (?) AND assignee_id = ? AND deleted_at IS NULL`,
    [[...numbers], userId],
  );
  return new Map(rows.map((r) => [r.task_number.toUpperCase(), r.id]));
}

async function toPayload(userId: number, f: OwFiling, sendMail: boolean): Promise<DailyUpdatePayload> {
  const tasks = await referencedTasks(userId, f);
  const attached = new Set<number>();

  const items = f.tasks
    .filter((t) => t.title.trim())
    .map((t) => {
      let taskId: number | null = null;
      for (const m of `${t.ref} ${t.title} ${t.description}`.matchAll(TASK_NUMBER)) {
        const id = tasks.get(m[0].toUpperCase());
        // One item per task moves it forward; a second mention would add its hours twice.
        if (id && !attached.has(id)) {
          taskId = id;
          attached.add(id);
          break;
        }
      }
      const title = t.title.trim();
      return {
        task_id: taskId,
        title: title.length >= 2 ? title : `${title} (task)`,
        description: t.description.trim() || null,
        work_type: WORK_TYPE[t.category] ?? null,
        status: STATUS_MAP[t.status],
        priority: PRIORITY_MAP[t.priority],
        progress: t.status === 'done' ? 100 : null,
        hours: t.minutes ? Math.round((t.minutes / 60) * 100) / 100 : null,
        outcome: t.status === 'carried_over' ? 'Carried over to the next day.' : null,
        tags: t.ref || null,
        ai_generated: false,
        linked_action: taskId ? ('ATTACHED' as const) : ('NONE' as const),
      };
    });

  return {
    update_date: f.date,
    raw_text: renderRaw(f),
    source: 'MANUAL',
    status: f.state === 'submitted' ? 'SUBMITTED' : 'DRAFT',
    blockers: f.blockers.trim() || null,
    detail: { next_day_plan: f.handover.trim() || null },
    items,
    send_mail: sendMail,
  };
}

/** Canonical content of a filing — what decides "this is the same day again". */
function contentHash(f: OwFiling): string {
  return sha256(
    JSON.stringify([
      f.date, f.state, f.dayStatus, f.location, f.start, f.end, f.breakMinutes, f.blockers.trim(), f.handover.trim(),
      f.tasks.map((t) => [t.title.trim(), t.description.trim(), t.category, t.status, t.priority, t.minutes, t.ref]),
    ]),
  );
}

/**
 * What the Daily Update looks like now. Stored after each sync; a different
 * value on the next push means somebody edited the day here in between.
 * Review stamps and the AI summary are left out — they are not the person's edits.
 */
async function fingerprint(dailyUpdateId: number): Promise<string | null> {
  const day = await queryOne<{ status: string; blockers: string | null }>(
    'SELECT status, blockers FROM tm_daily_updates WHERE id = ?',
    [dailyUpdateId],
  );
  if (!day) return null;
  const items = await query<{ title: string; status: string | null; hours: string | null; description: string | null; task_id: number | null }>(
    'SELECT title, status, hours, description, task_id FROM tm_daily_update_items WHERE daily_update_id = ? ORDER BY id',
    [dailyUpdateId],
  );
  return sha256(
    JSON.stringify([
      day.status,
      day.blockers ?? '',
      items.map((i) => [i.title, i.status ?? '', Number(i.hours ?? 0), i.description ?? '', i.task_id ?? 0]),
    ]),
  );
}

async function loadSessionUser(id: number): Promise<SessionUser | null> {
  const row = await queryOne<SessionUser>(
    `SELECT u.id, u.uuid, u.full_name, u.email, u.role, u.status, u.department_id, u.team_id,
            u.job_title, u.avatar_url, u.availability, u.must_change_password,
            d.name AS department_name, t.name AS team_name
       FROM tm_users u
       LEFT JOIN tm_departments d ON d.id = u.department_id
       LEFT JOIN tm_teams t ON t.id = u.team_id
      WHERE u.id = ? AND u.deleted_at IS NULL`,
    [id],
  );
  return row ? { ...row, must_change_password: !!row.must_change_password } : null;
}

interface FilingRow {
  id: number;
  user_id: number;
  daily_update_id: number | null;
  ow_updated_at: string | null;
  content_hash: string;
  tm_fingerprint: string | null;
  outcome: 'SYNCED' | 'CONFLICT' | 'DETACHED' | 'SKIPPED';
  mailed: number;
}

async function recordFiling(
  userId: number,
  owUserId: string,
  f: OwFiling,
  fields: { outcome: FilingRow['outcome']; detail: string | null; dailyUpdateId: number | null; fingerprint: string | null; mailed: boolean },
) {
  await execute(
    `INSERT INTO tm_online_work_filings
       (user_id, ow_user_id, filing_date, daily_update_id, ow_state, ow_updated_at, content_hash, tm_fingerprint,
        outcome, detail, mailed, payload, sync_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON),1)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id), daily_update_id = VALUES(daily_update_id), ow_state = VALUES(ow_state),
       ow_updated_at = VALUES(ow_updated_at), content_hash = VALUES(content_hash),
       tm_fingerprint = VALUES(tm_fingerprint), outcome = VALUES(outcome), detail = VALUES(detail),
       mailed = VALUES(mailed), payload = VALUES(payload), sync_count = sync_count + 1`,
    [
      userId, owUserId, f.date, fields.dailyUpdateId, f.state, f.updatedAt, contentHash(f), fields.fingerprint,
      fields.outcome, fields.detail?.slice(0, 500) ?? null, fields.mailed ? 1 : 0, JSON.stringify(f),
    ],
  );
}

export type SyncState = 'synced' | 'unchanged' | 'skipped' | 'conflict' | 'detached' | 'stale' | 'unlinked' | 'inactive';

export interface SyncOutcome {
  state: SyncState;
  message: string;
  dailyUpdateId?: number | null;
  tmUser?: { name: string; email: string };
  matchedBy?: MatchedBy;
}

/**
 * Whether this write should email the update, the way submitting here would.
 *
 * Once per day, on the first submission, and only for a day that is still
 * current — today or yesterday. Catching up on a month of old filings after a
 * link is made must not put a month of mail in the manager's inbox; the bulk
 * route here takes the same view.
 */
function shouldMail(f: OwFiling, alreadyMailed: boolean, quiet: boolean): boolean {
  if (quiet || alreadyMailed || f.state !== 'submitted') return false;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = new Date(Date.now() - 864e5);
  return f.date >= `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
}

/** Writes the filing as the person's Daily Update and records it. */
async function apply(
  user: SessionUser,
  owUserId: string,
  f: OwFiling,
  alreadyMailed: boolean,
  quiet = false,
): Promise<SyncOutcome> {
  const mailNow = shouldMail(f, alreadyMailed, quiet);
  const result = await saveDailyUpdate(user, await toPayload(user.id, f, mailNow));
  if (f.state === 'submitted') await awardBadgesQuietly(user.id);

  await recordFiling(user.id, owUserId, f, {
    outcome: 'SYNCED',
    detail: null,
    dailyUpdateId: result.id,
    fingerprint: await fingerprint(result.id),
    // A quiet write counts as mailed: a later edit of an old day stays quiet too.
    mailed: alreadyMailed || quiet || !!result.mail.sent,
  });
  await execute(
    'UPDATE tm_online_work_links SET last_sync_at = NOW(), sync_count = sync_count + 1 WHERE ow_user_id = ?',
    [owUserId],
  );
  return {
    state: 'synced',
    message: f.state === 'submitted' ? 'Filed in Task Manager.' : 'Saved in Task Manager as a draft.',
    dailyUpdateId: result.id,
  };
}

/** One person-day at a time, so two quick saves never interleave their writes. */
const chains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).then(work, work);
  chains.set(key, next.catch(() => {}));
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
}

export async function syncFiling(
  identity: OwIdentity,
  filing: OwFiling,
  opts: { backfill?: boolean } = {},
): Promise<SyncOutcome> {
  const resolution = await resolveLink(identity);
  if (!resolution.linked) {
    return { state: resolution.reason === 'INACTIVE' ? 'inactive' : 'unlinked', message: resolution.message };
  }
  const user = await loadSessionUser(resolution.user.id);
  if (!user || user.status !== 'ACTIVE') {
    return { state: 'inactive', message: 'Your Task Manager account is not active, so nothing was filed there.' };
  }
  const who = { tmUser: { name: user.full_name, email: user.email }, matchedBy: resolution.link.matched_by };

  return serialize(`${identity.id}:${filing.date}`, async () => {
    const found = await queryOne<FilingRow>(
      'SELECT * FROM tm_online_work_filings WHERE ow_user_id = ? AND filing_date = ? LIMIT 1',
      [identity.id, filing.date],
    );
    // A ledger row written while this account pointed at somebody else is history, not state.
    const row = found && found.user_id === user.id ? found : null;

    // A slow retry of an older save must not undo a newer one.
    if (row?.ow_updated_at && filing.updatedAt < row.ow_updated_at) {
      return { state: 'stale', message: 'A newer version of this day is already in Task Manager.', dailyUpdateId: row.daily_update_id, ...who };
    }

    if (row?.outcome === 'DETACHED') {
      await recordFiling(user.id, identity.id, filing, {
        outcome: 'DETACHED', detail: 'Kept the Task Manager version.', dailyUpdateId: row.daily_update_id,
        fingerprint: row.tm_fingerprint, mailed: !!row.mailed,
      });
      return { state: 'detached', message: 'You chose to keep the Task Manager version of this day.', dailyUpdateId: row.daily_update_id, ...who };
    }

    if (!filing.tasks.some((t) => t.title.trim())) {
      return { state: 'skipped', message: 'No tasks on this day yet, so there is nothing to send.', ...who };
    }

    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM tm_daily_updates WHERE user_id = ? AND update_date = ?',
      [user.id, filing.date],
    );

    if (existing) {
      const ours = row?.daily_update_id === existing.id && row.outcome === 'SYNCED';
      const current = ours ? await fingerprint(existing.id) : null;

      if (ours && row.content_hash === contentHash(filing) && current === row.tm_fingerprint) {
        return { state: 'unchanged', message: 'Already up to date in Task Manager.', dailyUpdateId: existing.id, ...who };
      }
      if (!ours || current !== row.tm_fingerprint) {
        const detail = ours
          ? 'This day was edited in Task Manager after it was synced.'
          : 'This day was already written in Task Manager.';
        await recordFiling(user.id, identity.id, filing, {
          outcome: 'CONFLICT', detail, dailyUpdateId: existing.id, fingerprint: row?.tm_fingerprint ?? null, mailed: !!row?.mailed,
        });
        return {
          state: 'conflict',
          message: `${detail} Kept it — choose which version wins on your Task Manager profile.`,
          dailyUpdateId: existing.id,
          ...who,
        };
      }
    }

    return { ...(await apply(user, identity.id, filing, !!row?.mailed, !!opts.backfill)), ...who };
  });
}

/* ------------------------------------------------------------------ *
 * Settling a conflict, from the Task Manager side
 * ------------------------------------------------------------------ */

export async function resolveConflict(
  user: SessionUser,
  date: string,
  choice: 'online_work' | 'task_manager',
): Promise<SyncOutcome> {
  const row = await queryOne<FilingRow & { ow_user_id: string; payload: unknown }>(
    `SELECT * FROM tm_online_work_filings
      WHERE user_id = ? AND filing_date = ? AND outcome IN ('CONFLICT','DETACHED') LIMIT 1`,
    [user.id, date],
  );
  if (!row) return { state: 'unchanged', message: 'There is nothing to settle for that day.' };

  if (choice === 'task_manager') {
    await execute(
      "UPDATE tm_online_work_filings SET outcome = 'DETACHED', detail = 'Kept the Task Manager version.' WHERE id = ?",
      [row.id],
    );
    await audit(user.id, 'ONLINE_WORK_CONFLICT_KEPT', 'DAILY_UPDATE', row.daily_update_id, null, { date });
    return { state: 'detached', message: 'Kept your Task Manager version. Online Work edits to this day will no longer be copied.' };
  }

  const parsed = owFilingSchema.safeParse(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
  if (!parsed.success) return { state: 'unchanged', message: 'The Online Work copy of that day could not be read.' };

  // Settling a conflict is a correction, not a new day: it never mails.
  const outcome = await serialize(`${row.ow_user_id}:${date}`, () =>
    apply(user, row.ow_user_id, parsed.data, !!row.mailed, true),
  );
  await audit(user.id, 'ONLINE_WORK_CONFLICT_REPLACED', 'DAILY_UPDATE', outcome.dailyUpdateId ?? null, null, { date });
  return { ...outcome, message: 'Replaced with the Online Work version. Later edits there will flow in again.' };
}

/* ------------------------------------------------------------------ *
 * What the profile card shows
 * ------------------------------------------------------------------ */

export async function linkOverview(user: SessionUser) {
  const link = await activeLinkOfUser(user.id);
  const [days, totals] = await Promise.all([
    query<{ filing_date: string; outcome: string; detail: string | null; ow_state: string; updated_at: Date; daily_update_id: number | null }>(
      `SELECT DATE_FORMAT(filing_date, '%Y-%m-%d') AS filing_date, outcome, detail, ow_state, updated_at, daily_update_id
         FROM tm_online_work_filings WHERE user_id = ?
        ORDER BY (outcome = 'CONFLICT') DESC, filing_date DESC LIMIT 14`,
      [user.id],
    ),
    queryOne<{ synced: number; conflicts: number }>(
      `SELECT SUM(outcome = 'SYNCED') AS synced, SUM(outcome = 'CONFLICT') AS conflicts
         FROM tm_online_work_filings WHERE user_id = ?`,
      [user.id],
    ),
  ]);

  return {
    configured: onlineWorkConfigured(),
    link: link
      ? {
          ow_email: link.ow_email,
          ow_name: link.ow_name,
          matched_by: link.matched_by,
          linked_at: link.linked_at,
          last_sync_at: link.last_sync_at,
          sync_count: link.sync_count,
        }
      : null,
    days,
    synced_days: Number(totals?.synced ?? 0),
    conflicts: Number(totals?.conflicts ?? 0),
  };
}

/** For the status call from Online Work: who this is here, and how they were matched. */
export async function statusFor(identity: OwIdentity) {
  const resolution = await resolveLink(identity);
  if (!resolution.linked) return { linked: false as const, reason: resolution.reason, message: resolution.message };
  const conflicts = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM tm_online_work_filings WHERE ow_user_id = ? AND user_id = ? AND outcome = 'CONFLICT'",
    [identity.id, resolution.user.id],
  );
  return {
    linked: true as const,
    tmUser: { name: resolution.user.full_name, email: resolution.user.email },
    matchedBy: resolution.link.matched_by,
    linkedAt: resolution.link.linked_at,
    lastSyncAt: resolution.link.last_sync_at,
    syncCount: resolution.link.sync_count,
    conflicts: Number(conflicts?.n ?? 0),
    active: resolution.user.status === 'ACTIVE',
  };
}
