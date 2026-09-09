'use client';

import { Suspense, useEffect, useState } from 'react';
import useSWR from 'swr';
import { Search, Users as UsersIcon, SquarePen, AlertTriangle, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { fetcher, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Label, Select, FieldError } from '@/components/ui/Field';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Button } from '@/components/ui/Button';
import { Modal, OverlayHeader } from '@/components/ui/Overlay';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { useSession } from '@/hooks/useSession';
import { useMeta } from '@/hooks/useMeta';
import { useToast } from '@/components/ui/Toast';

interface UserRow {
  id: number;
  full_name: string;
  email: string;
  role: string;
  status?: string;
  avatar_url: string | null;
  job_title: string | null;
  employee_code?: string | null;
  phone?: string | null;
  availability: string;
  department_id: number | null;
  team_id: number | null;
  department_name: string | null;
  team_name: string | null;
  open_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
}

/** Only a status that is not simply "in good standing" earns a tag. */
const STATUS_TAG: Record<string, { label: string; className: string }> = {
  PENDING_APPROVAL: { label: 'Pending approval', className: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
  DISABLED: { label: 'Disabled', className: 'bg-line/60 text-faint' },
  REJECTED: { label: 'Rejected', className: 'bg-red-500/12 text-red-600 dark:text-red-400' },
};

const AVAILABILITY_STYLE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500',
  BUSY: 'bg-amber-500',
  ON_LEAVE: 'bg-slate-400',
  REMOTE: 'bg-sky-500',
  OFFLINE: 'bg-line',
};

function UsersInner() {
  const { can } = useSession();
  const { departments, activeDepartments } = useMeta();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('ALL');
  const [departmentId, setDepartmentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [editing, setEditing] = useState<UserRow | null>(null);

  const params = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(role !== 'ALL' ? { role } : {}),
    ...(departmentId ? { department_id: departmentId } : {}),
    status: statusFilter,
  });

  const { data, error, isLoading, mutate } = useSWR<{ users: UserRow[] }>(`/api/tm/users?${params}`, fetcher);

  return (
    <>
      <PageHeader title="People" subtitle="Everyone with access to the Task Management System" />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people..."
              className="focus-ring h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-faint"
            />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="!h-9 !w-auto text-sm">
            <option value="ALL">All roles</option>
            <option value="MANAGER">Manager</option>
            <option value="LEADER">Leader</option>
            <option value="EMPLOYEE">Employee</option>
          </Select>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="!h-9 !w-auto text-sm">
            <option value="">All departments</option>
            {activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!h-9 !w-auto text-sm">
            <option value="ACTIVE">Active</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="DISABLED">Disabled</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All statuses</option>
          </Select>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        )}
        {/* A failed load used to render as an empty page, which is
            indistinguishable from "nobody matches". */}
        {error && !isLoading && (
          <EmptyState
            icon={AlertTriangle}
            title="The directory could not be loaded"
            description="Refresh the page, or try again in a moment."
            action={<Button size="sm" variant="secondary" onClick={() => mutate()}>Retry</Button>}
          />
        )}
        {data && data.users.length === 0 && (
          <EmptyState
            icon={UsersIcon}
            title="No people match your filters"
            description={
              statusFilter === 'PENDING_APPROVAL'
                ? 'Nobody is waiting for approval right now.'
                : undefined
            }
          />
        )}
        {statusFilter === 'PENDING_APPROVAL' && !!data?.users.length && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
            <p className="text-sm text-ink">
              {data.users.length} {data.users.length === 1 ? 'person is' : 'people are'} waiting for a decision.
            </p>
            <Link href="/tm/approvals">
              <Button size="sm" variant="secondary"><ClipboardCheck className="h-3.5 w-3.5" /> Open Approval Center</Button>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.users.map((u) => (
            <Card key={u.id} className="animate-fade-up">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <Avatar name={u.full_name} src={u.avatar_url} size="md" />
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${AVAILABILITY_STYLE[u.availability]}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-ink">{u.full_name}</p>
                      {u.status && STATUS_TAG[u.status] && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TAG[u.status].className}`}
                        >
                          {STATUS_TAG[u.status].label}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-faint">{u.job_title ?? u.email}</p>
                    <p className="mt-0.5 text-xs text-faint">{u.team_name ?? u.department_name ?? '—'}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">{u.role}</span>
                  <div className="flex items-center gap-2 text-[11px] text-faint">
                    <span>{u.open_tasks} open</span>
                    {u.overdue_tasks > 0 && <span className="text-red-500">{u.overdue_tasks} overdue</span>}
                    {can('tm.user.manage') && (
                      <button
                        onClick={() => setEditing(u)}
                        className="focus-ring rounded-lg p-1.5 text-faint hover:bg-line/30 hover:text-ink"
                        aria-label={`Edit ${u.full_name}`}
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>

      <UserEditModal
        open={!!editing}
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={() => mutate()}
      />
    </>
  );
}

function UserEditModal({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { departments, teams, activeDepartments, activeTeams } = useMeta();
  const toast = useToast();

  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  const [status, setStatus] = useState('ACTIVE');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setError(null);
    setFullName(user.full_name);
    setJobTitle(user.job_title ?? '');
    setEmployeeCode(user.employee_code ?? '');
    setPhone(user.phone ?? '');
    setRole(user.role);
    setStatus(user.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE');
    setDepartmentId(user.department_id ? String(user.department_id) : '');
    setTeamId(user.team_id ? String(user.team_id) : '');
  }, [open, user]);

  const pending = user?.status === 'PENDING_APPROVAL';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/tm/users/${user.id}`, {
        full_name: fullName.trim(),
        job_title: jobTitle.trim() || null,
        employee_code: employeeCode.trim() || null,
        phone: phone.trim() || null,
        role,
        // A pending signup is approved in the Approval Center, never as a
        // side effect of correcting someone's job title here.
        ...(pending && status === 'ACTIVE' ? {} : { status }),
        department_id: departmentId ? Number(departmentId) : null,
        team_id: teamId ? Number(teamId) : null,
      });
      toast({ kind: 'success', title: `${fullName} updated` });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save this person.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  // A person already sitting in a disabled department or team keeps seeing it,
  // so saving an unrelated field does not silently move them out of it.
  const departmentOptions = activeDepartments.some((d) => String(d.id) === departmentId) || !departmentId
    ? activeDepartments
    : [...activeDepartments, ...departments.filter((d) => String(d.id) === departmentId)];
  const teamOptions = [...activeTeams, ...teams.filter((t) => String(t.id) === teamId && t.status === 'DISABLED')]
    .filter((t) => !departmentId || String(t.department_id) === departmentId);

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${user.full_name}`}>
      <OverlayHeader title={`Edit ${user.full_name}`} subtitle={user.email} onClose={onClose} />
      <form onSubmit={submit} className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="u-title">Job title</Label>
            <Input id="u-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="u-code">Employee ID</Label>
            <Input id="u-code" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="u-phone">Mobile</Label>
            <PhoneInput id="u-phone" value={phone} onChange={setPhone} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="u-role">Role</Label>
            <Select id="u-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="EMPLOYEE">Employee</option>
              <option value="LEADER">Leader</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="u-status">Account status</Label>
            <Select id="u-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">{pending ? 'Pending approval — decide in Approval Center' : 'Active'}</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="u-dept">Department</Label>
            <Select
              id="u-dept"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setTeamId('');
              }}
            >
              <option value="">—</option>
              {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="u-team">Team</Label>
            <Select id="u-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">—</option>
              {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        </div>

        <FieldError>{error}</FieldError>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersInner />
    </Suspense>
  );
}
