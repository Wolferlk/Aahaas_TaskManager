import { cn } from '@/lib/cn';
import type { Priority, TaskStatus } from '@/lib/types';

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'brand' | 'outline' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-line/60 text-muted',
        variant === 'brand' && 'bg-brand-soft text-brand',
        variant === 'outline' && 'border border-line text-muted',
        className,
      )}
      {...props}
    />
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  CRITICAL: 'bg-red-500/12 text-red-600 dark:text-red-400',
  HIGH: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  MEDIUM: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  LOW: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
};

const PRIORITY_DOT: Record<Priority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', PRIORITY_STYLE[priority])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[priority])} />
      {priority[0] + priority.slice(1).toLowerCase()}
    </span>
  );
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  DRAFT: 'bg-line/60 text-muted',
  TODO: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
  IN_PROGRESS: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
  BLOCKED: 'bg-red-500/12 text-red-600 dark:text-red-400',
  WAITING: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  REVIEW: 'bg-purple-500/12 text-purple-600 dark:text-purple-400',
  COMPLETED: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  REJECTED: 'bg-red-500/12 text-red-600 dark:text-red-400',
  CANCELLED: 'bg-line/60 text-faint line-through',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  DRAFT: 'Draft',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  WAITING: 'Waiting',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}
