'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListChecks, Plus, NotebookPen, UserCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export function MobileNav({ onAdd }: { onAdd: () => void }) {
  const pathname = usePathname();

  const items = [
    { href: '/tm/dashboard', label: 'Home', icon: Home },
    { href: '/tm/tasks', label: 'Tasks', icon: ListChecks },
    { href: '#add', label: 'Add', icon: Plus, action: true },
    { href: '/tm/daily-updates', label: 'Updates', icon: NotebookPen },
    { href: '/tm/profile', label: 'Profile', icon: UserCircle },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-line bg-elevated/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        if (item.action) {
          return (
            <button
              key={item.label}
              onClick={onAdd}
              className="flex flex-col items-center gap-1 rounded-xl px-3 py-1"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-ink shadow-glow">
                <Icon className="h-5 w-5" />
              </span>
            </button>
          );
        }
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn('flex flex-col items-center gap-1 rounded-xl px-3 py-1.5', active ? 'text-brand' : 'text-faint')}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
