'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import {
  Plus, NotebookPen, ArrowRight, Flame, CalendarDays, CalendarPlus, Sparkles,
  Users, Bot, PartyPopper, Clock3,
} from 'lucide-react';
import { fetcher } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { Avatar } from '@/components/ui/Avatar';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/cn';

interface UpdateItem {
  id: number;
  daily_update_id: number;
  title: string;
  status: string | null;
}

interface UpdateRow {
  id: number;
  update_date: string;
  status: string;
  total_hours: string | null;
  summary: string | null;
  item_count: number;
  full_name: string;
  avatar_url: string | null;
  is_auto_submitted: number | null;
}

interface CalendarDay {
  date: string;
  weekend: boolean;
  state: 'SUBMITTED' | 'DRAFT' | 'MISSING' | 'OFF';
  items: number;
}

interface Coverage {
  from: string;
  to: string;
  today: string;
  calendar: CalendarDay[];
  missing: string[];
  expected: number;
  recorded: number;
  coverage: number;
  streak: number;
}

const DAY_STYLE: Record<CalendarDay['state'], string> = {
  SUBMITTED: 'bg-emerald-500 text-white',
  DRAFT: 'bg-amber-400 text-white',
  MISSING: 'bg-red-500/15 text-red-500 hover:bg-red-500/30',
  OFF: 'bg-line/40 text-faint',
};

export default function DailyUpdatesPage() {
  const { user } = useSession();
  const [scope, setScope] = useState<'mine' | 'team'>('mine');

  const { data, isLoading } = useSWR<{
    updates: UpdateRow[];
    items: UpdateItem[];
    scope: { breadth: 'SELF' | 'TEAM' | 'ALL'; can_view_others: boolean };
  }>(`/api/tm/daily-updates?limit=8&scope=${scope}`, fetcher);

  const { data: cover } = useSWR<Coverage>('/api/tm/daily-updates/missing?days=28', fetcher);

  const todayStr = cover?.today ?? new Date().toISOString().slice(0, 10);
  const todayDone = cover?.calendar.some((d) => d.date === todayStr && d.state !== 'MISSING' && d.state !== 'OFF');
  const canViewOthers = data?.scope?.can_view_others ?? false;
  const missing = cover?.missing ?? [];

  return (
    <>
      <PageHeader
        title="Daily Updates"
        subtitle="Record the day, catch up on the ones you missed"
        actions={
          <Link href="/tm/daily-updates/new">
            <Button size="sm" className="lift">
              <Plus className="h-4 w-4" /> New Update
            </Button>
          </Link>
        }
      />
      <PageBody className="space-y-6">
        {/* ------------------------------------------------------------ *
            Today, the streak, and how much of the month is on record.
         * ------------------------------------------------------------ */}
        <Card className={cn('aurora animate-pop-in', todayDone ? 'border-emerald-500/25' : 'border-brand/25')}>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft">
                    {todayDone ? (
                      <PartyPopper className="h-6 w-6 animate-bounce-in text-emerald-500" />
                    ) : (
                      <NotebookPen className="h-6 w-6 animate-pulse-soft text-brand" />
                    )}
                    {!todayDone && (
                      <span className="absolute inset-0 -z-10 animate-ripple rounded-2xl bg-brand/30" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-gradient text-lg font-bold leading-tight">
                      {todayDone ? "Today's update is in" : "Today isn't recorded yet"}
                    </h2>
                    <p className="text-sm text-muted">
                      {todayDone
                        ? 'Nice work. Everything you filed has already gone out by email.'
                        : 'It takes about a minute — paste your notes and let AI shape them.'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Pill
                    icon={Flame}
                    value={cover ? `${cover.streak}` : '–'}
                    label={cover?.streak === 1 ? 'day streak' : 'day streak'}
                    tone={cover && cover.streak >= 3 ? 'hot' : undefined}
                  />
                  <Pill
                    icon={CalendarDays}
                    value={cover ? `${cover.coverage}%` : '–'}
                    label="of the last 4 weeks"
                    tone={cover && cover.coverage >= 90 ? 'good' : cover && cover.coverage < 60 ? 'warn' : undefined}
                  />
                  <Pill
                    icon={Clock3}
                    value={`${missing.length}`}
                    label={missing.length === 1 ? 'day missing' : 'days missing'}
                    tone={missing.length ? 'warn' : 'good'}
                  />
                </div>
              </div>

              {!todayDone && (
                <Link href={`/tm/daily-updates/new?date=${todayStr}`} className="shrink-0">
                  <Button size="lg" className="lift">
                    <Sparkles className="h-4 w-4" /> Record today
                  </Button>
                </Link>
              )}
            </div>

            {/* The month at a glance — every square is a day you can fill in. */}
            {cover && (
              <div className="mt-5 border-t border-line/70 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {fmtDate(cover.from, { month: 'short', day: 'numeric' })} –{' '}
                    {fmtDate(cover.to, { month: 'short', day: 'numeric' })}
                  </p>
                  <div className="flex items-center gap-3 text-[11px] text-faint">
                    <Legend className="bg-emerald-500" label="recorded" />
                    <Legend className="bg-amber-400" label="draft" />
                    <Legend className="bg-red-500/40" label="missing" />
                  </div>
                </div>
                <div className="stagger flex flex-wrap gap-1.5">
                  {cover.calendar.map((day) => {
                    const label = `${fmtDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })} — ${
                      day.state === 'SUBMITTED'
                        ? `${day.items} item${day.items === 1 ? '' : 's'} recorded`
                        : day.state === 'DRAFT'
                          ? 'saved as a draft'
                          : day.state === 'OFF'
                            ? 'weekend'
                            : 'not recorded'
                    }`;
                    const square = (
                      <span
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-semibold transition-transform duration-200 hover:scale-110',
                          DAY_STYLE[day.state],
                          day.date === cover.today && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
                        )}
                      >
                        {Number(day.date.slice(8, 10))}
                      </span>
                    );
                    return day.state === 'MISSING' ? (
                      <Link key={day.date} href={`/tm/daily-updates/new?date=${day.date}`} title={label}>
                        {square}
                      </Link>
                    ) : (
                      <span key={day.date} title={label}>
                        {square}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ *
            The days that still need filling in.
         * ------------------------------------------------------------ */}
        {missing.length > 0 && (
          <Card className="animate-pop-in border-amber-500/30 bg-amber-500/[0.04]">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
                    <CalendarPlus className="h-4 w-4 animate-wiggle text-amber-600 dark:text-amber-400" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {missing.length} working {missing.length === 1 ? 'day is' : 'days are'} still unrecorded
                    </p>
                    <p className="text-xs text-muted">
                      Pick one to fill it in — a late entry is stored and emailed exactly like a same-day one.
                    </p>
                  </div>
                </div>
              </div>
              <div className="stagger mt-3.5 flex flex-wrap gap-2">
                {missing.slice(0, 14).map((date) => (
                  <Link key={date} href={`/tm/daily-updates/new?date=${date}`}>
                    <span className="lift flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-surface px-3 py-1.5 text-xs font-medium text-ink">
                      <CalendarPlus className="h-3.5 w-3.5 text-amber-500" />
                      {fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                  </Link>
                ))}
                {missing.length > 14 && (
                  <span className="flex items-center px-2 text-xs text-muted">+{missing.length - 14} more</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ------------------------------------------------------------ *
            Recent updates — mine, or the team's for a Leader/Manager.
         * ------------------------------------------------------------ */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Recent updates</h2>
            {canViewOthers && (
              <div className="flex rounded-xl border border-line bg-surface p-0.5">
                {(
                  [
                    { id: 'mine', label: 'Mine', icon: NotebookPen },
                    {
                      id: 'team',
                      label: user?.role === 'MANAGER' ? 'Everyone' : 'My team',
                      icon: Users,
                    },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setScope(opt.id)}
                      className={cn(
                        'focus-ring flex items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-xs font-medium transition-colors',
                        scope === opt.id ? 'bg-brand-soft text-brand' : 'text-muted hover:text-ink',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Link
            href="/tm/daily-updates/history"
            className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            View full history <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {isLoading && <Skeleton className="h-64" />}

        {data && data.updates.length === 0 && (
          <EmptyState
            icon={NotebookPen}
            title="Nothing recorded here yet"
            description="Your first update starts the streak."
            action={
              <Link href="/tm/daily-updates/new">
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Record a day
                </Button>
              </Link>
            }
          />
        )}

        <div className="stagger space-y-3">
          {data?.updates.map((u) => {
            const items = data.items.filter((i) => i.daily_update_id === u.id);
            return (
              <Card key={u.id} className="lift">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2.5">
                    {scope === 'team' && <Avatar name={u.full_name} src={u.avatar_url} size="sm" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {fmtDate(u.update_date, { weekday: 'long', month: 'short', day: 'numeric' })}
                        {scope === 'team' && <span className="ml-1.5 font-normal text-muted">· {u.full_name}</span>}
                      </p>
                      {!!u.is_auto_submitted && (
                        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          <Bot className="h-3 w-3" /> Filed automatically
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-faint">
                      {u.total_hours ? `${u.total_hours}h logged` : `${u.item_count} items`}
                    </span>
                  </div>
                  {u.summary && <p className="mt-1.5 text-sm text-muted">{u.summary}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {items.slice(0, 6).map((it) => (
                      <span
                        key={it.id}
                        className="rounded-full bg-line/40 px-2.5 py-1 text-xs text-muted transition-colors hover:bg-brand-soft hover:text-brand"
                      >
                        {it.title}
                      </span>
                    ))}
                    {items.length > 6 && (
                      <span className="px-1 py-1 text-xs text-faint">+{items.length - 6} more</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}

function Pill({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  tone?: 'hot' | 'good' | 'warn';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
        tone === 'hot'
          ? 'bg-orange-500/12 text-orange-600 dark:text-orange-400'
          : tone === 'good'
            ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
            : tone === 'warn'
              ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
              : 'bg-line/40 text-muted',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', tone === 'hot' && 'animate-pulse-soft')} />
      <span className="font-bold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('h-2 w-2 rounded-sm', className)} />
      {label}
    </span>
  );
}
