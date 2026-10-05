'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError, FieldHint } from '@/components/ui/Field';
import { useMeta } from '@/hooks/useMeta';
import { apiPatch, ApiClientError } from '@/lib/client';
import { toDateTimeInput } from '@/lib/format';

export interface EditableTask {
  id: number;
  task_number: string;
  title: string;
  description: string | null;
  task_type: string;
  project_id: number | null;
  department_id: number | null;
  team_id: number | null;
  assignee_id: number | null;
  category_id: number | null;
  priority: string;
  status: string;
  visibility: string;
  start_date: string | null;
  deadline: string | null;
  estimated_hours: string | number | null;
  actual_hours: string | number | null;
  progress: number;
  approval_required: 0 | 1 | boolean;
  completion_notes: string | null;
}

/**
 * Full task editor. Every change is saved on its own, a moment after the
 * person stops typing, so there is no Save button and closing the dialog
 * never loses work. Only the fields that actually changed are sent: that
 * keeps an assignee without edit rights able to move status or progress,
 * which the API would refuse if the whole form went up.
 */
export function TaskEditModal({
  task,
  open,
  onClose,
  onSaved,
}: {
  task: EditableTask;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { users, projects, activeDepartments, assignableDepartments, activeTeams, categories } = useMeta();

  const [form, setForm] = useState(() => toForm(task));
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // What the server holds, so each save sends only the difference.
  const savedRef = useRef(toPayload(toForm(task)));
  const formRef = useRef(form);
  formRef.current = form;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const openDeadlineRef = useRef(toForm(task).deadline);

  // Reset only when the dialog opens. Re-syncing on every refetch of `task`
  // would wipe whatever the person is in the middle of typing.
  useEffect(() => {
    if (!open) return;
    const initial = toForm(task);
    setForm(initial);
    savedRef.current = toPayload(initial);
    openDeadlineRef.current = initial.deadline;
    setError(null);
    setState('idle');
  }, [open, task.id]);

  const save = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // One request at a time; the next one diffs against what the first stored.
    if (savingRef.current) await savingRef.current;

    const current = formRef.current;
    if (current.title.trim().length < 3) {
      setError('The title needs at least 3 characters before it can be saved.');
      return;
    }
    const next = toPayload(current);
    const changes = diff(savedRef.current, next);
    if (!Object.keys(changes).length) return;

    const run = (async () => {
      setState('saving');
      setError(null);
      try {
        await apiPatch(`/api/tm/tasks/${task.id}`, changes);
        savedRef.current = { ...savedRef.current, ...changes };
        setState('saved');
        onSaved();
      } catch (err) {
        setState('idle');
        setError(err instanceof ApiClientError ? err.message : 'Could not save the task.');
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, [task.id, onSaved]);

  const schedule = (delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), delay);
  };

  // Typing waits for a pause; picking from a list or a date saves straight away.
  const set = <K extends keyof FormState>(key: K, value: FormState[K], delay = TEXT_DELAY) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    schedule(delay);
  };
  const pick = <K extends keyof FormState>(key: K, value: FormState[K]) => set(key, value, PICK_DELAY);

  const close = async () => {
    await save();
    onClose();
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const deadlineChanged = form.deadline !== openDeadlineRef.current;

  const departmentOptions = assignableDepartments.some((d) => String(d.id) === form.department_id)
    ? assignableDepartments
    : [...assignableDepartments, ...activeDepartments.filter((d) => String(d.id) === form.department_id)];

  return (
    <Modal open={open} onClose={() => void close()} className="max-w-2xl" title={`Edit ${task.task_number}`}>
      <OverlayHeader title={`Edit ${task.task_number}`} subtitle={task.title} onClose={() => void close()} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4 p-6"
      >
        <div>
          <Label htmlFor="te-title">Title</Label>
          <Input id="te-title" required value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={255} />
        </div>

        <div>
          <Label htmlFor="te-desc">Description</Label>
          <Textarea id="te-desc" rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="te-status">Status</Label>
            <Select id="te-status" value={form.status} onChange={(e) => pick('status', e.target.value)}>
              {['DRAFT', 'TODO', 'IN_PROGRESS', 'REOPENED', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-priority">Priority</Label>
            <Select id="te-priority" value={form.priority} onChange={(e) => pick('priority', e.target.value)}>
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => (
                <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-type">Type</Label>
            <Select id="te-type" value={form.task_type} onChange={(e) => pick('task_type', e.target.value)}>
              {['TASK', 'BUG', 'FEATURE', 'SUPPORT', 'MEETING', 'REPORT', 'OTHER'].map((t) => (
                <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="te-assignee">Assignee</Label>
            <Select id="te-assignee" value={form.assignee_id} onChange={(e) => pick('assignee_id', e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-project">Project</Label>
            <Select id="te-project" value={form.project_id} onChange={(e) => pick('project_id', e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-dept">Department</Label>
            <Select id="te-dept" value={form.department_id} onChange={(e) => pick('department_id', e.target.value)}>
              <option value="">—</option>
              {/* IT only, as everywhere else — but a task already filed against
                  another department keeps its own option so editing it does not
                  silently move it. */}
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-team">Team</Label>
            <Select id="te-team" value={form.team_id} onChange={(e) => pick('team_id', e.target.value)}>
              <option value="">—</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="te-start">Start date</Label>
            <Input id="te-start" type="datetime-local" value={form.start_date} onChange={(e) => pick('start_date', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="te-deadline">Deadline</Label>
            <Input id="te-deadline" type="datetime-local" value={form.deadline} onChange={(e) => pick('deadline', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="te-est">Estimated h</Label>
            <Input id="te-est" type="number" min="0" step="0.5" value={form.estimated_hours} onChange={(e) => set('estimated_hours', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="te-act">Actual h</Label>
            <Input id="te-act" type="number" min="0" step="0.5" value={form.actual_hours} onChange={(e) => set('actual_hours', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="te-prog">Progress %</Label>
            <Input id="te-prog" type="number" min="0" max="100" value={form.progress} onChange={(e) => set('progress', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="te-vis">Visibility</Label>
            <Select id="te-vis" value={form.visibility} onChange={(e) => pick('visibility', e.target.value)}>
              {['PRIVATE', 'TEAM', 'DEPARTMENT', 'MANAGER', 'PUBLIC'].map((v) => (
                <option key={v} value={v}>{v[0] + v.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-cat">Category</Label>
            <Select id="te-cat" value={form.category_id} onChange={(e) => pick('category_id', e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.approval_required}
            onChange={(e) => pick('approval_required', e.target.checked)}
            className="rounded accent-[rgb(var(--brand))]"
          />
          Completion requires Leader approval
        </label>

        <div>
          <Label htmlFor="te-notes">Completion notes</Label>
          <Textarea id="te-notes" rows={2} value={form.completion_notes} onChange={(e) => set('completion_notes', e.target.value)} />
        </div>

        {deadlineChanged && <FieldHint>The original deadline is kept for reporting.</FieldHint>}

        <FieldError>{error}</FieldError>

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            {state === 'saving' && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            )}
            {state === 'saved' && (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" /> All changes saved
              </>
            )}
            {state === 'idle' && !error && 'Changes save automatically'}
          </span>
          <Button type="button" variant="secondary" onClick={() => void close()}>Done</Button>
        </div>
      </form>
    </Modal>
  );
}

const TEXT_DELAY = 800;
const PICK_DELAY = 150;

type FormState = ReturnType<typeof toForm>;
type Payload = ReturnType<typeof toPayload>;

/** `datetime-local` has no zone; send an absolute instant so the server cannot shift it. */
function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toPayload(form: FormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    task_type: form.task_type,
    project_id: form.project_id ? Number(form.project_id) : null,
    department_id: form.department_id ? Number(form.department_id) : null,
    team_id: form.team_id ? Number(form.team_id) : null,
    assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
    category_id: form.category_id ? Number(form.category_id) : null,
    priority: form.priority,
    status: form.status,
    visibility: form.visibility,
    start_date: toIso(form.start_date),
    deadline: toIso(form.deadline),
    estimated_hours: form.estimated_hours === '' ? null : Number(form.estimated_hours),
    actual_hours: form.actual_hours === '' ? null : Number(form.actual_hours),
    progress: form.progress === '' ? 0 : Math.round(Number(form.progress)),
    approval_required: form.approval_required,
    completion_notes: form.completion_notes.trim() || null,
  };
}

function diff(before: Payload, after: Payload): Partial<Payload> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after) as Array<keyof Payload>) {
    const v = after[key];
    if (typeof v === 'number' && Number.isNaN(v)) continue; // half-typed number
    if (v !== before[key]) out[key] = v;
  }
  return out as Partial<Payload>;
}

function toForm(t: EditableTask) {
  return {
    title: t.title ?? '',
    description: t.description ?? '',
    task_type: t.task_type ?? 'TASK',
    project_id: t.project_id ? String(t.project_id) : '',
    department_id: t.department_id ? String(t.department_id) : '',
    team_id: t.team_id ? String(t.team_id) : '',
    assignee_id: t.assignee_id ? String(t.assignee_id) : '',
    category_id: t.category_id ? String(t.category_id) : '',
    priority: t.priority ?? 'MEDIUM',
    status: t.status ?? 'TODO',
    visibility: t.visibility ?? 'TEAM',
    start_date: toDateTimeInput(t.start_date),
    deadline: toDateTimeInput(t.deadline),
    estimated_hours: t.estimated_hours === null || t.estimated_hours === undefined ? '' : String(t.estimated_hours),
    actual_hours: t.actual_hours === null || t.actual_hours === undefined ? '' : String(t.actual_hours),
    progress: String(t.progress ?? 0),
    approval_required: Boolean(t.approval_required),
    completion_notes: t.completion_notes ?? '',
  };
}
