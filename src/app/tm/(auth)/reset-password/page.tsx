'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, Lock, ShieldAlert, Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, FieldError } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { apiPost, ApiClientError } from '@/lib/client';

/**
 * The rules the server enforces, restated so a person is not rejected after
 * submitting. `validation.ts` remains the authority; this only mirrors it.
 */
const RULES: Array<{ label: string; test: (v: string) => boolean }> = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'Contains a letter', test: (v) => /[A-Za-z]/.test(v) },
  {
    label: 'Contains a number or symbol',
    test: (v) => /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v),
  },
];

const STRENGTH = [
  { label: 'Too short', bar: 'bg-red-400', text: 'text-red-500' },
  { label: 'Weak', bar: 'bg-orange-400', text: 'text-orange-500' },
  { label: 'Good', bar: 'bg-amber-400', text: 'text-amber-500' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-600' },
];

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const passed = useMemo(() => RULES.map((r) => r.test(password)), [password]);
  const score = passed.filter(Boolean).length + (password.length >= 12 ? 1 : 0);
  const strength = STRENGTH[Math.min(score, STRENGTH.length) - 1] ?? STRENGTH[0];
  const matches = confirm.length > 0 && confirm === password;
  const ready = passed.every(Boolean) && matches;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiPost('/api/tm/auth/reset-password', { token, password, confirm_password: confirm });
      setDone(true);
      setTimeout(() => router.push('/tm/login'), 1800);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <Card className="animate-pop-in">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-16 w-16 animate-bounce-in items-center justify-center rounded-3xl bg-amber-500/10">
            <ShieldAlert className="h-8 w-8 text-amber-500" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">This link is incomplete</h1>
          <p className="mt-2 text-sm text-muted">
            It is missing its token, which usually means the address was cut short when it was copied. Ask for a
            fresh link and open it straight from the email.
          </p>
          <Link href="/tm/forgot-password">
            <Button className="mt-6 w-full">Request a new link</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="aurora animate-pop-in">
        <CardContent className="p-8 text-center">
          <div className="relative mx-auto flex h-16 w-16 animate-bounce-in items-center justify-center rounded-3xl bg-emerald-500/10">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <span className="absolute inset-0 -z-10 animate-ripple rounded-3xl bg-emerald-500/30" aria-hidden />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">Password updated</h1>
          <p className="mt-2 text-sm text-muted">
            Every other session has been signed out. Taking you to the sign-in page…
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="aurora animate-pop-in">
      <CardContent className="p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
          <Lock className="h-6 w-6 text-brand" />
        </div>
        <h1 className="text-gradient text-xl font-bold">Set a new password</h1>
        <p className="mt-1 text-sm text-muted">Choose something you have not used here before.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="pw">New password</Label>
            <div className="relative">
              <Input
                id="pw"
                type={reveal ? 'text' : 'password'}
                required
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-faint transition-colors hover:text-ink"
                aria-label={reveal ? 'Hide password' : 'Show password'}
              >
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {password.length > 0 && (
              <div className="mt-2.5 animate-fade-up">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/60">
                    <div
                      className={cn('h-full origin-left rounded-full transition-all duration-500', strength.bar)}
                      style={{ width: `${(Math.min(score, 4) / 4) * 100}%` }}
                    />
                  </div>
                  <span className={cn('text-xs font-medium', strength.text)}>{strength.label}</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {RULES.map((rule, i) => (
                    <li
                      key={rule.label}
                      className={cn(
                        'flex items-center gap-1.5 text-xs transition-colors',
                        passed[i] ? 'text-emerald-600 dark:text-emerald-400' : 'text-faint',
                      )}
                    >
                      {passed[i] ? (
                        <Check className="h-3.5 w-3.5 animate-bounce-in" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      {rule.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="cpw">Confirm password</Label>
            <Input
              id="cpw"
              type={reveal ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={cn(
                confirm.length > 0 && (matches ? 'border-emerald-500/60' : 'border-red-400/60'),
              )}
            />
            {confirm.length > 0 && !matches && (
              <p className="mt-1.5 animate-fade-up text-xs text-red-500">Both fields must match.</p>
            )}
          </div>

          <FieldError>{error}</FieldError>

          <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!ready}>
            Update password
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/tm/login" className="font-medium text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
