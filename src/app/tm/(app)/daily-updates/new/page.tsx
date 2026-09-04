'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Wand2, Plus, Trash2, CheckCircle2, AlertTriangle, Link2, Github, Mail } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { apiPost, ApiClientError } from '@/lib/client';
import { useToast } from '@/components/ui/Toast';
import { GithubImport, type ImportedItem } from '@/components/tm/GithubImport';

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
}

const STATUS_OPTIONS = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED'];
const PRIORITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function NewDailyUpdatePage() {
  const [mode, setMode] = useState<'paste' | 'github' | 'manual'>('paste');
  const [githubMeta, setGithubMeta] = useState<{ commits: number; aiUsed: boolean } | null>(null);
  const [rawText, setRawText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<{ tone: 'ai' | 'fallback'; text: string } | null>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [blockers, setBlockers] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{
    summary: string;
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
        (res.items as ParsedItem[]).map((i) => ({
          ...i,
          linked_action: i.suggested_task ? 'NONE' : 'CREATED',
          keep: true,
        })),
      );
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
      },
    ]);
  };

  const update = (idx: number, patch: Partial<ParsedItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const remove = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    const kept = items.filter((i) => i.keep && i.title.trim());
    if (!kept.length) {
      toast({ kind: 'warning', title: 'Add at least one work item.' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost('/api/tm/daily-updates', {
        update_date: new Date().toISOString().slice(0, 10),
        raw_text: mode === 'paste' ? rawText : null,
        source: mode === 'manual' ? 'MANUAL' : 'AI_PARSED',
        status: 'SUBMITTED',
        blockers: blockers || null,
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
        })),
      });
      setSaved({ summary: res.summary, ai_used: res.ai_used, mail: res.mail });
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
        <Card className="animate-fade-up mx-auto max-w-lg">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-ink">Update saved</h2>
            <p className="mt-2 text-sm text-muted">{saved.summary}</p>
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

        {mode === 'github' && (
          <GithubImport date={new Date().toISOString().slice(0, 10)} onImported={acceptGithubItems} />
        )}

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

                  {item.ai_generated_fields.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">
                      <Sparkles className="h-3 w-3" /> AI-suggested: {item.ai_generated_fields.join(', ')}
                    </span>
                  )}

                  <Textarea
                    rows={2}
                    value={item.description ?? ''}
                    onChange={(e) => update(idx, { description: e.target.value })}
                    placeholder="Description"
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

            <div>
              <Label>Blockers today (optional)</Label>
              <Textarea rows={2} value={blockers} onChange={(e) => setBlockers(e.target.value)} placeholder="Anything blocking your progress?" />
            </div>

            <Button size="lg" className="w-full" onClick={save} loading={saving}>
              Save Daily Update
            </Button>
          </div>
        )}
      </PageBody>
    </>
  );
}
