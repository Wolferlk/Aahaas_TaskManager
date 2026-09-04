'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Mail, Plus, Trash2, Send, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetcher, apiPost, apiPatch, apiPut, apiDelete, ApiClientError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useMeta } from '@/hooks/useMeta';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Recipient {
  id: number;
  email: string;
  display_name: string | null;
  user_id: number | null;
  user_name: string | null;
  avatar_url: string | null;
  mode: 'TO' | 'CC' | 'BCC';
}

interface EmailLog {
  id: number;
  scope: string;
  subject: string;
  recipients: string;
  success: 0 | 1;
  error: string | null;
  created_at: string;
}

interface EmailData {
  recipients: Recipient[];
  config: { enabled: boolean; include_items: boolean; notify_leader: boolean };
  graph_configured: boolean;
  graph: { ok: boolean; can_send?: boolean; roles?: string[]; sender?: string; error?: string } | null;
  recent: EmailLog[];
  can_manage: boolean;
}

export function EmailSettings() {
  const { data, isLoading, mutate } = useSWR<EmailData>('/api/tm/settings/email?scope=DAILY_UPDATE', fetcher);
  const { users } = useMeta();
  const toast = useToast();

  const [pickUser, setPickUser] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualName, setManualName] = useState('');
  const [mode, setMode] = useState<'TO' | 'CC' | 'BCC'>('TO');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const add = async (payload: { email: string; display_name?: string | null; user_id?: number | null }) => {
    setBusy(true);
    try {
      await apiPost('/api/tm/settings/email', { scope: 'DAILY_UPDATE', mode, ...payload });
      toast({ kind: 'success', title: 'Recipient added' });
      setPickUser('');
      setManualEmail('');
      setManualName('');
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not add recipient' });
    } finally {
      setBusy(false);
    }
  };

  const addFromUser = () => {
    const u = users.find((x) => String(x.id) === pickUser);
    if (!u) return;
    add({ email: u.email, display_name: u.full_name, user_id: u.id });
  };

  const remove = async (id: number) => {
    try {
      await apiDelete(`/api/tm/settings/email?id=${id}`);
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not remove recipient' });
    }
  };

  const toggleConfig = async (patch: Record<string, boolean>) => {
    try {
      await apiPatch('/api/tm/settings/email', patch);
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not save' });
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await apiPut('/api/tm/settings/email', {});
      toast({ kind: 'success', title: res.message });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Test email failed' });
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return null;

  const grouped = {
    TO: data.recipients.filter((r) => r.mode === 'TO'),
    CC: data.recipients.filter((r) => r.mode === 'CC'),
    BCC: data.recipients.filter((r) => r.mode === 'BCC'),
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-muted" /> Delivery status
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {(() => {
            const ready = data.graph_configured && data.graph?.can_send !== false;
            return (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm',
                  ready
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                )}
              >
                {ready ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0">
                  {!data.graph_configured ? (
                    <>
                      <p className="font-medium">Microsoft Graph is not configured</p>
                      <p className="mt-0.5 opacity-90">
                        Set GRAPH_CLIENT_ID, GRAPH_TENANT_ID, GRAPH_CLIENT_SECRET and GRAPH_USER, then restart the app.
                      </p>
                    </>
                  ) : data.graph?.can_send === false ? (
                    <>
                      <p className="font-medium">Graph is connected but cannot send yet</p>
                      <p className="mt-0.5 opacity-90">{data.graph.error}</p>
                      {!!data.graph.roles?.length && (
                        <p className="mt-1 text-xs opacity-75">
                          Granted permissions: {data.graph.roles.join(', ')}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Microsoft Graph is ready</p>
                      <p className="mt-0.5 opacity-90">
                        Sending as {data.graph?.sender}. Daily Update emails go out when a user submits.
                      </p>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {data.can_manage && (
            <div className="mt-4 space-y-3">
              <Toggle
                label="Send an email when a Daily Update is submitted"
                checked={data.config.enabled}
                onChange={(v) => toggleConfig({ enabled: v })}
              />
              <Toggle
                label="Always copy the submitter's team Leader"
                checked={data.config.notify_leader}
                onChange={(v) => toggleConfig({ notify_leader: v })}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={sendTest}
                loading={testing}
                disabled={!data.graph_configured || data.graph?.can_send === false}
              >
                <Send className="h-3.5 w-3.5" /> Send test email
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Mail className="h-4 w-4 text-muted" /> Daily Update recipients
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {(['TO', 'CC', 'BCC'] as const).map((m) => (
            <div key={m}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{m}</p>
              {grouped[m].length === 0 ? (
                <p className="text-sm text-muted">None</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {grouped[m].map((r) => (
                    <span
                      key={r.id}
                      className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2 text-sm"
                    >
                      <Avatar name={r.user_name ?? r.display_name ?? r.email} src={r.avatar_url} size="xs" />
                      <span className="text-ink">{r.display_name ?? r.user_name ?? r.email}</span>
                      <span className="text-xs text-faint">{r.email}</span>
                      {data.can_manage && (
                        <button
                          onClick={() => remove(r.id)}
                          className="rounded-full p-0.5 text-faint hover:bg-red-500/10 hover:text-red-500"
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
          ))}

          {data.can_manage && (
            <div className="space-y-3 border-t border-line pt-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <Label className="text-xs">Add a colleague</Label>
                  <Select value={pickUser} onChange={(e) => setPickUser(e.target.value)} className="!h-9 text-sm">
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
                  <Select value={mode} onChange={(e) => setMode(e.target.value as never)} className="!h-9 !w-24 text-sm">
                    <option value="TO">To</option>
                    <option value="CC">Cc</option>
                    <option value="BCC">Bcc</option>
                  </Select>
                </div>
                <Button size="sm" onClick={addFromUser} loading={busy} disabled={!pickUser}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <Label className="text-xs">Or an external address</Label>
                  <Input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="!h-9 text-sm"
                  />
                </div>
                <div className="min-w-[140px]">
                  <Label className="text-xs">Display name</Label>
                  <Input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="Optional"
                    className="!h-9 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  disabled={!manualEmail}
                  onClick={() => add({ email: manualEmail, display_name: manualName || null })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data.can_manage && data.recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent deliveries</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            <div className="divide-y divide-line">
              {data.recent.map((l) => (
                <div key={l.id} className="flex items-start gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      l.success ? 'bg-emerald-500' : 'bg-red-500',
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-ring relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
      {label}
    </label>
  );
}
