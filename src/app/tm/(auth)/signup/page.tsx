'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, Select, FieldError, FieldHint } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { apiPost, fetcher, ApiClientError } from '@/lib/client';

interface PublicMeta {
  departments: Array<{ id: number; name: string; code: string }>;
  teams: Array<{ id: number; name: string; code: string; department_id: number }>;
}

export default function SignupPage() {
  const { data: meta } = useSWR<PublicMeta>('/api/tm/meta?public=1', fetcher);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [requestedRole, setRequestedRole] = useState('EMPLOYEE');
  const [jobTitle, setJobTitle] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => setTeamId(''), [departmentId]);

  const teamsForDept = (meta?.teams ?? []).filter((t) => String(t.department_id) === departmentId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiPost('/api/tm/auth/signup', {
        full_name: fullName,
        email,
        password,
        confirm_password: confirm,
        department_id: departmentId ? Number(departmentId) : null,
        team_id: teamId ? Number(teamId) : null,
        requested_role: requestedRole,
        job_title: jobTitle || null,
        employee_code: employeeId || null,
        phone: phone || null,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <Card className="animate-fade-up">
        <CardContent className="p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">Request submitted</h1>
          <p className="mt-2 text-sm text-muted">
            Your account is waiting for Manager approval. You&apos;ll be able to sign in once it&apos;s approved.
          </p>
          <Link href="/tm/login">
            <Button className="mt-6 w-full">Back to sign in</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-up">
      <CardContent className="p-8">
        <h1 className="text-xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-muted">A Manager reviews every new account before it&apos;s active.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cpw">Confirm password</Label>
              <Input id="cpw" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          <FieldHint>At least 8 characters, with a letter and a number or symbol.</FieldHint>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dept">Department</Label>
              <Select id="dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Select department</option>
                {meta?.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="team">Team</Label>
              <Select id="team" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={!departmentId}>
                <option value="">Select team</option>
                {teamsForDept.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="role">Requested role</Label>
              <Select id="role" value={requestedRole} onChange={(e) => setRequestedRole(e.target.value)}>
                <option value="EMPLOYEE">Employee</option>
                <option value="LEADER">Leader</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="title">Job title</Label>
              <Input id="title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="empid">Employee ID (optional)</Label>
              <Input id="empid" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="phone">Mobile (optional)</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <FieldError>{error}</FieldError>

          <Button type="submit" size="lg" className="w-full" loading={pending}>
            Request access
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{' '}
          <Link href="/tm/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
