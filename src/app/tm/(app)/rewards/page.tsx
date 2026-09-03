'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Trophy, Sparkles, Check, X, Medal } from 'lucide-react';
import { fetcher, apiPost, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { useSession } from '@/hooks/useSession';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface Assignment {
  id: number;
  code: string;
  reward_name: string;
  icon: string;
  description: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  team_name: string | null;
  reason: string;
  ai_explanation: string | null;
  status: string;
  metric_value: string | null;
}

interface LeaderboardRow {
  id: number;
  full_name: string;
  avatar_url: string | null;
  department_name: string | null;
  team_name: string | null;
  score: number;
  points: number;
  rank: number;
}

const RANK_STYLE = ['bg-amber-400 text-amber-950', 'bg-slate-300 text-slate-800', 'bg-orange-400 text-orange-950'];

export default function RewardsPage() {
  const now = new Date();
  const { data, isLoading, mutate } = useSWR<{ assignments: Assignment[]; leaderboard: LeaderboardRow[] }>(
    `/api/tm/rewards?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    fetcher,
  );
  const { can } = useSession();
  const toast = useToast();
  const [proposing, setProposing] = useState(false);

  const propose = async () => {
    setProposing(true);
    try {
      const res = await apiPost('/api/tm/rewards', {});
      toast({ kind: 'success', title: res.message });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not propose rewards' });
    } finally {
      setProposing(false);
    }
  };

  const decide = async (id: number, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await apiPatch('/api/tm/rewards', { id, decision });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update' });
    }
  };

  return (
    <>
      <PageHeader
        title="Monthly Power Reward"
        subtitle={now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        actions={can('tm.reward.approve') && (
          <Button size="sm" onClick={propose} loading={proposing}>
            <Sparkles className="h-4 w-4" /> Propose Winners
          </Button>
        )}
      />
      <PageBody className="space-y-6">
        {isLoading && <Skeleton className="h-96" />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {data && data.assignments.length === 0 && (
              <EmptyState icon={Trophy} title="No rewards proposed yet" description="Metrics are calculated first — AI only explains the result." />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {data?.assignments.map((a) => (
                <Card key={a.id} className="animate-fade-up">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
                        <Trophy className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{a.reward_name}</p>
                        <span className={cn('text-[11px]', a.status === 'APPROVED' ? 'text-emerald-500' : a.status === 'REJECTED' ? 'text-red-500' : 'text-amber-600')}>
                          {a.status}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Avatar name={a.full_name} src={a.avatar_url} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{a.full_name}</p>
                        <p className="truncate text-xs text-faint">{a.team_name ?? a.job_title ?? ''}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted">{a.ai_explanation ?? a.reason}</p>
                    {can('tm.reward.approve') && a.status === 'PROPOSED' && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => decide(a.id, 'APPROVED')}><Check className="h-3.5 w-3.5" /> Approve</Button>
                        <Button size="sm" variant="secondary" onClick={() => decide(a.id, 'REJECTED')}><X className="h-3.5 w-3.5" /> Reject</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-1.5"><Medal className="h-4 w-4 text-muted" /> Leaderboard</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-line">
                {data?.leaderboard.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        r.rank <= 3 ? RANK_STYLE[r.rank - 1] : 'bg-line/50 text-muted',
                      )}
                    >
                      {r.rank}
                    </span>
                    <Avatar name={r.full_name} src={r.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{r.full_name}</p>
                      <p className="truncate text-xs text-faint">{r.team_name ?? r.department_name ?? ''}</p>
                    </div>
                    <span className="text-sm font-semibold text-ink">{Math.round(r.score)}</span>
                  </div>
                ))}
                {data && data.leaderboard.length === 0 && <div className="p-5"><EmptyState title="No activity recorded yet" /></div>}
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
