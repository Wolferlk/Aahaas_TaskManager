'use client';

import { cn } from '@/lib/cn';

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'focus-ring relative shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
            active === t.id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-line/30 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={cn('ml-1.5 text-xs', active === t.id ? 'text-brand' : 'text-faint')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
