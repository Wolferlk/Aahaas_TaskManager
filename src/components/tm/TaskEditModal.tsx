'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError, FieldHint } from '@/components/ui/Field';
import { useMeta } from '@/hooks/useMeta';
import { apiPatch, ApiClientError } from '@/lib/client';
import { useToast } from '@/components/ui/Toast';
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
 * Full task editor. Which fields a person may change is still decided
 * server-side; this form simply offers everything and surfaces the API's
 * message if a field was not permitted.
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
  const { users, projects, departments, teams, categories } = useMeta();
  const toast = useToast();

  const [form, setForm] = useState(() => toForm(task));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm(task));
      setReason('');
      setError(null);
    }
  }, [open, task]);

  const set = <K extends keyof ReturnType<typeof toForm>>(key: K, value: ReturnType<typeof toForm>[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const deadlineChanged = form.deadline !== toForm(task).deadline;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/tm/tasks/${task.id}`, {
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
        start_date: form.start_date || null,
        deadline: form.deadline || null,
        estimated_hours: form.estimated_hours === '' ? null : Number(form.estimated_hours),
        actual_hours: form.actual_hours === '' ? null : Number(form.actual_hours),
        progress: Number(form.progress),
        approval_required: form.approval_required,
        completion_notes: form.completion_notes.trim() || null,
        reason: reason.trim() || null,
      });
      toast({ kind: 'success', title: `${task.task_number} updated` });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save the task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl" title={`Edit ${task.task_number}`}>
      <OverlayHeader title={`Edit ${task.task_number}`} subtitle={task.title} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4 p-6">
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
            <Select id="te-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {['DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-priority">Priority</Label>
            <Select id="te-priority" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => (
                <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-type">Type</Label>
            <Select id="te-type" value={form.task_type} onChange={(e) => set('task_type', e.target.value)}>
              {['TASK', 'BUG', 'FEATURE', 'SUPPORT', 'MEETING', 'REPORT', 'OTHER'].map((t) => (
                <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="te-assignee">Assignee</Label>
            <Select id="te-assignee" value={form.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-project">Project</Label>
            <Select id="te-project" value={form.project_id} onChange={(e) => set('project_id', e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-dept">Department</Label>
            <Select id="te-dept" value={form.department_id} onChange={(e) => set('department_id', e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-team">Team</Label>
            <Select id="te-team" value={form.team_id} onChange={(e) => set('team_id', e.target.value)}>
              <option value="">—</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="te-start">Start date</Label>
            <Input id="te-start" type="datetime-local" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="te-deadline">Deadline</Label>
            <Input id="te-deadline" type="datetime-local" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
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
            <Select id="te-vis" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
              {['PRIVATE', 'TEAM', 'DEPARTMENT', 'MANAGER', 'PUBLIC'].map((v) => (
                <option key={v} value={v}>{v[0] + v.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="te-cat">Category</Label>
            <Select id="te-cat" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
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
            onChange={(e) => set('approval_required', e.target.checked)}
            className="rounded accent-[rgb(var(--brand))]"
          />
          Completion requires Leader approval
        </label>

        <div>
          <Label htmlFor="te-notes">Completion notes</Label>
          <Textarea id="te-notes" rows={2} value={form.completion_notes} onChange={(e) => set('completion_notes', e.target.value)} />
        </div>

        {deadlineChanged && (
          <div>
            <Label htmlFor="te-reason">Reason for the change</Label>
            <Input id="te-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the task history" />
            <FieldHint>The original deadline is preserved for reporting.</FieldHint>
          </div>
        )}

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}><Save className="h-4 w-4" /> Save changes</Button>
        </div>
      </form>
    </Modal>
  );
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
