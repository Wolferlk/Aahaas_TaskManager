'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/Field';
import { useMeta } from '@/hooks/useMeta';
import { useSession } from '@/hooks/useSession';
import { apiPost, ApiClientError } from '@/lib/client';
import { useToast } from '@/components/ui/Toast';

export function TaskFormModal({
  open,
  onClose,
  onCreated,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
  defaults?: { project_id?: number; team_id?: number; parent_task_id?: number; status?: string };
}) {
  const { users, projects, departments, teams, categories } = useMeta();
  const { user } = useSession();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(defaults?.project_id ? String(defaults.project_id) : '');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState(defaults?.team_id ? String(defaults.team_id) : '');
  const [categoryId, setCategoryId] = useState('');
  const [taskType, setTaskType] = useState('TASK');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [isPersonal, setIsPersonal] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle('');
    setAssigneeId('');
    setDeadline('');
    setPriority('MEDIUM');
    setExpanded(false);
    setDescription('');
    setProjectId(defaults?.project_id ? String(defaults.project_id) : '');
    setTeamId(defaults?.team_id ? String(defaults.team_id) : '');
    setDepartmentId('');
    setCategoryId('');
    setTaskType('TASK');
    setEstimatedHours('');
    setIsPersonal(false);
    setApprovalRequired(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiPost('/api/tm/tasks', {
        title: title.trim(),
        description: description.trim() || null,
        task_type: taskType,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        deadline: deadline || null,
        priority,
        status: defaults?.status ?? 'TODO',
        project_id: projectId ? Number(projectId) : null,
        department_id: departmentId ? Number(departmentId) : null,
        team_id: teamId ? Number(teamId) : null,
        category_id: categoryId ? Number(categoryId) : null,
        parent_task_id: defaults?.parent_task_id ?? null,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
        is_personal: isPersonal,
        approval_required: approvalRequired,
        visibility: isPersonal ? 'PRIVATE' : 'TEAM',
      });
      toast({ kind: 'success', title: `Task ${res.task_number} created` });
      onCreated?.(res.id);
      close();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create the task.');
    } finally {
      setSaving(false);
    }
  };

  const assignableUsers = users;

  return (
    <Modal open={open} onClose={close} className="max-w-lg" title="Create task">
      <OverlayHeader title="New Task" subtitle="Quick add — expand for full details" onClose={close} />
      <form onSubmit={submit} className="space-y-4 p-6">
        <div>
          <Label htmlFor="qa-title">Title</Label>
          <Input
            id="qa-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fix invoice PDF export"
            maxLength={255}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="qa-assignee">Assignee</Label>
            <Select id="qa-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              <option value={String(user?.id)}>Myself</option>
              {assignableUsers
                .filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="qa-priority">Priority</Label>
            <Select id="qa-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="qa-deadline">Deadline</Label>
          <Input id="qa-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {expanded ? 'Hide details' : 'Add more details'}
        </button>

        {expanded && (
          <div className="animate-fade-up space-y-4 border-t border-line pt-4">
            <div>
              <Label htmlFor="qa-desc">Description</Label>
              <Textarea id="qa-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qa-project">Project</Label>
                <Select id="qa-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="qa-type">Type</Label>
                <Select id="qa-type" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                  {['TASK', 'BUG', 'FEATURE', 'SUPPORT', 'MEETING', 'REPORT', 'OTHER'].map((t) => (
                    <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qa-dept">Department</Label>
                <Select id="qa-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="qa-team">Team</Label>
                <Select id="qa-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <option value="">—</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="qa-cat">Category</Label>
                <Select id="qa-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="qa-hours">Estimated hours</Label>
                <Input
                  id="qa-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" checked={isPersonal} onChange={(e) => setIsPersonal(e.target.checked)} className="rounded" />
                Personal (private)
              </label>
              <label className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={approvalRequired}
                  onChange={(e) => setApprovalRequired(e.target.checked)}
                  className="rounded"
                />
                Requires approval to complete
              </label>
            </div>
          </div>
        )}

        <FieldError>{error}</FieldError>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs text-faint">
            <Sparkles className="h-3.5 w-3.5" />
            Task number generated automatically
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" loading={saving}>Create Task</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
