export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  let out: string;
  if (mins < 1) out = 'just now';
  else if (mins < 60) out = `${mins}m`;
  else if (hours < 24) out = `${hours}h`;
  else if (days < 7) out = `${days}d`;
  else out = new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (out === 'just now') return out;
  return future ? `in ${out}` : `${out} ago`;
}

export function fmtDate(date: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString(undefined, opts ?? { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function fmtDueIn(date: string | Date | null | undefined): { label: string; overdue: boolean; soon: boolean } {
  if (!date) return { label: 'No deadline', overdue: false, soon: false };
  const diff = new Date(date).getTime() - Date.now();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const hours = abs / 36e5;

  let label: string;
  if (overdue) {
    label = hours < 24 ? `Overdue ${Math.round(hours)}h` : `Overdue ${Math.round(hours / 24)}d`;
  } else if (hours < 1) {
    label = `Due in ${Math.round(abs / 60000)}m`;
  } else if (hours < 24) {
    label = `Due in ${Math.round(hours)}h`;
  } else {
    label = `Due in ${Math.round(hours / 24)}d`;
  }
  return { label, overdue, soon: !overdue && hours <= 24 };
}

export function toDateInput(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

export function toDateTimeInput(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function pluralize(n: number, word: string, plural?: string): string {
  return `${n} ${n === 1 ? word : (plural ?? word + 's')}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
