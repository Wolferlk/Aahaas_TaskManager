'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, FieldError, FieldHint } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { apiPost, ApiClientError } from '@/lib/client';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

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
      <Card className="animate-fade-up">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted">This reset link is missing a token. Please request a new one.</p>
          <Link href="/tm/forgot-password">
            <Button className="mt-6 w-full">Request new link</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="animate-fade-up">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">Password updated</h1>
          <p className="mt-2 text-sm text-muted">Redirecting you to sign in...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-up">
      <CardContent className="p-8">
        <h1 className="text-xl font-semibold text-ink">Set a new password</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="pw">New password</Label>
            <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <FieldHint>At least 8 characters, with a letter and a number or symbol.</FieldHint>
          </div>
          <div>
            <Label htmlFor="cpw">Confirm password</Label>
            <Input id="cpw" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <FieldError>{error}</FieldError>
          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Update password
          </Button>
        </form>
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
