import 'server-only';
import { query, queryOne } from './db';
import type { Recipient } from './graphMail';

/**
 * Who a Daily Update mail is addressed to.
 *
 * There are three layers and they stack, deliberately:
 *
 *   1. the global list (tm_email_recipients, scope DAILY_UPDATE) — everybody's
 *      update goes here unless the author opts out of it,
 *   2. the author's own routes (tm_daily_mail_routes) — the addresses that
 *      should see *this person's* day and nobody else's, and
 *   3. the automatic copies — the author themselves, and their team Leader.
 *
 * Resolution is shared by the sender and by the management screen, so what a
 * Manager previews is literally what will be addressed.
 */

export const DAILY_MAIL_SETTING_KEY = 'daily_update_email';

export interface DailyMailConfig {
  enabled: boolean;
  include_items: boolean;
  notify_leader: boolean;
  /** Copy the author on their own update, so they hold the same record. */
  copy_author: boolean;
  greeting: string;
  sign_off: string;
}

export const DAILY_MAIL_DEFAULTS: DailyMailConfig = {
  enabled: true,
  include_items: true,
  notify_leader: true,
  copy_author: true,
  greeting: 'Dear Sir,',
  sign_off: 'Best regards,',
};

export async function getDailyMailConfig(): Promise<DailyMailConfig> {
  const row = await queryOne<{ value: unknown }>('SELECT value FROM tm_settings WHERE setting_key = ?', [
    DAILY_MAIL_SETTING_KEY,
  ]);
  const raw = row?.value;
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<DailyMailConfig> | null;
  return { ...DAILY_MAIL_DEFAULTS, ...(parsed ?? {}) };
}

export interface AuthorMailPrefs {
  enabled: boolean;
  copy_self: boolean;
  use_global_list: boolean;
  notify_leader: boolean;
}

export const AUTHOR_PREF_DEFAULTS: AuthorMailPrefs = {
  enabled: true,
  copy_self: true,
  use_global_list: true,
  notify_leader: true,
};

/**
 * The routing tables arrive with schema #4. Until a deployment has run the
 * migration they simply do not exist, and a Daily Update must still be
 * mailed rather than failing — so a missing table degrades to the defaults.
 */
function missingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ER_NO_SUCH_TABLE';
}

export async function getAuthorPrefs(userId: number): Promise<AuthorMailPrefs> {
  try {
    const row = await queryOne<{
      enabled: number;
      copy_self: number;
      use_global_list: number;
      notify_leader: number;
    }>('SELECT enabled, copy_self, use_global_list, notify_leader FROM tm_daily_mail_prefs WHERE user_id = ?', [
      userId,
    ]);
    if (!row) return { ...AUTHOR_PREF_DEFAULTS };
    return {
      enabled: !!row.enabled,
      copy_self: !!row.copy_self,
      use_global_list: !!row.use_global_list,
      notify_leader: !!row.notify_leader,
    };
  } catch (err) {
    if (!missingTable(err)) throw err;
    return { ...AUTHOR_PREF_DEFAULTS };
  }
}

export interface MailRoute {
  id: number;
  user_id: number;
  email: string;
  display_name: string | null;
  recipient_user_id: number | null;
  mode: 'TO' | 'CC' | 'BCC';
  is_active: number;
}

export async function getAuthorRoutes(userId: number): Promise<MailRoute[]> {
  try {
    return await query<MailRoute>(
      `SELECT id, user_id, email, display_name, recipient_user_id, mode, is_active
         FROM tm_daily_mail_routes
        WHERE user_id = ? AND is_active = 1
        ORDER BY FIELD(mode,'TO','CC','BCC'), display_name, email`,
      [userId],
    );
  } catch (err) {
    if (!missingTable(err)) throw err;
    return [];
  }
}

export type RecipientSource = 'GLOBAL' | 'PERSONAL' | 'AUTHOR' | 'LEADER';

export interface ResolvedRecipient extends Recipient {
  mode: 'TO' | 'CC' | 'BCC';
  source: RecipientSource;
}

export interface ResolvedRecipients {
  /** False when nothing will be sent; `reason` says why. */
  willSend: boolean;
  reason?: string;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  /** Every address with the field and the rule that put it there. */
  resolved: ResolvedRecipient[];
  config: DailyMailConfig;
  prefs: AuthorMailPrefs;
}

export interface MailAuthor {
  id: number;
  email: string;
  full_name: string;
  team_id: number | null;
}

const RANK: Record<'TO' | 'CC' | 'BCC', number> = { TO: 0, CC: 1, BCC: 2 };

/**
 * Resolves the full address list for one author's Daily Update.
 *
 * An address that lands in more than one field keeps the most prominent one —
 * a person on the global Cc who is also the author's named To recipient is
 * addressed once, in To.
 */
export async function resolveDailyUpdateRecipients(author: MailAuthor): Promise<ResolvedRecipients> {
  const [config, prefs, routes] = await Promise.all([
    getDailyMailConfig(),
    getAuthorPrefs(author.id),
    getAuthorRoutes(author.id),
  ]);

  const base = { to: [], cc: [], bcc: [], resolved: [], config, prefs };

  if (!config.enabled) {
    return { ...base, willSend: false, reason: 'Daily Update email is switched off for the whole workspace.' };
  }
  if (!prefs.enabled) {
    return { ...base, willSend: false, reason: `Daily Update email is switched off for ${author.full_name}.` };
  }

  const picked = new Map<string, ResolvedRecipient>();
  const add = (email: string, name: string | null, mode: 'TO' | 'CC' | 'BCC', source: RecipientSource) => {
    const key = email.trim().toLowerCase();
    if (!key) return;
    const existing = picked.get(key);
    if (existing) {
      // Keep the strongest field, and prefer a real display name over none.
      if (RANK[mode] < RANK[existing.mode]) existing.mode = mode;
      if (!existing.name && name) existing.name = name;
      return;
    }
    picked.set(key, { email: key, name, mode, source });
  };

  if (prefs.use_global_list) {
    const globals = await query<{ email: string; display_name: string | null; mode: 'TO' | 'CC' | 'BCC' }>(
      `SELECT email, display_name, mode FROM tm_email_recipients
        WHERE scope = 'DAILY_UPDATE' AND is_active = 1`,
    );
    for (const g of globals) add(g.email, g.display_name, g.mode, 'GLOBAL');
  }

  for (const r of routes) add(r.email, r.display_name, r.mode, 'PERSONAL');

  if (config.copy_author && prefs.copy_self) {
    add(author.email, author.full_name, 'CC', 'AUTHOR');
  }

  if (config.notify_leader && prefs.notify_leader && author.team_id) {
    const leader = await queryOne<{ email: string; full_name: string }>(
      `SELECT u.email, u.full_name FROM tm_teams t
         JOIN tm_users u ON u.id = t.leader_user_id
        WHERE t.id = ? AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
      [author.team_id],
    );
    if (leader && leader.email.toLowerCase() !== author.email.toLowerCase()) {
      add(leader.email, leader.full_name, 'CC', 'LEADER');
    }
  }

  const resolved = [...picked.values()].sort((a, b) => RANK[a.mode] - RANK[b.mode]);
  let to = resolved.filter((r) => r.mode === 'TO').map(({ email, name }) => ({ email, name }));
  let cc = resolved.filter((r) => r.mode === 'CC').map(({ email, name }) => ({ email, name }));
  let bcc = resolved.filter((r) => r.mode === 'BCC').map(({ email, name }) => ({ email, name }));

  if (!to.length && !cc.length && !bcc.length) {
    return {
      ...base,
      willSend: false,
      reason: 'No recipient is configured for this person, so there is nowhere to send the update.',
    };
  }

  // Graph rejects a message with no To. When only copies are configured, the
  // first of them is promoted rather than dropping the mail.
  if (!to.length) {
    if (cc.length) {
      to = [cc[0]];
      cc = cc.slice(1);
    } else {
      to = [bcc[0]];
      bcc = bcc.slice(1);
    }
  }

  return { willSend: true, to, cc, bcc, resolved, config, prefs };
}
