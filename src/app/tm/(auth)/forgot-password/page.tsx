'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, FieldError } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { apiPost, ApiClientError } from '@/lib/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await apiPost('/api/tm/auth/forgot-password', { email });
      setSent(true);
      setDevToken(res.dev_token ?? null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    return (
      <Card className="animate-fade-up">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">Check your inbox</h1>
          <p className="mt-2 text-sm text-muted">
            If that email is registered, a reset link has been prepared. Contact your Manager if you do not receive it.
          </p>
          {devToken && (
            <Link
              href={`/tm/reset-password?token=${devToken}`}
              className="mt-4 block rounded-xl border border-line bg-bg p-3 text-left text-xs text-muted hover:border-brand/40"
            >
              Development mode — reset link: <span className="font-mono text-brand">/tm/reset-password?token={devToken}</span>
            </Link>
          )}
          <Link href="/tm/login">
            <Button className="mt-6 w-full" variant="secondary">Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-up">
      <CardContent className="p-8">
        <h1 className="text-xl font-semibold text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll prepare a reset link.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" />
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Send reset link
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/tm/login" className="font-medium text-brand hover:underline">Back to sign in</Link>
        </p>
      </CardContent>
    </Card>
  );
}
