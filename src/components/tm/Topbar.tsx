'use client';

import { Search, Plus, Sun, Moon, Monitor } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

export function Topbar({ onSearch, onAdd }: { onSearch: () => void; onAdd: () => void }) {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    const order: Array<typeof theme> = ['light', 'dark', 'system'];
    setTheme(order[(order.indexOf(theme) + 1) % order.length]);
  };

  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur md:px-6">
      <button
        onClick={onSearch}
        className="focus-ring flex h-10 flex-1 max-w-md items-center gap-2.5 rounded-xl border border-line bg-bg px-3.5 text-sm text-faint hover:border-faint/60"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search tasks, people, projects...</span>
        <span className="sm:hidden">Search</span>
        <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-faint sm:flex">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onAdd}
          className="focus-ring hidden items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-medium text-brand-ink shadow-sm hover:brightness-110 sm:flex"
        >
          <Plus className="h-4 w-4" /> New Task
        </button>
        <button
          onClick={onAdd}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line/30 hover:text-ink sm:hidden"
          aria-label="New task"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={cycle}
          className={cn('focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-line/30 hover:text-ink')}
          aria-label="Toggle theme"
          title={`Theme: ${theme}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </button>
        <NotificationBell />
      </div>
    </header>
  );
}
