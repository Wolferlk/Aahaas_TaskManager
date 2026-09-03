'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, UsersRound, AlertTriangle } from 'lucide-react';
import { fetcher, apiPost, ApiClientError } from '@/lib/client';
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
                <p className="text-sm font-semibold text-ink">{t.name}</p>
                <p className="text-xs text-faint">{t.code} · {t.department_name}</p>

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
      <CreateTeamModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => mutate()} />
    </>
  );
}

function CreateTeamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { departments, users } = useMeta();
  const toast = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName(''); setCode(''); setDepartmentId(''); setLeaderId(''); setDescription(''); setError(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!departmentId) { setError('Choose a department.'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/tm/teams', {
        name, code, department_id: Number(departmentId),
        leader_user_id: leaderId ? Number(leaderId) : null,
        description: description || null,
      });
      toast({ kind: 'success', title: 'Team created' });
      onCreated();
      close();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create team.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="New team">
      <OverlayHeader title="New Team" onClose={close} />
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
        <div>
          <Label htmlFor="t-leader">Leader</Label>
          <Select id="t-leader" value={leaderId} onChange={(e) => setLeaderId(e.target.value)}>
            <option value="">Assign later</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="t-desc">Description</Label>
          <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <FieldError>{error}</FieldError>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" loading={saving}>Create Team</Button>
        </div>
      </form>
    </Modal>
  );
}
