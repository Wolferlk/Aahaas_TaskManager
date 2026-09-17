'use client';

import { useMemo, useState } from 'react';
import {
  Table2, Sparkles, AlertTriangle, ChevronDown, ChevronRight, Trash2, CalendarRange,
  CheckCircle2, PencilLine, Mail, Link2, ListChecks, Info,
} from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, pluralize } from '@/lib/format';
import { cn } from '@/lib/cn';
import { parseTableRows, type DateOrder, type SettledOrder } from '@/lib/tableUpdates';

/** One row of the paste, after it has been written up. */
export interface TableItem {
  date: string;
  topic: string | null;
  title: string;
  project: string | null;
  description: string | null;
  work_type: string | null;
  status: string;
  priority: string;
  progress: number;
  hours: number | null;
  blockers: string | null;
  outcome: string | null;
  tags: string[];
  confidence: number;
  ai_generated_fields: string[];
  work_detail: string | null;
  technical_notes: string | null;
  impact: string | null;
  next_steps: string | null;
  suggested_task: { id: number; task_number: string; title: string; confidence: number } | null;
  source_row: {
    index: number | null;
    raw_date: string | null;
    raw_status: string | null;
    dated: boolean;
    line: string;
  };
  /** Chosen per item: a new task, or an update attached to the matched one. */
  linked_action: 'CREATED' | 'ATTACHED';
}

interface DayGroup {
  date: string;
  items: TableItem[];
}

interface ParseTableResponse {
  days: DayGroup[];
  total_items: number;
  date_order: SettledOrder;
  ambiguous: boolean;
  order_reason: string;
  rejected: Array<{ line: string; reason: string }>;
  skipped: string[];
  ai_used: boolean;
  message: string;
}

interface SaveReport {
  saved: number;
  failed: number;
  items: number;
  mailed: number;
  results: Array<{ date: string; ok: boolean; items?: number; error?: string }>;
}

const STATUS_OPTIONS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED'];

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  IN_PROGRESS: 'bg-brand-soft text-brand',
  BLOCKED: 'bg-red-500/12 text-red-600 dark:text-red-400',
  WAITING: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
  REVIEW: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  TODO: 'bg-line/50 text-muted',
};

const PLACEHOLDER = `1\t09/07/2026\tAdded hand-editable mirror sheet to Query Monitor\t\tCompleted
2\t09/07/2026\tFixed Excel worksheet name validation and Graph API errors\t\tCompleted
3\t10/07/2026\tRebuilt the weekly and monthly reports\t\tIn Progress`;

/**
 * Records a pasted tracker table as daily updates.
 *
 * The rows carry their own dates, so one paste can fill in many days at once —
 * which is the whole point of this mode and the reason it does not simply feed
 * the single-day form. Splitting happens twice: once here as you type, so you
 * can see what was understood before anything leaves the browser, and once on
 * the server, which is the read that counts.
 *
 * Nothing is written until "Record" is pressed. Any single day can still be
 * opened in the full review form first, for the items that want more than a
 * title and a status.
 */
export function TableImport({
  fallbackDate,
  onLoadDay,
  onRecorded,
}: {
  /** The day rows with no date of their own are recorded against. */
  fallbackDate: string;
  onLoadDay: (date: string, items: TableItem[]) => void;
  onRecorded: (report: SaveReport) => void;
}) {
  const [text, setText] = useState('');
  const [order, setOrder] = useState<DateOrder>('AUTO');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseTableResponse | null>(null);
  const [days, setDays] = useState<DayGroup[]>([]);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [openDates, setOpenDates] = useState<string[]>([]);
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [sendMail, setSendMail] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  /** The same parse the server will run, shown live so nothing is a surprise. */
  const preview = useMemo(() => {
    if (text.trim().length < 3) return null;
    return parseTableRows(text, { dateOrder: order, fallbackDate });
  }, [text, order, fallbackDate]);

  const included = days.filter((d) => !skipDates.includes(d.date) && d.items.length > 0);
  const totalItems = included.reduce((sum, d) => sum + d.items.length, 0);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const runParse = async () => {
    if (!text.trim()) {
      toast({ kind: 'warning', title: 'Paste your table first.' });
      return;
    }
    setParsing(true);
    try {
      const res: ParseTableResponse = await apiPost('/api/tm/daily-updates/parse-table', {
        text,
        date_order: order,
        fallback_date: fallbackDate,
      });
      setResult(res);
      setDays(res.days.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i, linked_action: 'CREATED' })) })));
      setSkipDates([]);
      // One day opens itself; a fortnight stays folded until it is asked for.
      setOpenDates(res.days.length === 1 ? res.days.map((d) => d.date) : []);
      setOpenItems([]);
      // The order the server settled on wins, so the toggle shows what was used.
      setOrder(res.date_order);
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not read that table.' });
    } finally {
      setParsing(false);
    }
  };

  const editItem = (date: string, index: number, patch: Partial<TableItem>) => {
    setDays((prev) =>
      prev.map((d) =>
        d.date === date ? { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : d,
      ),
    );
  };

  const removeItem = (date: string, index: number) => {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, items: d.items.filter((_, i) => i !== index) } : d)));
  };

  /** One day's items, in the shape the daily-update API accepts. */
  const dayPayload = (day: DayGroup) => ({
    update_date: day.date,
    raw_text: day.items.map((i) => i.source_row.line).join('\n').slice(0, 50000),
    source: 'AI_PARSED' as const,
    status: 'SUBMITTED' as const,
    blockers: null,
    mood: null,
    detail: {
      focus_area: day.items[0]?.topic ?? null,
    },
    items: day.items.map((i) => ({
      task_id: i.linked_action === 'ATTACHED' ? (i.suggested_task?.id ?? null) : null,
      topic: i.topic,
      title: i.title.slice(0, 255),
      project_id: null,
      description: i.description,
      work_type: i.work_type,
      status: i.status,
      priority: i.priority,
      progress: i.progress,
      start_time: null,
      end_time: null,
      hours: i.hours && i.hours > 0 && i.hours <= 24 ? i.hours : null,
      blockers: i.blockers,
      outcome: i.outcome,
      tags: i.tags.slice(0, 6).join(',').slice(0, 300),
      confidence: i.confidence,
      ai_generated: i.ai_generated_fields.length > 0,
      linked_action: i.linked_action,
      detail: {
        work_detail: i.work_detail,
        technical_notes: i.technical_notes,
        impact: i.impact,
        next_steps: i.next_steps,
        source: 'AI' as const,
      },
    })),
  });

  const recordAll = async () => {
    if (!included.length) {
      toast({ kind: 'warning', title: 'Every day is excluded — include at least one.' });
      return;
    }
    // Caught here rather than by the server, which would refuse the whole day
    // over one emptied title and say so only after the round trip.
    const untitled = included.find((d) => d.items.some((i) => i.title.trim().length < 2));
    if (untitled) {
      toast({
        kind: 'warning',
        title: `Give every task on ${fmtDate(untitled.date, { day: 'numeric', month: 'long' })} a title.`,
      });
      setOpenDates((prev) => (prev.includes(untitled.date) ? prev : [...prev, untitled.date]));
      return;
    }

    setSaving(true);
    try {
      const res = await apiPost('/api/tm/daily-updates/bulk', {
        send_mail: sendMail,
        days: included.map(dayPayload),
      });
      const report: SaveReport = res;
      onRecorded(report);
      toast({
        kind: report.failed ? 'warning' : 'success',
        title: report.failed
          ? `${report.saved} recorded, ${report.failed} could not be saved`
          : `${pluralize(report.saved, 'day')} recorded`,
      });
      // Days that landed leave the queue; anything that failed stays to retry.
      const failedDates = report.results.filter((r) => !r.ok).map((r) => r.date);
      setDays((prev) => prev.filter((d) => failedDates.includes(d.date)));
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not record those days.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-brand/25">
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Table2 className="h-4 w-4 text-brand" /> Paste your tracker
            </p>
            <p className="text-xs text-muted">
              Any grid with a date, the work and a status — copied from Excel, Sheets or a document.
            </p>
          </div>

          <Textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            className="font-mono text-xs leading-relaxed"
          />

          {/* What the browser made of it, before anything is sent. */}
          {preview && (
            <div className="rounded-xl border border-line bg-line/10 p-3.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <ListChecks className="h-3.5 w-3.5 shrink-0 text-brand" />
                <span className="font-semibold text-ink">{pluralize(preview.rows.length, 'row')}</span>
                across
                <span className="font-semibold text-ink">{pluralize(preview.dates.length, 'day')}</span>
                {!!preview.dates.length && (
                  <span>
                    ({fmtDate(preview.dates[0], { day: 'numeric', month: 'short' })}
                    {preview.dates.length > 1 && ` – ${fmtDate(preview.dates[preview.dates.length - 1], { day: 'numeric', month: 'short' })}`})
                  </span>
                )}
              </p>

              <div className="mt-2.5 flex flex-wrap items-end gap-3">
                <div className="min-w-[190px]">
                  <Label className="text-xs">Dates are written</Label>
                  <Select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)} className="!h-9 text-sm">
                    <option value="AUTO">Work it out from the paste</option>
                    <option value="DMY">Day first — 09/07 is 9 July</option>
                    <option value="MDY">Month first — 09/07 is 7 September</option>
                  </Select>
                </div>
                <p
                  className={cn(
                    'flex items-start gap-1.5 pb-2 text-xs',
                    preview.ambiguous ? 'text-amber-700 dark:text-amber-400' : 'text-muted',
                  )}
                >
                  {preview.ambiguous ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  {preview.order_reason}
                  {preview.ambiguous && ' Check the dates below before recording.'}
                </p>
              </div>

              {!!preview.rejected.length && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {pluralize(preview.rejected.length, 'row')} cannot be recorded — {preview.rejected[0].reason}
                </p>
              )}
              {!!preview.rows.filter((r) => !r.dated).length && (
                <p className="mt-2 text-xs text-muted">
                  {pluralize(preview.rows.filter((r) => !r.dated).length, 'row')} carry no date and will be recorded
                  against {fmtDate(fallbackDate, { day: 'numeric', month: 'long' })}.
                </p>
              )}
            </div>
          )}

          <Button onClick={runParse} loading={parsing} disabled={!preview?.rows.length} className="w-full sm:w-auto">
            <Sparkles className="h-4 w-4" /> Write these up as daily tasks
          </Button>
        </CardContent>
      </Card>

      {result && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl px-4 py-3 text-sm',
            result.ai_used ? 'bg-brand-soft text-brand' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}
        >
          {result.ai_used ? (
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {result.message}
        </div>
      )}

      {!!days.length && (
        <div className="space-y-3">
          {days.map((day) => {
            const excluded = skipDates.includes(day.date);
            const open = openDates.includes(day.date);
            const done = day.items.filter((i) => i.status === 'COMPLETED').length;

            return (
              <Card key={day.date} className={cn(excluded && 'opacity-50')}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setOpenDates((prev) => toggle(prev, day.date))}
                      className="focus-ring flex flex-1 items-center gap-2 rounded-lg text-left"
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                      )}
                      <CalendarRange className="h-4 w-4 shrink-0 text-brand" />
                      <span className="font-medium text-ink">
                        {fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' })}
                      </span>
                      <span className="rounded-full bg-line/40 px-2 py-0.5 text-[11px] text-muted">
                        {pluralize(day.items.length, 'task')}
                      </span>
                      {!!done && (
                        <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                          {done} completed
                        </span>
                      )}
                    </button>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        // The day leaves the batch as it is handed over, so it
                        // cannot be recorded twice from two places at once.
                        onLoadDay(day.date, day.items);
                        setDays((prev) => prev.filter((d) => d.date !== day.date));
                        toast({
                          kind: 'info',
                          title: `${fmtDate(day.date, { day: 'numeric', month: 'long' })} moved to the form below`,
                        });
                      }}
                    >
                      <PencilLine className="h-3.5 w-3.5" /> Review in full
                    </Button>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={() => setSkipDates((prev) => toggle(prev, day.date))}
                        className="focus-ring h-3.5 w-3.5 shrink-0 accent-[rgb(var(--brand))]"
                      />
                      Record
                    </label>
                  </div>

                  {open && (
                    <div className="mt-3 space-y-2 border-t border-line/70 pt-3">
                      {day.items.map((item, idx) => {
                        const key = `${day.date}#${idx}`;
                        const expanded = openItems.includes(key);
                        return (
                          <div key={key} className="rounded-xl border border-line bg-line/10 p-3">
                            <div className="flex items-start gap-2">
                              <input
                                value={item.title}
                                onChange={(e) => editItem(day.date, idx, { title: e.target.value })}
                                className="focus-ring min-w-0 flex-1 rounded-lg bg-transparent px-1 py-0.5 text-sm font-medium text-ink"
                              />
                              <Select
                                value={item.status}
                                onChange={(e) => editItem(day.date, idx, { status: e.target.value })}
                                className={cn('!h-7 !w-auto shrink-0 border-none !px-2 text-[11px] font-medium', STATUS_TONE[item.status] ?? '')}
                              >
                                {STATUS_OPTIONS.map((s) => (
                                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                ))}
                              </Select>
                              <button
                                onClick={() => removeItem(day.date, idx)}
                                className="shrink-0 rounded-lg p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"
                                aria-label="Remove this task"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <p className="mt-1 line-clamp-2 px-1 text-xs text-muted">{item.description}</p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
                              {item.work_type && (
                                <span className="rounded-full bg-line/40 px-2 py-0.5 text-[10px] text-muted">{item.work_type}</span>
                              )}
                              {item.tags.slice(0, 3).map((t) => (
                                <span key={t} className="rounded-full bg-line/30 px-2 py-0.5 text-[10px] text-faint">#{t}</span>
                              ))}
                              <button
                                onClick={() => setOpenItems((prev) => toggle(prev, key))}
                                className="ml-auto text-[11px] font-medium text-brand"
                              >
                                {expanded ? 'Hide the write-up' : 'See the write-up'}
                              </button>
                            </div>

                            {expanded && (
                              <div className="mt-2 space-y-2 rounded-lg bg-surface p-2.5 text-xs leading-relaxed text-muted">
                                {[
                                  ['What was done', item.work_detail],
                                  ['Technical notes', item.technical_notes],
                                  ['Impact', item.impact],
                                  ['Outcome', item.outcome],
                                  ['Next steps', item.next_steps],
                                ]
                                  .filter(([, value]) => !!value)
                                  .map(([label, value]) => (
                                    <p key={label as string}>
                                      <span className="font-semibold text-ink">{label}: </span>
                                      {value}
                                    </p>
                                  ))}
                                <p className="border-t border-line/70 pt-2 font-mono text-[10px] text-faint">
                                  From your paste: {item.source_row.line}
                                </p>
                              </div>
                            )}

                            {item.suggested_task && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand/25 bg-brand-soft/40 px-2.5 py-1.5">
                                <span className="flex items-center gap-1.5 text-[11px] text-brand">
                                  <Link2 className="h-3 w-3" /> Looks like {item.suggested_task.task_number}
                                </span>
                                {(['CREATED', 'ATTACHED'] as const).map((choice) => (
                                  <button
                                    key={choice}
                                    onClick={() => editItem(day.date, idx, { linked_action: choice })}
                                    className={cn(
                                      'rounded-lg px-2 py-0.5 text-[11px] font-medium',
                                      item.linked_action === choice ? 'bg-brand text-brand-ink' : 'bg-surface text-muted hover:bg-line/30',
                                    )}
                                  >
                                    {choice === 'CREATED' ? 'New task' : 'Attach to it'}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Card className="border-brand/25">
            <CardContent className="space-y-3 p-4">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={sendMail}
                  onChange={(e) => setSendMail(e.target.checked)}
                  className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Mail className="h-3.5 w-3.5" /> Email each day&rsquo;s update as well
                  </span>
                  <span className="text-xs text-muted">
                    Off by default — back-filling {pluralize(included.length, 'day')} would otherwise send{' '}
                    {pluralize(included.length, 'email')}.
                  </span>
                </span>
              </label>

              <Button size="lg" className="w-full" onClick={recordAll} loading={saving} disabled={!included.length}>
                <CheckCircle2 className="h-4 w-4" />
                Record {pluralize(included.length, 'day')} · {pluralize(totalItems, 'task')}
              </Button>
              <p className="text-center text-xs text-muted">
                Each day is saved exactly as a day typed on the day itself, and replaces anything already recorded for
                that date.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
