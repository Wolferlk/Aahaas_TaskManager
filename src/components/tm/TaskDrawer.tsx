'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Calendar, Clock, User, Flag, CheckSquare,
  Plus, Send, Trash2, Pencil, ExternalLink, AlertCircle, GitBranch, ChevronRight,
} from 'lucide-react';
import { Drawer, OverlayHeader } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { Textarea, Select } from '@/components/ui/Field';
import { PriorityBadge, StatusBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { ProgressBar, Skeleton, Divider } from '@/components/ui/Misc';
import { Tabs } from '@/components/ui/Tabs';
import { fmtDate, fmtDateTime, fmtDueIn, timeAgo } from '@/lib/format';
import { fetcher, apiPatch, apiPost, ApiClientError } from '@/lib/client';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/hooks/useSession';
import type { TaskStatus } from '@/lib/types';

interface TaskDetail {
  task: Record<string, unknown> & {
    id: number; task_number: string; title: string; description: string | null;
    status: TaskStatus; priority: string; progress: number; deadline: string | null;
    assignee_id: number | null; assignee_name: string | null; assignee_avatar: string | null;
    creator_name: string | null; project_name: string | null; team_name: string | null;
    department_name: string | null; created_at: string; completed_at: string | null;
    estimated_hours: string | null; actual_hours: string | null; completion_notes: string | null;
    ai_summary: string | null; approval_required: 0 | 1;
  };
  subtasks: Array<{ id: number; task_number: string; title: string; status: TaskStatus; progress: number; assignee_name: string | null; assignee_avatar: string | null }>;
  checklist: Array<{ id: number; title: string; is_done: 0 | 1 }>;
  comments: Array<{ id: number; body: string; user_id: number | null; full_name: string | null; avatar_url: string | null; created_at: string; is_system: 0 | 1; edited_at: string | null }>;
  activity: Array<{ id: number; action: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string; full_name: string | null; avatar_url: string | null }>;
  dependencies: Array<{ id: number; type: string; task_number: string; title: string; status: TaskStatus }>;
  warnings: string[];
  can_edit: boolean;
  can_approve: boolean;
}

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Activity' },
];

export function TaskDrawer({ taskId, onClose, onChanged }: { taskId: number; onClose: () => void; onChanged?: () => void }) {
  const { data, isLoading, mutate } = useSWR<TaskDetail>(`/api/tm/tasks/${taskId}`, fetcher);
  const [tab, setTab] = useState('details');
  const toast = useToast();
  const { user } = useSession();

  const refresh = async () => {
    await mutate();
    onChanged?.();
  };

  const updateStatus = async (status: string) => {
    try {
      await apiPatch(`/api/tm/tasks/${taskId}`, { status });
      toast({ kind: 'success', title: 'Status updated' });
      refresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update status' });
    }
  };

  const workflow = async (action: string, comment?: string) => {
    try {
      await apiPost(`/api/tm/tasks/${taskId}/workflow`, { action, comment });
      toast({ kind: 'success', title: 'Task updated' });
      refresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Action failed' });
    }
  };

  return (
    <Drawer open onClose={onClose} width="max-w-2xl">
      {isLoading || !data ? (
        <div className="p-6"><Skeleton className="h-96" /></div>
      ) : (
        <>
          <OverlayHeader
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-faint">{data.task.task_number}</span>
                <StatusBadge status={data.task.status} />
              </span>
            }
            subtitle={
              <Link href={`/tm/tasks/${data.task.id}`} className="flex items-center gap-1 text-xs text-brand hover:underline">
                Open full page <ExternalLink className="h-3 w-3" />
              </Link>
            }
            onClose={onClose}
          />

          <div className="px-6 pt-5">
            <h2 className="text-lg font-semibold leading-snug text-ink">{data.task.title}</h2>

            {data.warnings.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{data.warnings.map((w) => <p key={w}>{w}</p>)}</div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusSelector status={data.task.status} disabled={!data.can_edit && data.task.assignee_id !== user?.id} onChange={updateStatus} />
              <PriorityBadge priority={data.task.priority as never} />
              {data.task.deadline && <DeadlinePill deadline={data.task.deadline} />}
            </div>

            <div className="mt-4">
              <ProgressBar value={data.task.progress} />
              <p className="mt-1 text-xs text-muted">{data.task.progress}% complete</p>
            </div>

            {data.task.status === 'REVIEW' && data.can_approve && (
              <div className="mt-4 flex gap-2 rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                <Button size="sm" onClick={() => workflow('approve')}>Approve</Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const c = prompt('What needs to change?');
                    if (c) workflow('reject', c);
                  }}
                >
                  Request changes
                </Button>
              </div>
            )}
          </div>

          <div className="sticky top-[73px] z-10 mt-5 border-b border-line bg-elevated px-6">
            <Tabs
              tabs={[
                ...TABS.slice(0, 1),
                { ...TABS[1], count: data.checklist.length },
                { ...TABS[2], count: data.comments.length },
                { ...TABS[3], count: data.activity.length },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>

          <div className="p-6">
            {tab === 'details' && <DetailsTab data={data} onWorkflow={workflow} onRefresh={refresh} />}
            {tab === 'checklist' && <ChecklistTab taskId={taskId} checklist={data.checklist} onRefresh={refresh} />}
            {tab === 'comments' && <CommentsTab taskId={taskId} comments={data.comments} onRefresh={refresh} />}
            {tab === 'activity' && <ActivityTab activity={data.activity} />}
          </div>
        </>
      )}
    </Drawer>
  );
}

function StatusSelector({ status, disabled, onChange }: { status: TaskStatus; disabled?: boolean; onChange: (s: string) => void }) {
  const options: TaskStatus[] = ['DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'CANCELLED'];
  if (disabled) return <StatusBadge status={status} />;
  return (
    <Select value={status} onChange={(e) => onChange(e.target.value)} className="!h-8 !w-auto text-xs">
      {options.map((s) => (
        <option key={s} value={s}>{s.replace('_', ' ')}</option>
      ))}
    </Select>
  );
}

function DeadlinePill({ deadline }: { deadline: string }) {
  const due = fmtDueIn(deadline);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        due.overdue ? 'bg-red-500/12 text-red-600 dark:text-red-400' : due.soon ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400' : 'bg-line/50 text-muted'
      }`}
    >
      <Calendar className="h-3 w-3" /> {due.label}
    </span>
  );
}

function DetailsTab({
  data,
  onWorkflow,
  onRefresh,
}: {
  data: TaskDetail;
  onWorkflow: (action: string, comment?: string) => void;
  onRefresh: () => void;
}) {
  const t = data.task;
  return (
    <div className="space-y-5">
      {t.description && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Description</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{t.description}</p>
        </div>
      )}

      {t.ai_summary && (
        <div className="rounded-xl border border-brand/20 bg-brand-soft/40 p-3.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-brand">AI Summary</p>
          <p className="text-sm text-ink">{t.ai_summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <InfoRow icon={User} label="Assignee">
          {t.assignee_name ? (
            <span className="flex items-center gap-2">
              <Avatar name={t.assignee_name} src={t.assignee_avatar} size="xs" /> {t.assignee_name}
            </span>
          ) : 'Unassigned'}
        </InfoRow>
        <InfoRow icon={User} label="Created by">{t.creator_name ?? '—'}</InfoRow>
        <InfoRow icon={Flag} label="Project">{t.project_name ?? '—'}</InfoRow>
        <InfoRow icon={Flag} label="Team">{t.team_name ?? '—'}</InfoRow>
        <InfoRow icon={Clock} label="Estimated">{t.estimated_hours ? `${t.estimated_hours}h` : '—'}</InfoRow>
        <InfoRow icon={Clock} label="Actual">{t.actual_hours ? `${t.actual_hours}h` : '—'}</InfoRow>
        <InfoRow icon={Calendar} label="Created">{fmtDate(t.created_at)}</InfoRow>
        <InfoRow icon={Calendar} label="Completed">{t.completed_at ? fmtDate(t.completed_at) : '—'}</InfoRow>
      </div>

      {data.dependencies.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
            <GitBranch className="h-3.5 w-3.5" /> Dependencies
          </p>
          <div className="space-y-1.5">
            {data.dependencies.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="rounded-full bg-line/50 px-2 py-0.5 text-[10px] font-medium text-muted">{d.type.replace('_', ' ')}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{d.title}</span>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {data.subtasks.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Subtasks</p>
          <div className="space-y-1.5">
            {data.subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <Avatar name={s.assignee_name} src={s.assignee_avatar} size="xs" />
                <span className="min-w-0 flex-1 truncate text-ink">{s.title}</span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {t.completion_notes && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-faint">Completion notes</p>
          <p className="text-sm text-ink">{t.completion_notes}</p>
        </div>
      )}

      <Divider />

      <div className="flex flex-wrap gap-2">
        {t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && data.can_edit === false && (
          <Button size="sm" variant="secondary" onClick={() => onWorkflow('submit')}>Submit for review</Button>
        )}
        {(t.status === 'COMPLETED') && data.can_edit && (
          <Button size="sm" variant="secondary" onClick={() => onWorkflow('reopen')}>Reopen</Button>
        )}
        {t.status !== 'CANCELLED' && t.status !== 'COMPLETED' && data.can_edit && (
          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => onWorkflow('cancel')}>Cancel task</Button>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function ChecklistTab({ taskId, checklist, onRefresh }: { taskId: number; checklist: TaskDetail['checklist']; onRefresh: () => void }) {
  const [newItem, setNewItem] = useState('');
  const toast = useToast();

  const toggle = async (id: number, isDone: boolean) => {
    try {
      await apiPost(`/api/tm/tasks/${taskId}/checklist`, { action: 'toggle', item_id: id, is_done: !isDone });
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update item' });
    }
  };

  const add = async () => {
    if (!newItem.trim()) return;
    try {
      await apiPost(`/api/tm/tasks/${taskId}/checklist`, { action: 'add', title: newItem.trim() });
      setNewItem('');
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not add item' });
    }
  };

  const remove = async (id: number) => {
    try {
      await apiPost(`/api/tm/tasks/${taskId}/checklist`, { action: 'remove', item_id: id });
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not remove item' });
    }
  };

  const done = checklist.filter((c) => c.is_done).length;

  return (
    <div className="space-y-4">
      {checklist.length > 0 && (
        <div>
          <ProgressBar value={(done / checklist.length) * 100} />
          <p className="mt-1 text-xs text-muted">{done} of {checklist.length} complete</p>
        </div>
      )}

      <div className="space-y-1.5">
        {checklist.map((c) => (
          <div key={c.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-line/20">
            <button onClick={() => toggle(c.id, !!c.is_done)} className="focus-ring shrink-0">
              <CheckSquare className={`h-[18px] w-[18px] ${c.is_done ? 'fill-brand text-brand' : 'text-faint'}`} />
            </button>
            <span className={`flex-1 text-sm ${c.is_done ? 'text-faint line-through' : 'text-ink'}`}>{c.title}</span>
            <button onClick={() => remove(c.id)} className="shrink-0 text-faint opacity-0 hover:text-red-500 group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {checklist.length === 0 && <p className="py-4 text-center text-sm text-muted">No checklist items yet.</p>}
      </div>

      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add checklist item..."
          className="focus-ring h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm placeholder:text-faint"
        />
        <Button size="sm" variant="secondary" onClick={add}><Plus className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function CommentsTab({ taskId, comments, onRefresh }: { taskId: number; comments: TaskDetail['comments']; onRefresh: () => void }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const { user } = useSession();
  const toast = useToast();

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await apiPost(`/api/tm/tasks/${taskId}/comments`, { body: body.trim() });
      setBody('');
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not post comment' });
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (id: number) => {
    try {
      await apiPatch(`/api/tm/tasks/${taskId}/comments`, { comment_id: id, body: editText, action: 'edit' });
      setEditing(null);
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not save' });
    }
  };

  const remove = async (id: number) => {
    try {
      await apiPatch(`/api/tm/tasks/${taskId}/comments`, { comment_id: id, action: 'delete' });
      onRefresh();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not delete' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {comments.length === 0 && <p className="py-4 text-center text-sm text-muted">No comments yet. Start the conversation.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar name={c.full_name} src={c.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">{c.full_name ?? 'System'}</p>
                <p className="text-xs text-faint">{timeAgo(c.created_at)}{c.edited_at && ' · edited'}</p>
              </div>
              {editing === c.id ? (
                <div className="mt-1.5 space-y-2">
                  <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(c.id)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
              )}
              {c.user_id === user?.id && editing !== c.id && !c.is_system && (
                <div className="mt-1 flex gap-3">
                  <button onClick={() => { setEditing(c.id); setEditText(c.body); }} className="flex items-center gap-1 text-xs text-faint hover:text-brand">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={() => remove(c.id)} className="flex items-center gap-1 text-xs text-faint hover:text-red-500">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-line pt-4">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment... use @name to mention someone"
          rows={2}
          className="flex-1"
        />
        <Button onClick={send} loading={sending} size="icon"><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

const ACTIVITY_TEXT: Record<string, string> = {
  CREATED: 'created this task',
  STATUS_CHANGED: 'changed the status',
  ASSIGNEE_CHANGED: 'changed the assignee',
  DEADLINE_CHANGED: 'changed the deadline',
  PRIORITY_CHANGED: 'changed the priority',
  PROGRESS_CHANGED: 'updated progress',
  COMMENT_ADDED: 'commented',
  CHECKLIST_COMPLETED: 'completed a checklist item',
  APPROVE: 'approved this task',
  REJECT: 'requested changes',
  REOPENED: 'reopened this task',
  ESCALATED: 'escalated this task',
  DEPENDENCY_ADDED: 'added a dependency',
  DEADLINE_EXTENDED: 'extended the deadline',
};

function ActivityTab({ activity }: { activity: TaskDetail['activity'] }) {
  if (activity.length === 0) return <p className="py-4 text-center text-sm text-muted">No activity recorded yet.</p>;
  return (
    <div className="space-y-0">
      {activity.map((a, i) => (
        <div key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < activity.length - 1 && <div className="absolute left-[15px] top-8 h-full w-px bg-line" />}
          <Avatar name={a.full_name} src={a.avatar_url} size="sm" className="z-10" />
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-sm text-ink">
              <span className="font-medium">{a.full_name ?? 'System'}</span>{' '}
              <span className="text-muted">{ACTIVITY_TEXT[a.action] ?? a.action.toLowerCase().replace(/_/g, ' ')}</span>
            </p>
            {a.old_value && a.new_value && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-faint">
                <span className="rounded bg-line/50 px-1.5 py-0.5">{a.old_value}</span>
                <ChevronRight className="h-3 w-3" />
                <span className="rounded bg-line/50 px-1.5 py-0.5">{a.new_value}</span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-faint">{fmtDateTime(a.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
