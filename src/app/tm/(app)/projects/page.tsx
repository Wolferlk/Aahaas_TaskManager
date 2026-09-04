'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Plus, FolderKanban, Users as UsersIcon, SquarePen } from 'lucide-react';
import { fetcher, apiPost, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/Field';
import { EmptyState, ProgressBar, Skeleton } from '@/components/ui/Misc';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { useSession } from '@/hooks/useSession';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, toDateInput } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Project {
  id: number;
  name: string;
  code: string;
  description: string | null;
  department_id: number | null;
  owner_user_id: number | null;
  status: string;
  progress: number;
  health: string;
  health_reasons: string[];
  target_date: string | null;
  department_name: string | null;
  owner_name: string | null;
  total_tasks: number;
  member_count: number;
}

const HEALTH_STYLE: Record<string, string> = {
  HEALTHY: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  NEEDS_ATTENTION: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  AT_RISK: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  CRITICAL: 'bg-red-500/12 text-red-600 dark:text-red-400',
};

const HEALTH_LABEL: Record<string, string> = {
  HEALTHY: 'Healthy',
  NEEDS_ATTENTION: 'Needs Attention',
  AT_RISK: 'At Risk',
  CRITICAL: 'Critical',
};

export default function ProjectsPage() {
  const { data, isLoading, mutate } = useSWR<{ projects: Project[] }>('/api/tm/projects', fetcher);
  const { can } = useSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Lightweight project tracking with automatic health scoring"
        actions={can('tm.project.manage') && <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Project</Button>}
      />
      <PageBody>
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
          </div>
        )}

        {data && data.projects.length === 0 && (
          <EmptyState icon={FolderKanban} title="Create your first project" description="Group related tasks under a project to track progress and health." />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.projects.map((p) => (
            <Card key={p.id} className="animate-fade-up transition-shadow hover:shadow-pop">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                    <p className="text-xs text-faint">{p.code} · {p.department_name ?? 'No department'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', HEALTH_STYLE[p.health])}>
                      {HEALTH_LABEL[p.health]}
                    </span>
                    {can('tm.project.manage') && (
                      <button
                        onClick={() => setEditing(p)}
                        className="focus-ring rounded-lg p-1.5 text-faint hover:bg-line/30 hover:text-ink"
                        aria-label={`Edit ${p.name}`}
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{p.progress}% complete</span>
                    <span>{p.total_tasks} tasks</span>
                  </div>
                  <ProgressBar value={p.progress} className="mt-1.5" />
                </div>

                {p.health_reasons.length > 0 && p.health !== 'HEALTHY' && (
                  <p className="mt-3 text-xs text-muted">{p.health_reasons[0]}</p>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-faint">
                  <span className="flex items-center gap-1"><UsersIcon className="h-3 w-3" /> {p.member_count} members</span>
                  <span>{p.target_date ? `Due ${fmtDate(p.target_date)}` : 'No target date'}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>

      <ProjectFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => mutate()} />
      <ProjectFormModal
        open={!!editing}
        project={editing}
        onClose={() => setEditing(null)}
        onSaved={() => mutate()}
      />
    </>
  );
}

function ProjectFormModal({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  project?: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { departments, users } = useMeta();
  const toast = useToast();
  const isEdit = !!project;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [status, setStatus] = useState('PLANNING');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the record being edited each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (project) {
      setName(project.name);
      setCode(project.code);
      setDescription(project.description ?? '');
      setDepartmentId(project.department_id ? String(project.department_id) : '');
      setOwnerId(project.owner_user_id ? String(project.owner_user_id) : '');
      setTargetDate(toDateInput(project.target_date));
      setStatus(project.status);
    } else {
      setName('');
      setCode('');
      setDescription('');
      setDepartmentId('');
      setOwnerId('');
      setTargetDate('');
      setStatus('PLANNING');
    }
  }, [open, project]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name,
      code,
      description: description || null,
      department_id: departmentId ? Number(departmentId) : null,
      owner_user_id: ownerId ? Number(ownerId) : null,
      target_date: targetDate || null,
      status,
    };
    try {
      if (isEdit) {
        await apiPatch(`/api/tm/projects/${project!.id}`, payload);
        toast({ kind: 'success', title: 'Project updated' });
      } else {
        await apiPost('/api/tm/projects', payload);
        toast({ kind: 'success', title: 'Project created' });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save the project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit project' : 'New project'}>
      <OverlayHeader title={isEdit ? `Edit ${project!.name}` : 'New Project'} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="p-code">Code</Label>
            <Input id="p-code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. BOOKING" />
          </div>
        </div>
        <div>
          <Label htmlFor="p-desc">Description</Label>
          <Textarea id="p-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="p-dept">Department</Label>
            <Select id="p-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="p-owner">Owner</Label>
            <Select id="p-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="p-target">Target date</Label>
            <Input id="p-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="p-status">Status</Label>
            <Select id="p-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((v) => (
                <option key={v} value={v}>{v.replace('_', ' ')}</option>
              ))}
            </Select>
          </div>
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create Project'}</Button>
        </div>
      </form>
    </Modal>
  );
}
