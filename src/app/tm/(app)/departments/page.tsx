'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Building2 } from 'lucide-react';
import { fetcher, apiPost, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/Field';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/components/ui/Toast';

interface Department {
  id: number;
  name: string;
  code: string;
  status: string;
  manager_name: string | null;
  team_count: number;
  member_count: number;
  open_tasks: number;
}

export default function DepartmentsPage() {
  const { data, isLoading, mutate } = useSWR<{ departments: Department[] }>('/api/tm/departments', fetcher);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Departments"
        subtitle="Organizational structure for the Task Management System"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Department</Button>}
      />
      <PageBody>
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
          </div>
        )}
        {data && data.departments.length === 0 && <EmptyState icon={Building2} title="No departments yet" />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.departments.map((d) => (
            <Card key={d.id} className="animate-fade-up">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">{d.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.status === 'ACTIVE' ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-line/50 text-muted'}`}>
                    {d.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-faint">{d.code} · Manager: {d.manager_name ?? '—'}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div>
                    <p className="text-lg font-semibold text-ink">{d.team_count}</p>
                    <p className="text-[11px] text-faint">Teams</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-ink">{d.member_count}</p>
                    <p className="text-[11px] text-faint">People</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-ink">{d.open_tasks}</p>
                    <p className="text-[11px] text-faint">Open Tasks</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
      <CreateDepartmentModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => mutate()} />
    </>
  );
}

function CreateDepartmentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { users } = useMeta();
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [managerId, setManagerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName(''); setCode(''); setDescription(''); setManagerId(''); setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/tm/departments', {
        name, code, description: description || null, manager_user_id: managerId ? Number(managerId) : null,
      });
      toast({ kind: 'success', title: 'Department created' });
      onCreated();
      close();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create department.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="New department">
      <OverlayHeader title="New Department" onClose={close} />
      <form onSubmit={submit} className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="d-name">Name</Label>
            <Input id="d-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="d-code">Code</Label>
            <Input id="d-code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. IT" />
          </div>
        </div>
        <div>
          <Label htmlFor="d-desc">Description</Label>
          <Textarea id="d-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="d-mgr">Department Manager</Label>
          <Select id="d-mgr" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">—</option>
            {users.filter((u) => u.role === 'MANAGER').map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={saving}>Create Department</Button>
        </div>
      </form>
    </Modal>
  );
}
