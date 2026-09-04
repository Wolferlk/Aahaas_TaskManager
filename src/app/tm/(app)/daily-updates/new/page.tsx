'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Wand2, Plus, Trash2, CheckCircle2, AlertTriangle, Link2, Github, Mail,
  ChevronDown, ChevronRight, GitCommit, NotebookPen,
} from 'lucide-react';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { apiPost, ApiClientError } from '@/lib/client';
import { useToast } from '@/components/ui/Toast';
import { GithubImport, type ImportedItem } from '@/components/tm/GithubImport';

/** The depth behind a work item — optional, but stored verbatim when given. */
interface ItemDetail {
  work_detail: string;
  technical_notes: string;
  impact: string;
  next_steps: string;
  collaborators: string;
  repos: string;
  links: Array<{ label: string; url: string }>;
  commit_shas: string[];
  commit_count: number | null;
  additions: number | null;
  deletions: number | null;
  files_changed: number | null;
  source: 'MANUAL' | 'AI' | 'GITHUB';
}

interface ParsedItem {
  topic: string | null;
  title: string;
  project: string | null;
  description: string | null;
  work_type: string | null;
  status: string;
  priority: string;
  progress: number;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  blockers: string | null;
  outcome: string | null;
  tags: string[];
  confidence: number;
  ai_generated_fields: string[];
  suggested_task: { id: number; task_number: string; title: string; confidence: number } | null;
  linked_action: 'NONE' | 'ATTACHED' | 'CREATED';
  keep: boolean;
  project_id?: number | null;
  source?: 'AI' | 'GITHUB' | 'MANUAL';
  detail: ItemDetail;
  expanded: boolean;
}

/** The day as a whole. Anything left blank is written from the work items. */
interface DayDetail {
  focus_area: string;
  detailed_summary: string;
  highlights: string;
  achievements: string;
  challenges: string;
  learnings: string;
  collaboration: string;
  next_day_plan: string;
}

const STATUS_OPTIONS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED'];
const PRIORITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const WORK_TYPES = ['Development', 'Bug Fix', 'Testing', 'Documentation', 'Deployment', 'Refactor', 'Meeting', 'Support', 'Research', 'Design'];
const MOODS = ['', 'Great', 'Good', 'Steady', 'Tough', 'Blocked'];

const emptyDetail = (source: ItemDetail['source'] = 'MANUAL'): ItemDetail => ({
  work_detail: '',
  technical_notes: '',
  impact: '',
  next_steps: '',
  collaborators: '',
  repos: '',
  links: [],
  commit_shas: [],
  commit_count: null,
  additions: null,
  deletions: null,
  files_changed: null,
  source,
});

const emptyDay = (): DayDetail => ({
  focus_area: '',
  detailed_summary: '',
  highlights: '',
  achievements: '',
  challenges: '',
  learnings: '',
  collaboration: '',
  next_day_plan: '',
});

export default function NewDailyUpdatePage() {
  const [mode, setMode] = useState<'paste' | 'github' | 'manual'>('paste');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [githubMeta, setGithubMeta] = useState<{ commits: number; aiUsed: boolean } | null>(null);
  const [rawText, setRawText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<{ tone: 'ai' | 'fallback'; text: string } | null>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [blockers, setBlockers] = useState('');
  const [mood, setMood] = useState('');
  const [day, setDay] = useState<DayDetail>(emptyDay());
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{
    summary: string;
    detailed_summary?: string;
    ai_used: boolean;
    mail?: { attempted: boolean; sent?: boolean; recipients?: number; error?: string };
  } | null>(null);
  const toast = useToast();
  const router = useRouter();

  const runParse = async () => {
    if (!rawText.trim()) {
      toast({ kind: 'warning', title: 'Paste or type your update first.' });
      return;
    }
    setParsing(true);
    try {
      const res = await apiPost('/api/tm/daily-updates/parse', { text: rawText });
      setItems(
        (res.items as Array<ParsedItem & { work_detail?: string | null; technical_notes?: string | null; impact?: string | null; next_steps?: string | null }>).map((i) => ({
          ...i,
          linked_action: i.suggested_task ? 'NONE' : 'CREATED',
          keep: true,
          expanded: false,
          detail: {
            ...emptyDetail('AI'),
            work_detail: i.work_detail ?? '',
            technical_notes: i.technical_notes ?? '',
            impact: i.impact ?? '',
            next_steps: i.next_steps ?? '',
          },
        })),
      );

      // "Main outcomes" / "Overall status" sections of the paste are the day's
      // own narrative rather than work items — they pre-fill the day detail,
      // and anything already typed there is left alone.
      const narrative = res.narrative as { highlights?: string[]; overall?: string | null } | undefined;
      if (narrative?.highlights?.length || narrative?.overall) {
        setDay((prev) => ({
          ...prev,
          highlights: prev.highlights || (narrative.highlights ?? []).join('\n'),
          detailed_summary: prev.detailed_summary || (narrative.overall ?? ''),
        }));
        if (narrative.highlights?.length || narrative.overall) setShowDayDetail(true);
      }

      setParseMessage({ tone: res.ai_used ? 'ai' : 'fallback', text: res.message });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not parse your update.' });
    } finally {
      setParsing(false);
    }
  };

  const acceptGithubItems = (imported: ImportedItem[], meta: { commits: number; aiUsed: boolean }) => {
    setGithubMeta(meta);
    setItems((prev) => [
      ...prev,
      ...imported.map<ParsedItem>((i) => ({
        topic: i.work_type ?? null,
        title: i.title,
        project: i.project,
        project_id: i.project_id ?? null,
        description: i.description,
        work_type: i.work_type,
        status: i.status,
        priority: i.priority,
        progress: i.progress,
        start_time: null,
        end_time: null,
        hours: i.hours,
        blockers: null,
        outcome: null,
        tags: i.tags ?? [],
        confidence: i.confidence,
        ai_generated_fields: i.ai_generated_fields ?? [],
        suggested_task: null,
        linked_action: 'CREATED',
        keep: true,
        source: 'GITHUB',
        expanded: false,
        detail: {
          ...emptyDetail('GITHUB'),
          work_detail: i.work_detail ?? '',
          technical_notes: i.technical_notes ?? '',
          impact: i.impact ?? '',
          next_steps: i.next_steps ?? '',
          repos: (i.repos ?? []).join(', '),
          links: i.links ?? [],
          commit_shas: i.commit_shas ?? [],
          commit_count: i.commit_count ?? null,
          additions: i.additions ?? null,
          deletions: i.deletions ?? null,
          files_changed: i.files_changed ?? null,
        },
      })),
    ]);
  };

  const addBlank = () => {
    setItems((prev) => [
      ...prev,
      {
        topic: null, title: '', project: null, description: null, work_type: null,
        status: 'IN_PROGRESS', priority: 'MEDIUM', progress: 50, start_time: null, end_time: null,
        hours: null, blockers: null, outcome: null, tags: [], confidence: 1,
        ai_generated_fields: [], suggested_task: null, linked_action: 'CREATED', keep: true,
        expanded: true, detail: emptyDetail('MANUAL'),
      },
    ]);
  };

  const update = (idx: number, patch: Partial<ParsedItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const updateDetail = (idx: number, patch: Partial<ItemDetail>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, detail: { ...it.detail, ...patch } } : it)));
  };

  const remove = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  /** How much of the optional depth an item carries — shown on its header. */
  const detailCount = (d: ItemDetail) =>
    [d.work_detail, d.technical_notes, d.impact, d.next_steps, d.collaborators].filter((v) => v.trim()).length;

  const save = async () => {
    const kept = items.filter((i) => i.keep && i.title.trim());
    if (!kept.length) {
      toast({ kind: 'warning', title: 'Add at least one work item.' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost('/api/tm/daily-updates', {
        update_date: date,
        raw_text: mode === 'paste' ? rawText : null,
        source: mode === 'manual' ? 'MANUAL' : 'AI_PARSED',
        status: 'SUBMITTED',
        blockers: blockers || null,
        mood: mood || null,
        detail: day,
        items: kept.map((i) => ({
          task_id: i.suggested_task && i.linked_action === 'ATTACHED' ? i.suggested_task.id : null,
          topic: i.topic,
          title: i.title,
          project_id: i.project_id ?? null,
          description: i.description,
          work_type: i.work_type,
          status: i.status,
          priority: i.priority,
          progress: i.progress,
          start_time: i.start_time,
          end_time: i.end_time,
          hours: i.hours,
          blockers: i.blockers,
          outcome: i.outcome,
          tags: i.tags.join(','),
          confidence: i.confidence,
          ai_generated: i.ai_generated_fields.length > 0,
          linked_action: i.linked_action,
          detail: i.detail,
        })),
      });
      setSaved({ summary: res.summary, detailed_summary: res.detailed_summary, ai_used: res.ai_used, mail: res.mail });
      toast({ kind: 'success', title: 'Daily update saved' });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not save your update.' });
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <PageBody>
        <Card className="animate-fade-up mx-auto max-w-2xl">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-ink">Update saved</h2>
            <p className="mt-2 text-sm text-muted">{saved.summary}</p>
            {saved.detailed_summary && saved.detailed_summary !== saved.summary && (
              <div className="mt-4 whitespace-pre-line rounded-xl bg-line/25 p-4 text-left text-sm leading-relaxed text-muted">
                {saved.detailed_summary}
              </div>
            )}
            {!saved.ai_used && (
              <p className="mt-2 text-xs text-amber-600">AI analysis unavailable. Your data has been saved successfully.</p>
            )}
            {saved.mail?.attempted && (
              <p
                className={`mt-3 flex items-center justify-center gap-1.5 text-xs ${
                  saved.mail.sent ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                {saved.mail.sent
                  ? `Emailed to ${saved.mail.recipients} recipient${saved.mail.recipients === 1 ? '' : 's'}.`
                  : `Saved, but the email could not be sent: ${saved.mail.error ?? 'unknown error'}`}
              </p>
            )}
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="secondary" onClick={() => router.push('/tm/daily-updates/history')}>View history</Button>
              <Button onClick={() => router.push('/tm/dashboard')}>Back to dashboard</Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    );
  }

  return (
    <>
      <PageHeader title="Daily Update" subtitle="Log what you worked on today" />
      <PageBody className="mx-auto max-w-3xl space-y-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              { id: 'paste', icon: Wand2, title: 'Paste free-form text', hint: 'AI extracts work items for you to review' },
              { id: 'github', icon: Github, title: 'Import from GitHub', hint: "Draft today's update from your commits" },
              { id: 'manual', icon: Plus, title: 'Fill in manually', hint: 'Add structured work items yourself' },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  mode === opt.id
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-line text-muted hover:bg-line/20'
                }`}
              >
                <Icon className="mb-1 h-4 w-4" />
                <p className="font-medium">{opt.title}</p>
                <p className="text-xs opacity-80">{opt.hint}</p>
              </button>
            );
          })}
        </div>

        {mode === 'github' && <GithubImport date={date} onImported={acceptGithubItems} />}

        {githubMeta && (
          <div className="flex items-center gap-2 rounded-xl bg-brand-soft/50 px-3.5 py-2.5 text-sm text-brand">
            <Github className="h-4 w-4 shrink-0" />
            Drafted from {githubMeta.commits} commit{githubMeta.commits === 1 ? '' : 's'}
            {githubMeta.aiUsed ? ' with AI grouping' : ' (grouped by repository)'} — review and edit before saving.
          </div>
        )}

        {mode === 'paste' && items.length === 0 && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <Textarea
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="e.g. Completed invoice PDF export, fixed report filters, started B2B booking details page and checked pagination issue."
              />
              <Button onClick={runParse} loading={parsing} className="w-full sm:w-auto">
                <Sparkles className="h-4 w-4" /> Extract work items
              </Button>
            </CardContent>
          </Card>
        )}

        {parseMessage && (
          <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${parseMessage.tone === 'ai' ? 'bg-brand-soft text-brand' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
            {parseMessage.tone === 'ai' ? <Sparkles className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            {parseMessage.text}
          </div>
        )}

        {(items.length > 0 || mode === 'manual') && (
          <div className="space-y-4">
            {items.map((item, idx) => (
              <Card key={idx} className={!item.keep ? 'opacity-50' : ''}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-2">
                    <Input
                      value={item.title}
                      onChange={(e) => update(idx, { title: e.target.value })}
                      placeholder="Work item title"
                      className="flex-1 font-medium"
                    />
                    <button onClick={() => remove(idx)} className="shrink-0 rounded-lg p-2 text-faint hover:bg-red-500/10 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {item.ai_generated_fields.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                        <Sparkles className="h-3 w-3" /> AI-suggested: {item.ai_generated_fields.join(', ')}
                      </span>
                    )}
                    {!!item.detail.commit_count && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-line/40 px-2 py-0.5 text-[11px] text-muted">
                        <GitCommit className="h-3 w-3" />
                        {item.detail.commit_count} commit{item.detail.commit_count === 1 ? '' : 's'}
                        {item.detail.additions !== null && ` · +${item.detail.additions}/-${item.detail.deletions ?? 0}`}
                      </span>
                    )}
                  </div>

                  <Textarea
                    rows={2}
                    value={item.description ?? ''}
                    onChange={(e) => update(idx, { description: e.target.value })}
                    placeholder="Short description — one or two lines"
                  />

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={item.status} onChange={(e) => update(idx, { status: e.target.value })} className="!h-9 text-sm">
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Priority</Label>
                      <Select value={item.priority} onChange={(e) => update(idx, { priority: e.target.value })} className="!h-9 text-sm">
                        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Progress %</Label>
                      <Input type="number" min="0" max="100" value={item.progress} onChange={(e) => update(idx, { progress: Number(e.target.value) })} className="!h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Hours</Label>
                      <Input type="number" min="0" step="0.5" value={item.hours ?? ''} onChange={(e) => update(idx, { hours: e.target.value ? Number(e.target.value) : null })} className="!h-9 text-sm" />
                    </div>
                  </div>

                  <button
                    onClick={() => update(idx, { expanded: !item.expanded })}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand"
                  >
                    {item.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {item.expanded ? 'Hide detail' : 'Add detail'}
                    {!item.expanded && detailCount(item.detail) > 0 && (
                      <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] text-brand">
                        {detailCount(item.detail)} filled
                      </span>
                    )}
                  </button>

                  {item.expanded && (
                    <div className="space-y-3 rounded-xl border border-line bg-line/10 p-3.5">
                      <div>
                        <Label className="text-xs">What exactly did you do?</Label>
                        <Textarea
                          rows={4}
                          value={item.detail.work_detail}
                          onChange={(e) => updateDetail(idx, { work_detail: e.target.value })}
                          placeholder="The full account: what you built or changed, how you approached it, what you verified."
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">Technical notes</Label>
                          <Textarea
                            rows={2}
                            value={item.detail.technical_notes}
                            onChange={(e) => updateDetail(idx, { technical_notes: e.target.value })}
                            placeholder="Components, endpoints, queries, migrations…"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Impact</Label>
                          <Textarea
                            rows={2}
                            value={item.detail.impact}
                            onChange={(e) => updateDetail(idx, { impact: e.target.value })}
                            placeholder="Who or what this helps."
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Next steps</Label>
                          <Textarea
                            rows={2}
                            value={item.detail.next_steps}
                            onChange={(e) => updateDetail(idx, { next_steps: e.target.value })}
                            placeholder="What remains on this item."
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Outcome</Label>
                          <Textarea
                            rows={2}
                            value={item.outcome ?? ''}
                            onChange={(e) => update(idx, { outcome: e.target.value })}
                            placeholder="The result, once it landed."
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div>
                          <Label className="text-xs">Work type</Label>
                          <Select
                            value={item.work_type ?? ''}
                            onChange={(e) => update(idx, { work_type: e.target.value || null })}
                            className="!h-9 text-sm"
                          >
                            <option value="">—</option>
                            {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Started</Label>
                          <Input type="time" value={item.start_time ?? ''} onChange={(e) => update(idx, { start_time: e.target.value || null })} className="!h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs">Finished</Label>
                          <Input type="time" value={item.end_time ?? ''} onChange={(e) => update(idx, { end_time: e.target.value || null })} className="!h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs">Worked with</Label>
                          <Input
                            value={item.detail.collaborators}
                            onChange={(e) => updateDetail(idx, { collaborators: e.target.value })}
                            placeholder="Names"
                            className="!h-9 text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">Blockers on this item</Label>
                          <Input
                            value={item.blockers ?? ''}
                            onChange={(e) => update(idx, { blockers: e.target.value || null })}
                            placeholder="What is holding it up"
                            className="!h-9 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Tags</Label>
                          <Input
                            value={item.tags.join(', ')}
                            onChange={(e) => update(idx, { tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                            placeholder="comma, separated"
                            className="!h-9 text-sm"
                          />
                        </div>
                      </div>

                      {!!item.detail.links.length && (
                        <div>
                          <Label className="text-xs">Commits</Label>
                          <div className="flex flex-wrap gap-1.5">
                            {item.detail.links.map((l) => (
                              <a
                                key={l.url}
                                href={l.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg bg-line/40 px-2 py-1 font-mono text-[11px] text-muted hover:text-brand"
                              >
                                {l.label}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {item.suggested_task && (
                    <div className="rounded-xl border border-brand/25 bg-brand-soft/40 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
                        <Link2 className="h-3.5 w-3.5" /> This appears related to {item.suggested_task.task_number}: &ldquo;{item.suggested_task.title}&rdquo;
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => update(idx, { linked_action: 'ATTACHED' })}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${item.linked_action === 'ATTACHED' ? 'bg-brand text-brand-ink' : 'bg-surface text-muted hover:bg-line/30'}`}
                        >
                          Attach update
                        </button>
                        <button
                          onClick={() => update(idx, { linked_action: 'CREATED' })}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${item.linked_action === 'CREATED' ? 'bg-brand text-brand-ink' : 'bg-surface text-muted hover:bg-line/30'}`}
                        >
                          Create new task
                        </button>
                        <button
                          onClick={() => update(idx, { linked_action: 'NONE' })}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${item.linked_action === 'NONE' ? 'bg-brand text-brand-ink' : 'bg-surface text-muted hover:bg-line/30'}`}
                        >
                          Ignore match
                        </button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            <Button variant="secondary" onClick={addBlank} className="w-full">
              <Plus className="h-4 w-4" /> Add another item
            </Button>

            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Date</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Main focus today</Label>
                    <Input
                      value={day.focus_area}
                      onChange={(e) => setDay({ ...day, focus_area: e.target.value })}
                      placeholder="e.g. Booking flow"
                      className="!h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">How the day went</Label>
                    <Select value={mood} onChange={(e) => setMood(e.target.value)} className="!h-9 text-sm">
                      {MOODS.map((m) => <option key={m} value={m}>{m || '—'}</option>)}
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Blockers today (optional)</Label>
                  <Textarea rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="Anything blocking your progress?" />
                </div>

                <button
                  onClick={() => setShowDayDetail((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-brand"
                >
                  {showDayDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {showDayDetail ? 'Hide the full write-up' : 'Write the day up in full'}
                </button>

                {showDayDetail && (
                  <div className="space-y-3 rounded-xl border border-line bg-line/10 p-3.5">
                    <p className="flex items-start gap-1.5 text-xs text-muted">
                      <NotebookPen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Anything you leave blank is written for you from your work items — what you type here is kept exactly as written.
                    </p>
                    <div>
                      <Label className="text-xs">The day in detail</Label>
                      <Textarea
                        rows={5}
                        value={day.detailed_summary}
                        onChange={(e) => setDay({ ...day, detailed_summary: e.target.value })}
                        placeholder="The full narrative of your day, in your own words."
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Highlights</Label>
                        <Textarea rows={3} value={day.highlights} onChange={(e) => setDay({ ...day, highlights: e.target.value })} placeholder="One per line" />
                      </div>
                      <div>
                        <Label className="text-xs">Completed / achievements</Label>
                        <Textarea rows={3} value={day.achievements} onChange={(e) => setDay({ ...day, achievements: e.target.value })} placeholder="One per line" />
                      </div>
                      <div>
                        <Label className="text-xs">Challenges</Label>
                        <Textarea rows={3} value={day.challenges} onChange={(e) => setDay({ ...day, challenges: e.target.value })} placeholder="What got in the way" />
                      </div>
                      <div>
                        <Label className="text-xs">Learnings</Label>
                        <Textarea rows={3} value={day.learnings} onChange={(e) => setDay({ ...day, learnings: e.target.value })} placeholder="Anything worth remembering" />
                      </div>
                      <div>
                        <Label className="text-xs">Collaboration</Label>
                        <Textarea rows={3} value={day.collaboration} onChange={(e) => setDay({ ...day, collaboration: e.target.value })} placeholder="Who you worked with, meetings, reviews" />
                      </div>
                      <div>
                        <Label className="text-xs">Plan for tomorrow</Label>
                        <Textarea rows={3} value={day.next_day_plan} onChange={(e) => setDay({ ...day, next_day_plan: e.target.value })} placeholder="One per line" />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button size="lg" className="w-full" onClick={save} loading={saving}>
              Save Daily Update
            </Button>
          </div>
        )}
      </PageBody>
    </>
  );
}
