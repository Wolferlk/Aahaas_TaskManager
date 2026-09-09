'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Plus, UsersRound, AlertTriangle, SquarePen, UserPlus, UserMinus, Users } from 'lucide-react';
import { fetcher, apiPost, apiPatch, apiPut, ApiClientError } from '@/lib/client';
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
  const [managing, setManaging] = useState<Team | null>(null);

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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-ink">{t.name}</p>
                      {/* A disabled team looked identical to an active one. */}
                      {t.status === 'DISABLED' && (
                        <span className="rounded-full bg-line/60 px-2 py-0.5 text-[10px] font-semibold text-faint">
                          Disabled
                        </span>
                      )}
                    </div>
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

                <button
                  type="button"
                  onClick={() => setManaging(t)}
                  className="focus-ring mt-4 grid w-full grid-cols-3 gap-2 rounded-xl border-t border-line pt-3 text-center transition-colors hover:bg-line/20"
                  title={`Manage members of ${t.name}`}
                >
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
                </button>

                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => setManaging(t)}
                >
                  <Users className="h-3.5 w-3.5" /> Manage members
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
      <TeamFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => mutate()} />
      <TeamFormModal open={!!editing} team={editing} onClose={() => setEditing(null)} onSaved={() => mutate()} />
      <TeamMembersModal team={managing} onClose={() => setManaging(null)} onChanged={() => mutate()} />
    </>
  );
}

interface TeamMember {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  job_title: string | null;
  open_tasks: number;
  overdue_tasks: number;
}

/**
 * Members of one team, with the open and overdue counts the card only ever
 * showed as a total. The add/remove endpoints already existed — nothing in the
 * UI reached them.
 */
function TeamMembersModal({
  team,
  onClose,
  onChanged,
}: {
  team: Team | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { users } = useMeta();
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, mutate } = useSWR<{ members: TeamMember[] }>(
    team ? `/api/tm/teams/${team.id}` : null,
    fetcher,
  );

  const members = data?.members ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = users.filter((u) => !memberIds.has(u.id));

  const change = async (userIds: number[], action: 'add' | 'remove') => {
    if (!team) return;
    setBusy(true);
    try {
      await apiPut(`/api/tm/teams/${team.id}`, { user_ids: userIds, action });
      toast({ kind: 'success', title: action === 'add' ? 'Member added' : 'Member removed' });
      setAdding('');
      mutate();
      onChanged();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update the team.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!team} onClose={onClose} title={team ? `Members of ${team.name}` : 'Team members'}>
      <OverlayHeader
        title={team ? `${team.name} members` : 'Team members'}
        subtitle={team ? `${team.code} · ${team.department_name}` : undefined}
        onClose={onClose}
      />
      <div className="space-y-4 p-6">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="tm-add">Add someone</Label>
            <Select id="tm-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose a person…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                  {u.job_title ? ` — ${u.job_title}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            disabled={!adding || busy}
            onClick={() => change([Number(adding)], 'add')}
          >
            <UserPlus className="h-4 w-4" /> Add
          </Button>
        </div>

        {isLoading && <Skeleton className="h-32" />}
        {!isLoading && members.length === 0 && (
          <EmptyState icon={UsersRound} title="Nobody is in this team yet" description="Add someone above to get started." />
        )}

        {members.length > 0 && (
          <div className="divide-y divide-line rounded-xl border border-line">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <Avatar name={m.full_name} src={m.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{m.full_name}</p>
                  <p className="truncate text-xs text-faint">{m.job_title ?? m.email}</p>
                </div>
                <div className="shrink-0 text-right text-[11px] leading-tight">
                  <p className="text-muted">{m.open_tasks} open</p>
                  <p className={m.overdue_tasks > 0 ? 'text-red-500' : 'text-faint'}>{m.overdue_tasks} overdue</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => change([m.id], 'remove')}
                  className="focus-ring shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  aria-label={`Remove ${m.full_name} from the team`}
                  title="Remove from team"
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
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
  const { departments, activeDepartments, users } = useMeta();
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

  // Temporary: teams can only be created under the IT department.
  const itDepartment = activeDepartments.find(
    (d) => d.code?.toUpperCase() === 'IT' || d.name.trim().toUpperCase() === 'IT',
  );
  // Editing an existing team outside IT keeps showing its own department.
  const lockedDepartment = isEdit
    ? departments.find((d) => d.id === team!.department_id) ?? itDepartment
    : itDepartment;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(team?.name ?? '');
    setCode(team?.code ?? '');
    setDepartmentId(
      team?.department_id ? String(team.department_id) : itDepartment ? String(itDepartment.id) : '',
    );
    setLeaderId(team?.leader_user_id ? String(team.leader_user_id) : '');
    setDescription(team?.description ?? '');
    setStatus(team?.status ?? 'ACTIVE');
  }, [open, team, itDepartment]);

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
          <Select id="t-dept" required disabled value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {lockedDepartment ? (
              <option value={lockedDepartment.id}>{lockedDepartment.name}</option>
            ) : (
              <option value="">Select department</option>
            )}
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
