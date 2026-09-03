'use client';

import useSWR from 'swr';
import { LogOut, Award, Activity } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { fetcher, apiPost, apiPatch } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { ProgressRing, Skeleton } from '@/components/ui/Misc';
import { useSession } from '@/hooks/useSession';
import { fmtDate, timeAgo } from '@/lib/format';

interface ProfileData {
  user: {
    full_name: string; email: string; role: string; avatar_url: string | null; job_title: string | null;
    department_name: string | null; team_name: string | null; leader_name: string | null;
    created_at: string; availability: string;
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
      <PageHeader title="Profile" actions={<Button size="sm" variant="secondary" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</Button>} />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}
        {data && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardContent className="flex flex-col items-center p-6 text-center">
                <Avatar name={data.user.full_name} src={data.user.avatar_url} size="xl" />
                <h2 className="mt-3 text-lg font-semibold text-ink">{data.user.full_name}</h2>
                <p className="text-sm text-muted">{data.user.job_title ?? data.user.role}</p>
                <p className="mt-1 text-xs text-faint">{data.user.team_name ?? data.user.department_name}</p>

                <div className="mt-4 w-full">
                  <Select value={data.user.availability} onChange={(e) => setAvailability(e.target.value)} className="text-sm">
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
                <CardHeader><CardTitle className="flex items-center gap-1.5"><Award className="h-4 w-4 text-muted" /> Achievement Badges</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {data.badges.length === 0 ? (
                    <p className="text-sm text-muted">No badges earned yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {data.badges.map((b) => (
                        <div key={b.code} className="flex flex-col items-center gap-1 rounded-xl border border-line p-3 text-center" style={{ width: 96 }}>
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
                <CardHeader><CardTitle className="flex items-center gap-1.5"><Activity className="h-4 w-4 text-muted" /> Recent Activity</CardTitle></CardHeader>
                <CardContent className="p-0 pt-0">
                  <div className="divide-y divide-line">
                    {data.recent_activity.slice(0, 10).map((a, i) => (
                      <div key={i} className="px-5 py-2.5 text-sm">
                        <span className="text-muted">{a.action.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                        <span className="text-ink">{a.title}</span>
                        <span className="ml-2 text-xs text-faint">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                    {data.recent_activity.length === 0 && <p className="px-5 py-4 text-sm text-muted">No activity yet.</p>}
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
