'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Select, Input } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton, Divider } from '@/components/ui/Misc';
import { StatusBadge } from '@/components/ui/Badge';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/hooks/useSession';
import { History, ChevronDown, ChevronRight, Bot, GitCommit } from 'lucide-react';

interface UpdateItem {
  id: number;
  daily_update_id: number;
  title: string;
  description: string | null;
  status: string | null;
  hours: string | null;
  task_number: string | null;
  project_name: string | null;
  work_type: string | null;
  work_detail: string | null;
  technical_notes: string | null;
  impact: string | null;
  next_steps: string | null;
  collaborators: string | null;
  repos: string | null;
  commit_count: number | null;
  additions: number | null;
  deletions: number | null;
}

interface UpdateRow {
  id: number;
  update_date: string;
  status: string;
  total_hours: string | null;
  summary: string | null;
  full_name: string;
  avatar_url: string | null;
  team_name: string | null;
  department_name: string | null;
  detailed_summary: string | null;
  highlights: string | null;
  achievements: string | null;
  challenges: string | null;
  learnings: string | null;
  collaboration: string | null;
  next_day_plan: string | null;
  focus_area: string | null;
  is_auto_submitted: number | null;
  needs_review: number | null;
}

/** Whether an update carries anything beyond its one-line summary. */
function hasDetail(u: UpdateRow, items: UpdateItem[]) {
  return (
    [u.detailed_summary, u.highlights, u.achievements, u.challenges, u.learnings, u.collaboration, u.next_day_plan].some(
      (v) => v?.trim(),
    ) || items.some((it) => it.work_detail || it.technical_notes || it.impact || it.next_steps)
  );
}

/** A titled block of the day's write-up, rendered only when it has content. */
function Section({ title, body }: { title: string; body: string | null }) {
  if (!body?.trim()) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</p>
      <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

export default function DailyUpdateHistoryPage() {
  const { user } = useSession();
  const [scope, setScope] = useState(user?.role === 'EMPLOYEE' ? 'mine' : 'team');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const params = new URLSearchParams({
    ...(scope === 'team' ? { scope: 'team' } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: '60',
  });

  const { data, isLoading } = useSWR<{ updates: UpdateRow[]; items: UpdateItem[] }>(`/api/tm/daily-updates?${params}`, fetcher);

  return (
    <>
      <PageHeader title="Daily Update History" subtitle="A timeline of recorded work" />
      <PageBody className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {user?.role !== 'EMPLOYEE' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Scope</label>
                <Select value={scope} onChange={(e) => setScope(e.target.value)} className="!h-9 !w-auto text-sm">
                  <option value="mine">My updates</option>
                  <option value="team">Team</option>
                </Select>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!h-9 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!h-9 text-sm" />
            </div>
          </CardContent>
        </Card>

        {isLoading && <Skeleton className="h-96" />}
        {data && data.updates.length === 0 && <EmptyState icon={History} title="No updates in this range" />}

        <div className="relative space-y-0 pl-6">
          {data?.updates.map((u, i) => {
            const items = data.items.filter((it) => it.daily_update_id === u.id);
            return (
              <div key={u.id} className="relative pb-6">
                {i < data.updates.length - 1 && <div className="absolute -left-[19px] top-8 h-full w-px bg-line" />}
                <div className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand-soft" />
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.full_name} src={u.avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{u.full_name}</p>
                        <p className="text-xs text-faint">{fmtDate(u.update_date, { weekday: 'long', month: 'short', day: 'numeric' })} · {u.team_name ?? u.department_name ?? '—'}</p>
                      </div>
                      {u.total_hours && <span className="shrink-0 text-xs text-muted">{u.total_hours}h</span>}
                    </div>
                    {!!u.is_auto_submitted && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        Filed automatically from GitHub after the cut-off
                        {u.needs_review ? ' — still needs review.' : '.'}
                      </p>
                    )}
                    {u.focus_area && <p className="mt-2 text-xs text-faint">Focus: {u.focus_area}</p>}
                    {u.summary && <p className="mt-2 text-sm text-muted">{u.summary}</p>}
                    {items.length > 0 && (
                      <>
                        <Divider className="my-3" />
                        <div className="space-y-1.5">
                          {items.map((it) => (
                            <div key={it.id} className="flex items-center gap-2 text-xs">
                              {it.status && <StatusBadge status={it.status as never} />}
                              <span className="min-w-0 flex-1 truncate text-ink">{it.title}</span>
                              {it.task_number && <span className="shrink-0 text-faint">{it.task_number}</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {hasDetail(u, items) && (
                      <>
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand"
                        >
                          {expanded[u.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {expanded[u.id] ? 'Hide full detail' : 'Read the full detail'}
                        </button>

                        {expanded[u.id] && (
                          <div className="mt-3 space-y-4 rounded-xl border border-line bg-line/10 p-4">
                            <Section title="The day in detail" body={u.detailed_summary} />
                            <Section title="Highlights" body={u.highlights} />
                            <Section title="Completed" body={u.achievements} />
                            <Section title="Challenges" body={u.challenges} />
                            <Section title="Learnings" body={u.learnings} />
                            <Section title="Collaboration" body={u.collaboration} />
                            <Section title="Planned next" body={u.next_day_plan} />

                            {items.some((it) => it.work_detail || it.technical_notes || it.impact || it.next_steps) && (
                              <div className="space-y-3">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Work items</p>
                                {items.map((it) => (
                                  <div key={it.id} className="rounded-lg border border-line bg-surface p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {it.status && <StatusBadge status={it.status as never} />}
                                      <span className="text-sm font-medium text-ink">{it.title}</span>
                                      {it.work_type && <span className="text-[11px] text-faint">{it.work_type}</span>}
                                      {it.hours && <span className="text-[11px] text-faint">{it.hours}h</span>}
                                      {!!it.commit_count && (
                                        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                                          <GitCommit className="h-3 w-3" />
                                          {it.commit_count}
                                          {it.additions !== null && ` · +${it.additions}/-${it.deletions ?? 0}`}
                                        </span>
                                      )}
                                    </div>
                                    {it.work_detail && (
                                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted">{it.work_detail}</p>
                                    )}
                                    {it.technical_notes && (
                                      <p className="mt-1.5 text-xs text-faint">Technical: {it.technical_notes}</p>
                                    )}
                                    {it.impact && <p className="mt-1 text-xs text-emerald-600">Impact: {it.impact}</p>}
                                    {it.next_steps && <p className="mt-1 text-xs text-brand">Next: {it.next_steps}</p>}
                                    {it.collaborators && <p className="mt-1 text-xs text-faint">With: {it.collaborators}</p>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
