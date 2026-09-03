'use client';

import { Suspense, useState } from 'react';
import useSWR from 'swr';
import { Search, Users as UsersIcon } from 'lucide-react';
import { fetcher, apiPatch, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
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
  avatar_url: string | null;
  job_title: string | null;
  availability: string;
  department_name: string | null;
  team_name: string | null;
  open_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
}

const AVAILABILITY_STYLE: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500',
  BUSY: 'bg-amber-500',
  ON_LEAVE: 'bg-slate-400',
  REMOTE: 'bg-sky-500',
  OFFLINE: 'bg-line',
};

function UsersInner() {
  const { can } = useSession();
  const { departments } = useMeta();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('ALL');
  const [departmentId, setDepartmentId] = useState('');
  const toast = useToast();

  const params = new URLSearchParams({
    ...(q ? { q } : {}),
    ...(role !== 'ALL' ? { role } : {}),
    ...(departmentId ? { department_id: departmentId } : {}),
    status: 'ACTIVE',
  });

  const { data, isLoading, mutate } = useSWR<{ users: UserRow[] }>(`/api/tm/users?${params}`, fetcher);

  const changeRole = async (id: number, newRole: string) => {
    try {
      await apiPatch(`/api/tm/users/${id}`, { role: newRole });
      toast({ kind: 'success', title: 'Role updated' });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update role' });
    }
  };

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
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        )}
        {data && data.users.length === 0 && <EmptyState icon={UsersIcon} title="No people match your filters" />}

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
                    <p className="truncate text-sm font-medium text-ink">{u.full_name}</p>
                    <p className="truncate text-xs text-faint">{u.job_title ?? u.email}</p>
                    <p className="mt-0.5 text-xs text-faint">{u.team_name ?? u.department_name ?? '—'}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  {can('tm.user.change_role') ? (
                    <Select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} className="!h-7 !w-auto text-xs">
                      <option value="EMPLOYEE">Employee</option>
                      <option value="LEADER">Leader</option>
                      <option value="MANAGER">Manager</option>
                    </Select>
                  ) : (
                    <span className="rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">{u.role}</span>
                  )}
                  <div className="flex gap-2 text-[11px] text-faint">
                    <span>{u.open_tasks} open</span>
                    {u.overdue_tasks > 0 && <span className="text-red-500">{u.overdue_tasks} overdue</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageBody>
    </>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersInner />
    </Suspense>
  );
}
