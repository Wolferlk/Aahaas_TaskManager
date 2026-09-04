'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { LogOut, Award, Activity, Pencil, Save, X, Github } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetcher, apiPost, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, FieldError } from '@/components/ui/Field';
import { ProgressRing, Skeleton } from '@/components/ui/Misc';
import { AvatarUpload } from '@/components/tm/AvatarUpload';
import { useSession } from '@/hooks/useSession';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, timeAgo } from '@/lib/format';

interface ProfileData {
  user: {
    full_name: string;
    email: string;
    role: string;
    avatar_url: string | null;
    job_title: string | null;
    employee_code: string | null;
    phone: string | null;
    department_name: string | null;
    team_name: string | null;
    leader_name: string | null;
    created_at: string;
    availability: string;
  };
  score: number;
  metrics: { tasks_completed: number; tasks_assigned: number };
  badges: Array<{ code: string; name: string; icon: string; tier: string; awarded_at: string }>;
  recent_activity: Array<{ action: string; created_at: string; task_number: string; title: string }>;
  rewards: Array<{ name: string; period_year: number; period_month: number }>;
}

export default function ProfilePage() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const { data, isLoading, mutate } = useSWR<ProfileData>(user ? `/api/tm/users/${user.id}` : null, fetcher);
  const [editing, setEditing] = useState(false);

  const logout = async () => {
    await apiPost('/api/tm/auth/logout');
    router.push('/tm/login');
  };

  const setAvailability = async (availability: string) => {
    await apiPatch(`/api/tm/users/${user!.id}`, { availability });
    mutate();
    refresh();
  };

  return (
    <>
      <PageHeader
        title="Profile"
        actions={
          <Button size="sm" variant="secondary" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        }
      />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}
        {data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardContent className="flex flex-col items-center p-6 text-center">
                <AvatarUpload
                  name={data.user.full_name}
                  src={data.user.avatar_url}
                  onChanged={() => {
                    mutate();
                    refresh();
                  }}
                />

                <h2 className="mt-4 text-lg font-semibold text-ink">{data.user.full_name}</h2>
                <p className="text-sm text-muted">{data.user.job_title ?? data.user.role}</p>
                <p className="mt-1 text-xs text-faint">{data.user.team_name ?? data.user.department_name}</p>

                <div className="mt-4 w-full">
                  <Label className="text-left text-xs">Work status</Label>
                  <Select
                    value={data.user.availability}
                    onChange={(e) => setAvailability(e.target.value)}
                    className="text-sm"
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="BUSY">Busy</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="REMOTE">Remote</option>
                    <option value="OFFLINE">Offline</option>
                  </Select>
                </div>

                <div className="mt-6 flex items-center gap-6">
                  <ProgressRing value={data.score} size={72} stroke={7}>
                    <span className="text-lg font-bold text-ink">{Math.round(data.score)}</span>
                  </ProgressRing>
                  <div className="text-left text-sm text-muted">
                    <p>{data.metrics.tasks_completed} tasks completed</p>
                    <p>Joined {fmtDate(data.user.created_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Account details</CardTitle>
                  {!editing && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {editing ? (
                    <ProfileForm
                      userId={user!.id}
                      initial={data.user}
                      onCancel={() => setEditing(false)}
                      onSaved={() => {
                        setEditing(false);
                        mutate();
                        refresh();
                      }}
                    />
                  ) : (
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Detail label="Full name" value={data.user.full_name} />
                      <Detail label="Email" value={data.user.email} />
                      <Detail label="Job title" value={data.user.job_title} />
                      <Detail label="Employee ID" value={data.user.employee_code} />
                      <Detail label="Mobile" value={data.user.phone} />
                      <Detail label="Role" value={data.user.role} />
                      <Detail label="Department" value={data.user.department_name} />
                      <Detail label="Team" value={data.user.team_name} />
                    </dl>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div className="flex items-center gap-2.5">
                    <Github className="h-5 w-5 text-muted" />
                    <div>
                      <p className="text-sm font-medium text-ink">GitHub</p>
                      <p className="text-xs text-muted">Draft your daily update straight from your commits.</p>
                    </div>
                  </div>
                  <Link href="/tm/settings?tab=github">
                    <Button size="sm" variant="secondary">Manage</Button>
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <Award className="h-4 w-4 text-muted" /> Achievement badges
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {data.badges.length === 0 ? (
                    <p className="text-sm text-muted">No badges earned yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {data.badges.map((b) => (
                        <div
                          key={b.code}
                          className="flex w-24 flex-col items-center gap-1 rounded-xl border border-line p-3 text-center"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
                            <Award className="h-5 w-5" />
                          </div>
                          <p className="text-[11px] font-medium leading-tight text-ink">{b.name}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-muted" /> Recent activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 pt-0">
                  <div className="divide-y divide-line">
                    {data.recent_activity.slice(0, 10).map((a, i) => (
                      <div key={i} className="px-5 py-2.5 text-sm">
                        <span className="text-muted">{a.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                        <span className="text-ink">{a.title}</span>
                        <span className="ml-2 text-xs text-faint">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                    {data.recent_activity.length === 0 && (
                      <p className="px-5 py-4 text-sm text-muted">No activity yet.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value || '—'}</dd>
    </div>
  );
}

function ProfileForm({
  userId,
  initial,
  onCancel,
  onSaved,
}: {
  userId: number;
  initial: ProfileData['user'];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(initial.full_name);
  const [jobTitle, setJobTitle] = useState(initial.job_title ?? '');
  const [employeeCode, setEmployeeCode] = useState(initial.employee_code ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setFullName(initial.full_name);
    setJobTitle(initial.job_title ?? '');
    setEmployeeCode(initial.employee_code ?? '');
    setPhone(initial.phone ?? '');
  }, [initial]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/tm/users/${userId}`, {
        full_name: fullName.trim(),
        job_title: jobTitle.trim() || null,
        employee_code: employeeCode.trim() || null,
        phone: phone.trim() || null,
      });
      toast({ kind: 'success', title: 'Profile updated' });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pf-name">Full name</Label>
          <Input id="pf-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-title">Job title</Label>
          <Input id="pf-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-code">Employee ID</Label>
          <Input id="pf-code" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pf-phone">Mobile</Label>
          <Input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-muted">
        Your role, department and team are managed by a Manager.
      </p>

      <FieldError>{error}</FieldError>

      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          <Save className="h-4 w-4" /> Save changes
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </div>
    </form>
  );
}
