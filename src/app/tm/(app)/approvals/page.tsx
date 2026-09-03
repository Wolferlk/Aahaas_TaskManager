'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { ClipboardCheck, Check, X } from 'lucide-react';
import { fetcher, apiPost, ApiClientError } from '@/lib/client';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState, Skeleton } from '@/components/ui/Misc';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useMeta } from '@/hooks/useMeta';
import { timeAgo } from '@/lib/format';

interface Approval {
  id: number;
  type: string;
  requester_id: number | null;
  requester_name: string | null;
  requester_avatar: string | null;
  requester_email: string | null;
  requested_role: string | null;
  job_title: string | null;
  department_name: string | null;
  team_name: string | null;
  reason: string | null;
  payload: unknown;
  status: string;
  created_at: string;
  task_number: string | null;
  task_title: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  USER_SIGNUP: 'User Signups',
  TASK_COMPLETION: 'Task Completion',
  DEADLINE_EXTENSION: 'Deadline Extensions',
  TASK_REASSIGNMENT: 'Reassignments',
  LEADER_REQUEST: 'Leader Requests',
};

export default function ApprovalsPage() {
  const [type, setType] = useState('ALL');
  const { data, isLoading, mutate } = useSWR<{ approvals: Approval[]; counts: Record<string, number> }>(
    `/api/tm/approvals?status=PENDING${type !== 'ALL' ? `&type=${type}` : ''}`,
    fetcher,
  );
  const { departments, teams } = useMeta();
  const toast = useToast();

  const tabs = [
    { id: 'ALL', label: 'All', count: Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0) },
    ...Object.entries(TYPE_LABEL).map(([id, label]) => ({ id, label, count: data?.counts[id] ?? 0 })),
  ];

  const decide = async (id: number, decision: 'APPROVED' | 'REJECTED', overrides?: Record<string, unknown>, comment?: string) => {
    try {
      await apiPost(`/api/tm/approvals/${id}`, { decision, comment, overrides });
      toast({ kind: 'success', title: decision === 'APPROVED' ? 'Approved' : 'Rejected' });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not process this request' });
    }
  };

  return (
    <>
      <PageHeader title="Approval Center" subtitle="Signups, completions, deadlines and reassignments" />
      <div className="px-4 pt-4 sm:px-6">
        <Tabs tabs={tabs} active={type} onChange={setType} />
      </div>
      <PageBody className="space-y-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        {data && data.approvals.length === 0 && <EmptyState icon={ClipboardCheck} title="Nothing pending" description="You're all caught up." />}

        {data?.approvals.map((a) => (
          <Card key={a.id} className="animate-fade-up">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Avatar name={a.requester_name} src={a.requester_avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{a.requester_name ?? 'Unknown'}</p>
                    <span className="rounded-full bg-line/50 px-2 py-0.5 text-[11px] text-muted">{TYPE_LABEL[a.type] ?? a.type}</span>
                    <span className="text-xs text-faint">{timeAgo(a.created_at)}</span>
                  </div>

                  {a.type === 'USER_SIGNUP' && (
                    <p className="mt-1 text-xs text-muted">
                      Requested <strong className="text-ink">{a.requested_role}</strong> access
                      {a.job_title ? ` · ${a.job_title}` : ''}
                      {a.department_name ? ` · ${a.department_name}` : ''}
                    </p>
                  )}
                  {a.type === 'DEADLINE_EXTENSION' && (
                    <p className="mt-1 text-xs text-muted">
                      {a.task_number}: {a.task_title} — {a.reason}
                    </p>
                  )}
                  {a.type !== 'USER_SIGNUP' && a.type !== 'DEADLINE_EXTENSION' && a.reason && (
                    <p className="mt-1 text-xs text-muted">{a.reason}</p>
                  )}

                  {a.type === 'USER_SIGNUP' ? (
                    <SignupDecision approval={a} departments={departments} teams={teams} onDecide={decide} />
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" onClick={() => decide(a.id, 'APPROVED')}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const c = prompt('Reason for rejection:');
                          if (c) decide(a.id, 'REJECTED', undefined, c);
                        }}
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </PageBody>
    </>
  );
}

function SignupDecision({
  approval,
  departments,
  teams,
  onDecide,
}: {
  approval: Approval;
  departments: Array<{ id: number; name: string }>;
  teams: Array<{ id: number; name: string; department_id: number }>;
  onDecide: (id: number, decision: 'APPROVED' | 'REJECTED', overrides?: Record<string, unknown>, comment?: string) => void;
}) {
  const [role, setRole] = useState(approval.requested_role ?? 'EMPLOYEE');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Select value={role} onChange={(e) => setRole(e.target.value)} className="!h-8 !w-auto text-xs">
        <option value="EMPLOYEE">Employee</option>
        <option value="LEADER">Leader</option>
        <option value="MANAGER">Manager</option>
      </Select>
      <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="!h-8 !w-auto text-xs">
        <option value="">Keep department</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="!h-8 !w-auto text-xs">
        <option value="">Keep team</option>
        {teams.filter((t) => !departmentId || String(t.department_id) === departmentId).map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </Select>
      <Button
        size="sm"
        onClick={() =>
          onDecide(approval.id, 'APPROVED', {
            role,
            department_id: departmentId ? Number(departmentId) : undefined,
            team_id: teamId ? Number(teamId) : undefined,
          })
        }
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          const c = prompt('Reason for rejection (optional):') ?? '';
          onDecide(approval.id, 'REJECTED', undefined, c);
        }}
      >
        <X className="h-3.5 w-3.5" /> Reject
      </Button>
    </div>
  );
}
