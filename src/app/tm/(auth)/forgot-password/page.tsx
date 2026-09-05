'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, MailCheck, AlertTriangle, ArrowLeft, KeyRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, FieldError } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { apiPost, ApiClientError } from '@/lib/client';

interface SendResult {
  sent?: boolean;
  delivery_error?: string;
  dev_link?: string;
}

/** Seconds before the same address may be asked for another link. */
const RESEND_SECONDS = 30;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      const res = (await apiPost('/api/tm/auth/forgot-password', { email })) as SendResult;
      setResult(res);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send();
  };

  if (result) {
    // The mailbox is only claimed when Graph actually accepted the message.
    const delivered = result.sent !== false;
    return (
      <Card className="aurora animate-pop-in">
        <CardContent className="p-8 text-center">
          <div
            className={`mx-auto flex h-16 w-16 animate-bounce-in items-center justify-center rounded-3xl ${
              delivered ? 'bg-emerald-500/10' : 'bg-amber-500/10'
            }`}
          >
            {delivered ? (
              <MailCheck className="h-8 w-8 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-amber-500" />
            )}
          </div>

          <h1 className="mt-4 text-lg font-semibold text-ink">
            {delivered ? 'Check your inbox' : 'The link could not be emailed'}
          </h1>

          <p className="mt-2 text-sm text-muted">
            {delivered ? (
              <>
                If <span className="font-medium text-ink">{email}</span> is registered, a reset link is on its
                way. It works once and expires in an hour.
              </>
            ) : (
              <>
                Your reset link was created, but the mail server refused it. Ask a Manager to check the email
                settings, then try again.
              </>
            )}
          </p>

          {!delivered && result.delivery_error && (
            <p className="mt-3 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-left text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              {result.delivery_error}
            </p>
          )}

          {result.dev_link && (
            <Link
              href={result.dev_link.replace(/^https?:\/\/[^/]+/, '')}
              className="mt-4 block rounded-xl border border-line bg-bg p-3 text-left text-xs text-muted transition-colors hover:border-brand/40"
            >
              <span className="font-semibold text-ink">Development mode</span> — open the reset link directly
              <span className="mt-1 block break-all font-mono text-brand">{result.dev_link}</span>
            </Link>
          )}

          <div className="mt-6 space-y-2">
            <Button className="w-full" variant="secondary" onClick={send} loading={pending} disabled={cooldown > 0}>
              {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send another link'}
            </Button>
            <Link href="/tm/login" className="block">
              <Button className="w-full" variant="ghost">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="aurora animate-pop-in">
      <CardContent className="p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
          <KeyRound className="h-6 w-6 animate-pulse-soft text-brand" />
        </div>
        <h1 className="text-gradient text-xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Tell us your work address and we&apos;ll email you a link to choose a new password.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@aahaas.com"
                className="pl-10"
              />
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!email.trim()}>
            Email me a reset link
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
