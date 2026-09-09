'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, ShieldCheck, KeyRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, PasswordInput, FieldError, FieldHint } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { apiPost, ApiClientError } from '@/lib/client';

interface CodeResult {
  token: string;
  expires_in_minutes: number;
}

/**
 * Password reset without email.
 *
 * Mail delivery is not part of this flow — someone locked out proves
 * themselves with the shared emergency code, and is taken straight to the
 * page where they choose a new password.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = (await apiPost('/api/tm/auth/forgot-password', {
        email,
        code,
      })) as CodeResult;
      // The token is single-use and short-lived; the reset page enforces the
      // password rules and signs every other session out.
      router.replace(`/tm/reset-password?token=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  };

  return (
    <Card className="aurora animate-pop-in">
      <CardContent className="p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
          <KeyRound className="h-6 w-6 animate-pulse-soft text-brand" />
        </div>
        <h1 className="text-gradient text-xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your work address and the emergency code, and you can choose a new password right away.
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

          <div>
            <Label htmlFor="code">Emergency code</Label>
            <PasswordInput
              id="code"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter the emergency code"
            />
            <FieldHint>Ask a Manager if you do not have it.</FieldHint>
          </div>

          <FieldError>{error}</FieldError>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={pending}
            disabled={!email.trim() || !code.trim()}
          >
            <ShieldCheck className="h-4 w-4" /> Continue
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
