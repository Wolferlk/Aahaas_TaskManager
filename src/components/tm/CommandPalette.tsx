'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Search, ArrowRight, Hash, User, FolderKanban, MessageSquare } from 'lucide-react';
import { fetcher } from '@/lib/client';
import { Modal } from '@/components/ui/Overlay';
import { StatusBadge } from '@/components/ui/Badge';

interface SearchResult {
  tasks: Array<{ id: number; task_number: string; title: string; status: string }>;
  people: Array<{ id: number; full_name: string; email: string }>;
  projects: Array<{ id: number; name: string; code: string }>;
  comments: Array<{ id: number; task_id: number; task_number: string; body: string }>;
  direct: { id: number } | null;
}

const STATIC_ACTIONS = [
  { label: 'Create Task', href: '#create-task', icon: ArrowRight },
  { label: 'Go to My Tasks', href: '/tm/tasks', icon: ArrowRight },
  { label: 'Go to Daily Update', href: '/tm/daily-updates/new', icon: ArrowRight },
  { label: 'Open Calendar', href: '/tm/tasks/calendar', icon: ArrowRight },
  { label: 'Open Reports', href: '/tm/reports', icon: ArrowRight },
  { label: 'Open Board', href: '/tm/tasks/board', icon: ArrowRight },
];

export function CommandPalette({
  open,
  onClose,
  onCreateTask,
}: {
  open: boolean;
  onClose: () => void;
  onCreateTask: () => void;
}) {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const debounced = useDebounced(query, 200);

  const { data } = useSWR<SearchResult>(
    open && debounced.length >= 2 ? `/api/tm/search?q=${encodeURIComponent(debounced)}` : null,
    fetcher,
  );

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filteredActions = useMemo(
    () => (query ? STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase())) : STATIC_ACTIONS),
    [query],
  );

  const go = (href: string) => {
    onClose();
    if (href === '#create-task') onCreateTask();
    else router.push(href);
  };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl overflow-hidden p-0" title="Command palette">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <Search className="h-4 w-4 shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, people, projects... or type TM-2026-000124"
          className="w-full bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint sm:block">esc</kbd>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {!query && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Quick actions</p>
            {filteredActions.map((a) => (
              <button
                key={a.label}
                onClick={() => go(a.href)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink hover:bg-line/30"
              >
                <ArrowRight className="h-4 w-4 text-faint" />
                {a.label}
              </button>
            ))}
          </div>
        )}

        {data?.direct && (
          <button
            onClick={() => go(`/tm/tasks?task=${data.direct!.id}`)}
            className="focus-ring mb-2 flex w-full items-center gap-3 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2.5 text-left text-sm hover:brightness-105"
          >
            <Hash className="h-4 w-4 text-brand" />
            <span className="font-medium text-brand">Jump to {(data.direct as { task_number?: string }).task_number}</span>
          </button>
        )}

        {!!data?.tasks?.length && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Tasks</p>
            {data.tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => go(`/tm/tasks?task=${t.id}`)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line/30"
              >
                <Hash className="h-4 w-4 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                <span className="shrink-0 text-xs text-faint">{t.task_number}</span>
                <StatusBadge status={t.status as never} />
              </button>
            ))}
          </div>
        )}

        {!!data?.people?.length && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">People</p>
            {data.people.map((p) => (
              <button
                key={p.id}
                onClick={() => go(`/tm/users?highlight=${p.id}`)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line/30"
              >
                <User className="h-4 w-4 shrink-0 text-faint" />
                <span className="truncate text-ink">{p.full_name}</span>
                <span className="ml-auto truncate text-xs text-faint">{p.email}</span>
              </button>
            ))}
          </div>
        )}

        {!!data?.projects?.length && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Projects</p>
            {data.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => go(`/tm/projects?highlight=${p.id}`)}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line/30"
              >
                <FolderKanban className="h-4 w-4 shrink-0 text-faint" />
                <span className="truncate text-ink">{p.name}</span>
                <span className="ml-auto text-xs text-faint">{p.code}</span>
              </button>
            ))}
          </div>
        )}

        {!!data?.comments?.length && (
          <div className="mb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Comments</p>
            {data.comments.map((c) => (
              <button
                key={c.id}
                onClick={() => go(`/tm/tasks?task=${c.task_id}`)}
                className="focus-ring flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-line/30"
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-ink">{c.body}</span>
                <span className="shrink-0 text-xs text-faint">{c.task_number}</span>
              </button>
            ))}
          </div>
        )}

        {query.length >= 2 && !data && (
          <p className="px-3 py-6 text-center text-sm text-muted">Searching...</p>
        )}
        {query.length >= 2 &&
          data &&
          !data.tasks.length &&
          !data.people.length &&
          !data.projects.length &&
          !data.comments.length && <p className="px-3 py-6 text-center text-sm text-muted">No results for &ldquo;{query}&rdquo;.</p>}
      </div>
    </Modal>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
