'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  MailCheck, Search, Plus, Trash2, Send, ShieldCheck, AlertTriangle, CheckCircle2,
  Users, UserRound, Crown, Globe2, Sparkles, ChevronDown, Inbox, BellRing, PauseCircle,
} from 'lucide-react';
import { fetcher, apiPost, apiPatch, apiDelete, apiPut, ApiClientError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton, EmptyState } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useMeta } from '@/hooks/useMeta';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Daily-task auto-send mail management.
 *
 * The global recipient list answers "who reads daily updates". This screen
 * answers the narrower question the team actually asks — "when *Sasindu* files
 * his day, where does that mail go?" — one person at a time, with a live
 * preview of the exact addressing the next send will use.
 */

type Mode = 'TO' | 'CC' | 'BCC';
type Source = 'GLOBAL' | 'PERSONAL' | 'AUTHOR' | 'LEADER';

interface Prefs {
  enabled: boolean;
  copy_self: boolean;
  use_global_list: boolean;
  notify_leader: boolean;
}

interface Person {
  id: number;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  job_title: string | null;
  team_name: string | null;
  last_update_date: string | null;
  prefs: Prefs;
}

interface Route {
  id: number;
  user_id: number;
  email: string;
  display_name: string | null;
  recipient_user_id: number | null;
  recipient_name: string | null;
  recipient_avatar: string | null;
  mode: Mode;
}

interface PreviewRecipient {
  email: string;
  name: string | null;
  mode: Mode;
  source: Source;
}

interface RouteData {
  people: Person[];
  routes: Route[];
  config: { enabled: boolean; copy_author: boolean; notify_leader: boolean; greeting: string; sign_off: string };
  preview: { user_id: number; will_send: boolean; reason: string | null; recipients: PreviewRecipient[] } | null;
  sender: string;
  graph_configured: boolean;
  graph: { ok: boolean; can_send?: boolean; roles?: string[]; sender?: string; error?: string } | null;
  recent: Array<{ id: number; subject: string; recipients: string; success: 0 | 1; error: string | null; created_at: string }>;
  can_manage: boolean;
}

const SOURCE_STYLE: Record<Source, { label: string; icon: typeof Globe2; className: string }> = {
  GLOBAL: { label: 'Everyone', icon: Globe2, className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  PERSONAL: { label: 'Personal', icon: MailCheck, className: 'bg-brand-soft text-brand' },
  AUTHOR: { label: 'Author copy', icon: UserRound, className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  LEADER: { label: 'Team leader', icon: Crown, className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

const MODE_STYLE: Record<Mode, string> = {
  TO: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  CC: 'bg-line/60 text-muted',
  BCC: 'bg-slate-500/10 text-slate-500',
};

export function DailyMailRoutes() {
  const [focus, setFocus] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const key = `/api/tm/settings/daily-mail${focus ? `?user_id=${focus}` : ''}`;
  const { data, isLoading, mutate } = useSWR<RouteData>(key, fetcher);
  const toast = useToast();

  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);

  const say = (err: unknown, fallback: string) =>
    toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : fallback });

  const setPrefs = async (userId: number, patch: Partial<Prefs>) => {
    try {
      await apiPatch('/api/tm/settings/daily-mail', { user_id: userId, ...patch });
      mutate();
    } catch (err) {
      say(err, 'Could not save that switch.');
    }
  };

  const setConfig = async (patch: Record<string, boolean | string>) => {
    try {
      await apiPatch('/api/tm/settings/daily-mail', patch);
      mutate();
      toast({ kind: 'success', title: 'Saved' });
    } catch (err) {
      say(err, 'Could not save.');
    }
  };

  const addRoute = async (payload: {
    user_id: number;
    email: string;
    display_name?: string | null;
    recipient_user_id?: number | null;
    mode: Mode;
  }) => {
    setPending(true);
    try {
      await apiPost('/api/tm/settings/daily-mail', payload);
      toast({ kind: 'success', title: 'Recipient added' });
      mutate();
      return true;
    } catch (err) {
      say(err, 'Could not add that recipient.');
      return false;
    } finally {
      setPending(false);
    }
  };

  const removeRoute = async (id: number) => {
    try {
      await apiDelete(`/api/tm/settings/daily-mail?id=${id}`);
      mutate();
    } catch (err) {
      say(err, 'Could not remove that recipient.');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await apiPut('/api/tm/settings/email', {});
      toast({ kind: 'success', title: res.message });
      mutate();
    } catch (err) {
      say(err, 'The test email did not go out.');
    } finally {
      setTesting(false);
    }
  };

  const people = data?.people ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.full_name, p.email, p.team_name, p.job_title].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [people, search]);

  const routesFor = (userId: number) => (data?.routes ?? []).filter((r) => r.user_id === userId);

  if (isLoading) return <Skeleton className="h-[32rem]" />;
  if (!data) return null;

  const ready = data.graph_configured && data.graph?.can_send !== false;
  const muted = people.filter((p) => !p.prefs.enabled).length;
  const routed = new Set((data.routes ?? []).map((r) => r.user_id)).size;

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- *
          The hero: what the system is doing right now, in one glance.
       * ---------------------------------------------------------------- */}
      <Card className="aurora animate-pop-in border-brand/20">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-soft">
                  <MailCheck className="h-5 w-5 text-brand" />
                  {ready && (
                    <span className="absolute inset-0 -z-10 animate-ripple rounded-2xl bg-brand/30" aria-hidden />
                  )}
                </span>
                <div>
                  <h2 className="text-gradient text-lg font-bold leading-tight">Daily task auto-send</h2>
                  <p className="text-xs text-muted">
                    Every recorded day leaves from{' '}
                    <span className="font-medium text-ink">{data.sender}</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Stat icon={Users} value={people.length} label="people" />
                <Stat icon={MailCheck} value={routed} label="with personal routing" tone="brand" />
                <Stat icon={PauseCircle} value={muted} label="muted" tone={muted ? 'warn' : undefined} />
              </div>
            </div>

            <div
              className={cn(
                'flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 text-sm transition-colors',
                ready
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
              )}
            >
              {ready ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 animate-bounce-in" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 animate-pulse-soft" />
              )}
              <div className="min-w-0">
                {!data.graph_configured ? (
                  <>
                    <p className="font-medium">Microsoft Graph is not configured</p>
                    <p className="mt-0.5 text-xs opacity-90">
                      Set GRAPH_CLIENT_ID, GRAPH_TENANT_ID and GRAPH_CLIENT_SECRET, then restart the app.
                    </p>
                  </>
                ) : data.graph?.can_send === false ? (
                  <>
                    <p className="font-medium">Connected, but not allowed to send</p>
                    <p className="mt-0.5 text-xs opacity-90">{data.graph.error}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Graph delivery is live</p>
                    <p className="mt-0.5 text-xs opacity-90">Mail is sent the moment a day is recorded.</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {data.can_manage && (
            <div className="mt-5 grid gap-3 border-t border-line/70 pt-4 sm:grid-cols-2">
              <Toggle
                icon={BellRing}
                label="Send a mail when a day is recorded"
                hint="The master switch for the whole workspace."
                checked={data.config.enabled}
                onChange={(v) => setConfig({ enabled: v })}
              />
              <Toggle
                icon={UserRound}
                label="Copy the author on their own update"
                hint="They keep the same record their readers get."
                checked={data.config.copy_author}
                onChange={(v) => setConfig({ copy_author: v })}
              />
              <Toggle
                icon={Crown}
                label="Always copy the submitter's team Leader"
                hint="Applied unless a person is set otherwise below."
                checked={data.config.notify_leader}
                onChange={(v) => setConfig({ notify_leader: v })}
              />
              <div className="flex items-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={sendTest}
                  loading={testing}
                  disabled={!ready}
                  className="lift"
                >
                  <Send className="h-3.5 w-3.5" /> Send a test email
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------------- *
          Per-person routing.
       * ---------------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <CardTitle className="flex items-center gap-1.5">
            <Inbox className="h-4 w-4 text-muted" /> Who receives each person&apos;s day
          </CardTitle>
          {people.length > 4 && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a person…"
                className="!h-9 pl-8 text-sm"
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          {filtered.length === 0 && (
            <EmptyState icon={Search} title="Nobody matches that" description="Try a different name or address." />
          )}
          <div className="stagger space-y-2.5">
            {filtered.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                routes={routesFor(person.id)}
                open={focus === person.id}
                preview={data.preview?.user_id === person.id ? data.preview : null}
                canManage={data.can_manage}
                pending={pending}
                onToggleOpen={() => setFocus((f) => (f === person.id ? null : person.id))}
                onPrefs={(patch) => setPrefs(person.id, patch)}
                onAdd={addRoute}
                onRemove={removeRoute}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {data.can_manage && data.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-muted" /> Recent daily-update deliveries
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            <div className="stagger divide-y divide-line">
              {data.recent.map((l) => (
                <div key={l.id} className="flex items-start gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      l.success ? 'bg-emerald-500' : 'bg-red-500 animate-pulse-soft',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{l.subject}</p>
                    <p className="truncate text-xs text-faint">{l.recipients}</p>
                    {!l.success && l.error && <p className="mt-0.5 text-xs text-red-500">{l.error}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-faint">{fmtDateTime(l.created_at)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One person's row, and everything behind it.
 * ------------------------------------------------------------------ */

function PersonRow({
  person,
  routes,
  open,
  preview,
  canManage,
  pending,
  onToggleOpen,
  onPrefs,
  onAdd,
  onRemove,
}: {
  person: Person;
  routes: Route[];
  open: boolean;
  preview: { will_send: boolean; reason: string | null; recipients: PreviewRecipient[] } | null;
  canManage: boolean;
  pending: boolean;
  onToggleOpen: () => void;
  onPrefs: (patch: Partial<Prefs>) => void;
  onAdd: (payload: {
    user_id: number;
    email: string;
    display_name?: string | null;
    recipient_user_id?: number | null;
    mode: Mode;
  }) => Promise<boolean>;
  onRemove: (id: number) => void;
}) {
  const { users } = useMeta();
  const [pick, setPick] = useState('');
  const [manual, setManual] = useState('');
  const [manualName, setManualName] = useState('');
  const [mode, setMode] = useState<Mode>('TO');

  const addFromUser = async () => {
    const u = users.find((x) => String(x.id) === pick);
    if (!u) return;
    if (await onAdd({ user_id: person.id, email: u.email, display_name: u.full_name, recipient_user_id: u.id, mode })) {
      setPick('');
    }
  };

  const addManual = async () => {
    if (await onAdd({ user_id: person.id, email: manual, display_name: manualName || null, mode })) {
      setManual('');
      setManualName('');
    }
  };

  return (
    <div
      className={cn(
        'lift rounded-2xl border bg-surface transition-colors',
        open ? 'border-brand/40 shadow-glow' : 'border-line',
        !person.prefs.enabled && 'opacity-70',
      )}
    >
      <button
        onClick={onToggleOpen}
        className="focus-ring flex w-full items-center gap-3 p-3.5 text-left"
        aria-expanded={open}
      >
        <Avatar name={person.full_name} src={person.avatar_url} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium text-ink">{person.full_name}</p>
            {!person.prefs.enabled && (
              <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Muted
              </span>
            )}
            {routes.length > 0 && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">
                {routes.length} personal
              </span>
            )}
          </div>
          <p className="truncate text-xs text-faint">
            {person.email}
            {person.team_name ? ` · ${person.team_name}` : ''}
            {person.last_update_date ? ` · last recorded ${person.last_update_date}` : ' · nothing recorded yet'}
          </p>
        </div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-faint transition-transform duration-300', open && 'rotate-180 text-brand')}
        />
      </button>

      {open && (
        <div className="animate-fade-up space-y-4 border-t border-line px-3.5 pb-4 pt-3.5">
          {/* What the next send will actually address. */}
          <div className="rounded-xl border border-line bg-line/10 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
              <Sparkles className="h-3.5 w-3.5" /> The next send goes to
            </p>
            {!preview ? (
              <Skeleton className="h-10" />
            ) : !preview.will_send ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {preview.reason ?? 'Nothing will be sent.'}
              </p>
            ) : (
              <div className="stagger flex flex-wrap gap-1.5">
                {preview.recipients.map((r) => {
                  const style = SOURCE_STYLE[r.source];
                  const Icon = style.icon;
                  return (
                    <span
                      key={`${r.email}-${r.mode}`}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-xs',
                        style.className,
                      )}
                      title={`${style.label} · ${r.mode}`}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="font-medium">{r.name ?? r.email}</span>
                      <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold', MODE_STYLE[r.mode])}>
                        {r.mode}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {canManage && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle
                icon={BellRing}
                label="Mail this person's day"
                checked={person.prefs.enabled}
                onChange={(v) => onPrefs({ enabled: v })}
              />
              <Toggle
                icon={Globe2}
                label="Also use the workspace list"
                checked={person.prefs.use_global_list}
                onChange={(v) => onPrefs({ use_global_list: v })}
              />
              <Toggle
                icon={UserRound}
                label="Copy them on their own update"
                checked={person.prefs.copy_self}
                onChange={(v) => onPrefs({ copy_self: v })}
              />
              <Toggle
                icon={Crown}
                label="Copy their team Leader"
                checked={person.prefs.notify_leader}
                onChange={(v) => onPrefs({ notify_leader: v })}
              />
            </div>
          )}

          {/* The addresses that see this person and nobody else. */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Personal recipients
            </p>
            {routes.length === 0 ? (
              <p className="text-xs text-muted">
                None yet — this person&apos;s update follows the workspace list only.
              </p>
            ) : (
              <div className="stagger flex flex-wrap gap-2">
                {routes.map((r) => (
                  <span
                    key={r.id}
                    className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2 text-sm"
                  >
                    <Avatar name={r.recipient_name ?? r.display_name ?? r.email} src={r.recipient_avatar} size="xs" />
                    <span className="text-ink">{r.display_name ?? r.recipient_name ?? r.email}</span>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold', MODE_STYLE[r.mode])}>
                      {r.mode}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => onRemove(r.id)}
                        className="rounded-full p-0.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"
                        aria-label={`Remove ${r.email}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {canManage && (
            <div className="space-y-2.5 rounded-xl border border-dashed border-line p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[170px] flex-1">
                  <Label className="text-xs">Add a colleague</Label>
                  <Select value={pick} onChange={(e) => setPick(e.target.value)} className="!h-9 text-sm">
                    <option value="">Select a person…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name} — {u.email}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Field</Label>
                  <Select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as Mode)}
                    className="!h-9 !w-[86px] text-sm"
                  >
                    <option value="TO">To</option>
                    <option value="CC">Cc</option>
                    <option value="BCC">Bcc</option>
                  </Select>
                </div>
                <Button size="sm" onClick={addFromUser} loading={pending} disabled={!pick}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[170px] flex-1">
                  <Label className="text-xs">Or an address</Label>
                  <Input
                    type="email"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    placeholder="name@aahaas.com"
                    className="!h-9 text-sm"
                  />
                </div>
                <div className="min-w-[130px]">
                  <Label className="text-xs">Display name</Label>
                  <Input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Optional"
                    className="!h-9 text-sm"
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={addManual} loading={pending} disabled={!manual}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small shared pieces.
 * ------------------------------------------------------------------ */

function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  tone?: 'brand' | 'warn';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        tone === 'brand'
          ? 'bg-brand-soft text-brand'
          : tone === 'warn'
            ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
            : 'bg-line/40 text-muted',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-bold tabular-nums text-ink">{value}</span>
      {label}
    </span>
  );
}

function Toggle({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-sm text-ink transition-colors hover:bg-line/20">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-ring relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-300',
          checked ? 'bg-brand' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 leading-tight">
          {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', checked ? 'text-brand' : 'text-faint')} />}
          {label}
        </span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-faint">{hint}</span>}
      </span>
    </label>
  );
}
