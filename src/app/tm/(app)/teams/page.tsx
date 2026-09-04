'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Plus, UsersRound, AlertTriangle, SquarePen } from 'lucide-react';
import { fetcher, apiPost, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea, FieldError } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/components/ui/Toast';

interface Team {
  id: number;
  name: string;
  code: string;
  description: string | null;
  department_id: number;
  leader_user_id: number | null;
  status: string;
  department_name: string;
  leader_name: string | null;
  leader_avatar: string | null;
  member_count: number;
  open_tasks: number;
  overdue_tasks: number;
}

export default function TeamsPage() {
  const { data, isLoading, mutate } = useSWR<{ teams: Team[] }>('/api/tm/teams', fetcher);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Teams belong to departments and are led by a Leader"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Team</Button>}
      />
      <PageBody>
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        )}
        {data && data.teams.length === 0 && <EmptyState icon={UsersRound} title="No teams yet" />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.teams.map((t) => (
            <Card key={t.id} className="animate-fade-up">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                    <p className="text-xs text-faint">{t.code} · {t.department_name}</p>
                  </div>
                  <button
                    onClick={() => setEditing(t)}
                    className="focus-ring shrink-0 rounded-lg p-1.5 text-faint hover:bg-line/30 hover:text-ink"
                    aria-label={`Edit ${t.name}`}
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {t.leader_name ? (
                    <>
                      <Avatar name={t.leader_name} src={t.leader_avatar} size="xs" />
                      <span className="text-xs text-muted">{t.leader_name}</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3 w-3" /> No leader assigned</span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div>
                    <p className="text-lg font-semibold text-ink">{t.member_count}</p>
                    <p className="text-[11px] text-faint">Members</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-ink">{t.open_tasks}</p>
                    <p className="text-[11px] text-faint">Open</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-red-500">{t.overdue_tasks}</p>
                    <p className="text-[11px] text-faint">Overdue</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
      <TeamFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => mutate()} />
      <TeamFormModal open={!!editing} team={editing} onClose={() => setEditing(null)} onSaved={() => mutate()} />
    </>
  );
}

function TeamFormModal({
  open,
  team,
  onClose,
  onSaved,
}: {
  open: boolean;
  team?: Team | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { departments, users } = useMeta();
  const toast = useToast();
  const isEdit = !!team;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(team?.name ?? '');
    setCode(team?.code ?? '');
    setDepartmentId(team?.department_id ? String(team.department_id) : '');
    setLeaderId(team?.leader_user_id ? String(team.leader_user_id) : '');
    setDescription(team?.description ?? '');
    setStatus(team?.status ?? 'ACTIVE');
  }, [open, team]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId) { setError('Choose a department.'); return; }
    setSaving(true);
    setError(null);
    const payload = {
      name,
      code,
      department_id: Number(departmentId),
      leader_user_id: leaderId ? Number(leaderId) : null,
      description: description || null,
      status,
    };
    try {
      if (isEdit) {
        await apiPatch(`/api/tm/teams/${team!.id}`, payload);
        toast({ kind: 'success', title: 'Team updated' });
      } else {
        await apiPost('/api/tm/teams', payload);
        toast({ kind: 'success', title: 'Team created' });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save the team.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit team' : 'New team'}>
      <OverlayHeader
        title={isEdit ? `Edit ${team!.name}` : 'New Team'}
        subtitle={isEdit ? 'Changing the Leader preserves all task history.' : undefined}
        onClose={onClose}
      />
      <form onSubmit={submit} className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="t-name">Name</Label>
            <Input id="t-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-code">Code</Label>
            <Input id="t-code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div>
          <Label htmlFor="t-dept">Department</Label>
          <Select id="t-dept" required value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Select department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="t-leader">Leader</Label>
            <Select id="t-leader" value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
              <option value="">Assign later</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="t-status">Status</Label>
            <Select id="t-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="t-desc">Description</Label>
          <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save changes' : 'Create Team'}</Button>
        </div>
      </form>
    </Modal>
  );
}
