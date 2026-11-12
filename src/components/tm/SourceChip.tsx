import { ClipboardList, NotebookPen } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Where a row of work came from. Wherever tasks and Daily Update entries share
 * one list, each row says what it is in the same spot and colour.
 */
export function SourceChip({ kind, className }: { kind: 'task' | 'daily'; className?: string }) {
  const isTask = kind === 'task';
  const Icon = isTask ? ClipboardList : NotebookPen;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        isTask
          ? 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300'
          : 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {isTask ? 'Task' : 'Daily Update'}
    </span>
  );
}
