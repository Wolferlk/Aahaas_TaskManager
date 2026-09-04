import 'server-only';
import { execute } from './db';

/**
 * Outbound mail through Microsoft Graph using the client-credentials flow.
 *
 * Delivery is always best-effort: a failure here is logged to tm_email_log and
 * surfaced to the caller as `ok: false`, but it must never roll back or block
 * the user action that triggered it (submitting a daily update, for example).
 */

const TOKEN_SKEW_MS = 60_000;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function graphConfigured() {
  return Boolean(
    process.env.GRAPH_CLIENT_ID &&
      process.env.GRAPH_TENANT_ID &&
      process.env.GRAPH_CLIENT_SECRET &&
      process.env.GRAPH_USER,
  );
}

function unquote(v: string | undefined) {
  if (!v) return v;
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > Date.now()) return cachedToken.value;

  const tenant = unquote(process.env.GRAPH_TENANT_ID)!;
  const body = new URLSearchParams({
    client_id: unquote(process.env.GRAPH_CLIENT_ID)!,
    client_secret: unquote(process.env.GRAPH_CLIENT_SECRET)!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? `Graph token request failed (${res.status})`);
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export interface Recipient {
  email: string;
  name?: string | null;
}

export interface SendMailInput {
  subject: string;
  html: string;
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  replyTo?: Recipient[];
  scope?: string;
  entityType?: string | null;
  entityId?: number | null;
  triggeredBy?: number | null;
}

const address = (r: Recipient) => ({
  emailAddress: { address: r.email, name: r.name ?? undefined },
});

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; error?: string }> {
  const started = Date.now();
  const allRecipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])].map((r) => r.email);

  const log = async (success: boolean, error?: string) => {
    try {
      await execute(
        `INSERT INTO tm_email_log (scope, subject, recipients, entity_type, entity_id, triggered_by, success, error, duration_ms)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          input.scope ?? 'GENERAL',
          input.subject.slice(0, 300),
          allRecipients.join(', ').slice(0, 60000),
          input.entityType ?? null,
          input.entityId ?? null,
          input.triggeredBy ?? null,
          success ? 1 : 0,
          error?.slice(0, 600) ?? null,
          Date.now() - started,
        ],
      );
    } catch (err) {
      console.error('[tm] email log write failed:', err);
    }
  };

  if (!graphConfigured()) {
    await log(false, 'Microsoft Graph is not configured');
    return { ok: false, error: 'Microsoft Graph is not configured.' };
  }
  if (!input.to.length) {
    await log(false, 'No recipients');
    return { ok: false, error: 'No recipients configured.' };
  }

  try {
    const token = await getToken();
    const sender = unquote(process.env.GRAPH_USER)!;

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: 'HTML', content: input.html },
          toRecipients: input.to.map(address),
          ccRecipients: (input.cc ?? []).map(address),
          bccRecipients: (input.bcc ?? []).map(address),
          replyTo: (input.replyTo ?? []).map(address),
        },
        saveToSentItems: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      let message = `Graph sendMail failed (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        if (text) message = text.slice(0, 300);
      }
      await log(false, message);
      return { ok: false, error: message };
    }

    await log(true);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(false, message);
    console.error('[tm] sendMail failed:', err);
    return { ok: false, error: message };
  }
}

/** Verifies credentials without sending anything. */
export async function verifyGraph(): Promise<{ ok: boolean; error?: string; sender?: string }> {
  if (!graphConfigured()) return { ok: false, error: 'Microsoft Graph environment variables are not set.' };
  try {
    await getToken();
    return { ok: true, sender: unquote(process.env.GRAPH_USER) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
