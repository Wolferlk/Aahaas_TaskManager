import 'server-only';

/**
 * Email HTML for the Task Management module.
 *
 * Written for Outlook/Word rendering: table layout, inline styles, no flex/grid
 * and no external CSS. The logo is referenced by absolute URL so it resolves in
 * a mail client; when TM_APP_URL is not public the mark degrades to a wordmark.
 */

const BRAND = '#e6182d';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

function appUrl() {
  return (process.env.TM_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  COMPLETED: { bg: '#dcfce7', fg: '#15803d' },
  IN_PROGRESS: { bg: '#dbeafe', fg: '#1d4ed8' },
  BLOCKED: { bg: '#fee2e2', fg: '#b91c1c' },
  WAITING: { bg: '#fef3c7', fg: '#b45309' },
  REVIEW: { bg: '#f3e8ff', fg: '#7e22ce' },
  TODO: { bg: '#f1f5f9', fg: '#475569' },
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#d97706',
  LOW: '#0284c7',
};

function chip(label: string, bg: string, fg: string) {
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:18px;white-space:nowrap;">${esc(label)}</span>`;
}

function shell(title: string, preheader: string, inner: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 28px;border-bottom:1px solid ${LINE};">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:10px;vertical-align:middle;">
              <img src="${appUrl()}/aahaas-logo.png" width="34" height="34" alt="Aahaas"
                   style="display:block;width:34px;height:34px;border:0;outline:none;" />
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.2;">Aahaas</div>
              <div style="font-size:12px;color:${MUTED};line-height:1.2;">Task Management</div>
            </td>
          </tr></table>
        </td>
      </tr>
      ${inner}
      <tr>
        <td style="padding:16px 28px;border-top:1px solid ${LINE};background:#f8fafc;">
          <p style="margin:0;font-size:11px;color:${MUTED};line-height:1.5;">
            Sent automatically by the Aahaas Task Management System.
            <a href="${appUrl()}/tm/daily-updates" style="color:${BRAND};text-decoration:none;">Open the platform</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

export interface DailyUpdateMailItem {
  title: string;
  /** "Module › Section" as recorded on the item; groups the letter body. */
  topic?: string | null;
  description?: string | null;
  work_detail?: string | null;
  impact?: string | null;
  next_steps?: string | null;
  status?: string | null;
  priority?: string | null;
  progress?: number | null;
  hours?: number | null;
  project_name?: string | null;
  task_number?: string | null;
}

export interface DailyUpdateMailInput {
  authorName: string;
  authorTitle?: string | null;
  teamName?: string | null;
  departmentName?: string | null;
  date: string;
  summary?: string | null;
  detailedSummary?: string | null;
  aiGenerated?: boolean;
  /** Filed by the 22:00 cut-off rather than by the author. Always disclosed. */
  autoSubmitted?: boolean;
  blockers?: string | null;
  nextDayPlan?: string | null;
  totalHours: number;
  items: DailyUpdateMailItem[];
  githubCommits?: number;
  /** Salutation and sign-off for the letter body. Defaults are the house style. */
  greeting?: string | null;
  signOff?: string | null;
}

/** Renders newline-separated text (and "- " bullets) as mail-safe HTML. */
function textBlock(value: string, color: string) {
  const lines = value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith('- '));
  if (bullets.length && bullets.length === lines.length) {
    return `<ul style="margin:4px 0 0;padding-left:18px;color:${color};font-size:13px;line-height:1.65;">${lines
      .map((l) => `<li style="padding-bottom:2px;">${esc(l.slice(2))}</li>`)
      .join('')}</ul>`;
  }
  return lines
    .map(
      (l) =>
        `<div style="font-size:13px;color:${color};line-height:1.65;padding-top:4px;">${
          l.startsWith('- ') ? '&bull; ' + esc(l.slice(2)) : esc(l)
        }</div>`,
    )
    .join('');
}

/** A titled panel used by the narrative sections. */
function panel(title: string, body: string, bg: string, border: string, titleColor: string) {
  return `<tr><td style="padding:16px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px;">
      <tr><td style="padding:13px 15px;">
        <div style="font-size:11px;font-weight:700;color:${titleColor};text-transform:uppercase;letter-spacing:.5px;">${esc(title)}</div>
        ${body}
      </td></tr>
    </table>
  </td></tr>`;
}

/* ------------------------------------------------------------------ *
 * The letter body
 *
 * The mail opens as the note a manager expects to read: a salutation, the
 * day's work grouped by module as bullets, the overall line and a sign-off.
 * The metrics and the per-item breakdown follow as the supporting record.
 * ------------------------------------------------------------------ */

/** The module an item is filed under — "Accounts System › Invoice Reporting". */
function groupLabel(item: DailyUpdateMailItem) {
  const topic = (item.topic ?? '').split('\u203a')[0].trim();
  return item.project_name?.trim() || topic || 'Other work';
}

/** Groups items by module, keeping the order they were recorded in. */
function groupForLetter(items: DailyUpdateMailItem[]): Array<[string, DailyUpdateMailItem[]]> {
  const groups = new Map<string, DailyUpdateMailItem[]>();
  for (const item of items) {
    const label = groupLabel(item);
    const list = groups.get(label);
    if (list) list.push(item);
    else groups.set(label, [item]);
  }
  return [...groups.entries()];
}

/** One bullet: the written description, with its state when it is not done. */
function letterLine(item: DailyUpdateMailItem) {
  const text = (item.description ?? '').trim() || item.title;
  const state =
    item.status && item.status !== 'COMPLETED'
      ? ` <span style="color:${MUTED};">(${esc((item.status ?? '').replace('_', ' ').toLowerCase())})</span>`
      : '';
  return `<li style="margin:0 0 5px;font-size:13.5px;color:${INK};line-height:1.6;">${esc(text)}${state}</li>`;
}

/** "the Accounts, OPS and Task Manager work" — reads back what was covered. */
function joinLabels(labels: string[]) {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function letterBody(input: DailyUpdateMailInput, dateLabel: string) {
  const groups = groupForLetter(input.items);
  const greeting = (input.greeting ?? '').trim() || 'Dear Sir,';
  const signOff = (input.signOff ?? '').trim() || 'Best regards,';
  const para = `margin:0 0 12px;font-size:13.5px;color:${INK};line-height:1.7;`;

  const sections = groups
    .map(
      ([label, list]) => `
        <p style="margin:16px 0 5px;font-size:13.5px;font-weight:700;color:${INK};line-height:1.5;">${esc(label)}</p>
        <ul style="margin:0;padding:0 0 0 20px;">${list.map(letterLine).join('')}</ul>`,
    )
    .join('');

  const labels = groups.map(([label]) => label).filter((l) => l !== 'Other work');

  return `<tr><td style="padding:20px 28px 4px;">
    <p style="${para}">${esc(greeting)}</p>
    <p style="${para}">Please find below my development update for today, ${esc(dateLabel)}.</p>
    ${sections || `<p style="${para}">No individual work items were recorded for the day.</p>`}
    ${input.summary ? `<p style="${para}padding-top:14px;">${esc(input.summary)}</p>` : ''}
    ${input.blockers ? `<p style="${para}"><strong>Blockers:</strong> ${esc(input.blockers)}</p>` : ''}
    <p style="${para}padding-top:6px;">Thank you.</p>
    <p style="${para}margin-bottom:4px;">${esc(signOff)}<br />${esc(input.authorName)}</p>
    ${labels.length
      ? `<p style="margin:0;font-size:12px;color:${MUTED};line-height:1.6;">
           The tasks above are based on today&rsquo;s development update, including the ${esc(joinLabels(labels))} work.
         </p>`
      : ''}
  </td></tr>`;
}

export function dailyUpdateEmail(input: DailyUpdateMailInput): { subject: string; html: string } {
  const dateLabel = new Date(input.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const letterDate = new Date(input.date + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const completed = input.items.filter((i) => i.status === 'COMPLETED').length;
  const inProgress = input.items.filter((i) => i.status === 'IN_PROGRESS').length;
  const blocked = input.items.filter((i) => i.status === 'BLOCKED').length;

  const statCell = (value: string | number, label: string, color: string) => `
    <td width="25%" style="padding:0 5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid ${LINE};border-radius:10px;">
        <tr><td align="center" style="padding:12px 6px;">
          <div style="font-size:22px;font-weight:700;color:${color};line-height:1.1;">${esc(value)}</div>
          <div style="font-size:11px;color:${MUTED};padding-top:3px;">${esc(label)}</div>
        </td></tr>
      </table>
    </td>`;

  const rows = input.items
    .map((item) => {
      const s = STATUS_COLORS[item.status ?? 'TODO'] ?? STATUS_COLORS.TODO;
      const meta: string[] = [];
      if (item.project_name) meta.push(esc(item.project_name));
      if (item.task_number) meta.push(esc(item.task_number));
      if (item.hours) meta.push(`${item.hours}h`);

      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid ${LINE};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;">
                <div style="font-size:14px;font-weight:600;color:${INK};line-height:1.4;">${esc(item.title)}</div>
                ${item.description && item.description !== item.title
                  ? `<div style="font-size:12.5px;color:${MUTED};line-height:1.5;padding-top:3px;">${esc(item.description)}</div>`
                  : ''}
                ${item.work_detail && item.work_detail !== item.description
                  ? `<div style="font-size:12.5px;color:#475569;line-height:1.6;padding-top:5px;white-space:pre-line;">${esc(item.work_detail)}</div>`
                  : ''}
                ${item.impact
                  ? `<div style="font-size:12px;color:#15803d;line-height:1.5;padding-top:5px;"><strong>Impact:</strong> ${esc(item.impact)}</div>`
                  : ''}
                ${item.next_steps
                  ? `<div style="font-size:12px;color:#1d4ed8;line-height:1.5;padding-top:3px;"><strong>Next:</strong> ${esc(item.next_steps)}</div>`
                  : ''}
                ${meta.length
                  ? `<div style="font-size:11px;color:#94a3b8;padding-top:5px;">${meta.join(' &middot; ')}</div>`
                  : ''}
              </td>
              <td align="right" style="vertical-align:top;padding-left:12px;white-space:nowrap;">
                ${chip((item.status ?? 'TODO').replace('_', ' '), s.bg, s.fg)}
                ${item.priority && item.priority !== 'MEDIUM'
                  ? `<div style="padding-top:5px;font-size:11px;font-weight:600;color:${PRIORITY_COLORS[item.priority] ?? MUTED};">${esc(item.priority)}</div>`
                  : ''}
                ${typeof item.progress === 'number'
                  ? `<div style="padding-top:4px;font-size:11px;color:${MUTED};">${item.progress}%</div>`
                  : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join('');

  const who = [input.authorTitle, input.teamName ?? input.departmentName].filter(Boolean).join(' &middot; ');

  const inner = `
      ${input.autoSubmitted
        ? `<tr><td style="padding:16px 28px 0;">
             <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
               <tr><td style="padding:11px 15px;">
                 <div style="font-size:12.5px;color:#92400e;line-height:1.55;">
                   <strong>Filed automatically.</strong> No update had been submitted by the 22:00 cut-off,
                   so this one was drafted from ${input.githubCommits ?? 0} GitHub commit${input.githubCommits === 1 ? '' : 's'}
                   for the day. ${esc(input.authorName)} has been asked to review and correct it.
                 </div>
               </td></tr>
             </table>
           </td></tr>`
        : ''}
      <tr><td style="padding:24px 28px 6px;">
        <div style="font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Daily Update</div>
        <h1 style="margin:6px 0 2px;font-size:20px;font-weight:700;color:${INK};line-height:1.3;">${esc(input.authorName)}</h1>
        <div style="font-size:13px;color:${MUTED};">${who ? who + ' &middot; ' : ''}${esc(dateLabel)}</div>
      </td></tr>

      ${letterBody(input, letterDate)}

      <tr><td style="padding:16px 23px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${statCell(completed, 'Completed', '#15803d')}
          ${statCell(inProgress, 'In Progress', '#1d4ed8')}
          ${statCell(blocked, 'Blocked', blocked ? '#b91c1c' : MUTED)}
          ${statCell(input.totalHours ? `${input.totalHours}h` : '—', 'Logged', INK)}
        </tr></table>
      </td></tr>

      ${input.detailedSummary && input.detailedSummary.trim() !== (input.summary ?? '').trim()
        ? panel('The day in detail', textBlock(input.detailedSummary, INK), '#f8fafc', LINE, INK)
        : ''}

      <tr><td style="padding:22px 28px 0;">
        <div style="font-size:12px;font-weight:700;color:${INK};text-transform:uppercase;letter-spacing:.5px;">
          Detailed breakdown (${input.items.length})
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:2px;">
          ${rows || `<tr><td style="padding:14px 0;font-size:13px;color:${MUTED};">No individual work items were recorded.</td></tr>`}
        </table>
      </td></tr>

      ${input.nextDayPlan
        ? panel('Planned next', textBlock(input.nextDayPlan, INK), '#eff6ff', '#bfdbfe', '#1d4ed8')
        : ''}

      ${input.githubCommits
        ? `<tr><td style="padding:14px 28px 0;">
             <div style="font-size:12px;color:${MUTED};">
               Includes activity from ${input.githubCommits} GitHub commit${input.githubCommits === 1 ? '' : 's'}.
             </div>
           </td></tr>`
        : ''}

      <tr><td style="padding:24px 28px 26px;">
        <a href="${appUrl()}/tm/daily-updates/history"
           style="display:inline-block;background:${BRAND};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px;">
          View in Task Management
        </a>
      </td></tr>`;

  return {
    subject: `Daily Update${input.autoSubmitted ? ' (auto)' : ''} — ${input.authorName} — ${dateLabel}`,
    html: shell(`Daily Update — ${input.authorName}`, `${completed} completed, ${inProgress} in progress`, inner),
  };
}

/** Small confirmation used by the Settings test-email button. */
export function testEmail(triggeredByName: string): { subject: string; html: string } {
  const inner = `
      <tr><td style="padding:26px 28px;">
        <h1 style="margin:0 0 8px;font-size:19px;font-weight:700;color:${INK};">Test email delivered</h1>
        <p style="margin:0;font-size:14px;color:${MUTED};line-height:1.6;">
          Microsoft Graph delivery is working. Daily Update emails will be sent to the
          recipients configured on this list.
        </p>
        <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;">Triggered by ${esc(triggeredByName)}.</p>
      </td></tr>`;
  return { subject: 'Aahaas Task Management — test email', html: shell('Test email', 'Graph delivery works', inner) };
}
