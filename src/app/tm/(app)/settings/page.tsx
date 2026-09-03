'use client';

import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { Sun, Moon, Monitor, Shield, Sparkles, Bell as BellIcon } from 'lucide-react';
import { fetcher, apiPost, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, FieldError } from '@/components/ui/Field';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface SettingsData {
  ai_available: boolean;
  can_manage: boolean;
}

function SettingsInner() {
  const { theme, setTheme } = useTheme();
  const { data } = useSWR<SettingsData>('/api/tm/settings', fetcher);

  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences and account security" />
      <PageBody className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'light', label: 'Light', icon: Sun },
                { id: 'dark', label: 'Dark', icon: Moon },
                { id: 'system', label: 'System', icon: Monitor },
              ].map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setTheme(opt.id as never)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors',
                      theme === opt.id ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:bg-line/20',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <ChangePasswordCard />

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-muted" /> AI Assistance</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className={cn('flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm', data?.ai_available ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400')}>
              <span className={cn('h-2 w-2 rounded-full', data?.ai_available ? 'bg-emerald-500' : 'bg-amber-500')} />
              {data?.ai_available ? 'AI features are active' : 'AI features are unavailable — daily updates and reports still work with manual entry and calculated metrics.'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><BellIcon className="h-4 w-4 text-muted" /> Email Notifications</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted">Email alerts are disabled by default and require explicit Manager approval before they can be enabled.</p>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiPost('/api/tm/auth/change-password', { current_password: current, password: next, confirm_password: confirm });
      toast({ kind: 'success', title: 'Password updated' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-1.5"><Shield className="h-4 w-4 text-muted" /> Security</CardTitle></CardHeader>
      <CardContent className="pt-0">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" required value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="conf">Confirm</Label>
              <Input id="conf" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" loading={saving}>Update password</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
