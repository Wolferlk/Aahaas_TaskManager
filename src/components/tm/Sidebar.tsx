'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, ListChecks, Users, FolderKanban, CalendarClock, BarChart3,
  Trophy, Bell, ShieldCheck, UserCircle, Settings, Building2, UsersRound,
  ClipboardCheck, NotebookPen, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/hooks/useSession';
import { Logo } from './Logo';
import { Avatar } from '@/components/ui/Avatar';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: string;
  managerOnly?: boolean;
  leaderPlus?: boolean;
}

const NAV: NavItem[] = [
  { href: '/tm/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/tm/tasks', label: 'My Tasks', icon: ListChecks, match: '/tm/tasks' },
  { href: '/tm/tasks/team', label: 'Team Tasks', icon: UsersRound, leaderPlus: true },
  { href: '/tm/projects', label: 'Projects', icon: FolderKanban },
  { href: '/tm/daily-updates', label: 'Daily Updates', icon: NotebookPen },
  { href: '/tm/tasks/calendar', label: 'Calendar', icon: CalendarClock },
  { href: '/tm/approvals', label: 'Approvals', icon: ClipboardCheck, leaderPlus: true },
  { href: '/tm/reports', label: 'Reports', icon: BarChart3, leaderPlus: true },
  { href: '/tm/performance', label: 'Performance', icon: ShieldCheck },
  { href: '/tm/rewards', label: 'Rewards', icon: Trophy },
  { href: '/tm/notifications', label: 'Notifications', icon: Bell },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/tm/departments', label: 'Departments', icon: Building2, managerOnly: true },
  { href: '/tm/teams', label: 'Teams', icon: UsersRound, managerOnly: true },
  { href: '/tm/users', label: 'People', icon: Users, managerOnly: true },
  { href: '/tm/admin', label: 'Administration', icon: Settings, managerOnly: true },
];

function isActive(pathname: string, item: NavItem) {
  const match = item.match ?? item.href;
  if (match === '/tm/tasks') return pathname === '/tm/tasks' || (pathname.startsWith('/tm/tasks') && !pathname.includes('/team') && !pathname.includes('/calendar') && !pathname.includes('/board'));
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { user, unreadNotifications } = useSession();
  if (!user) return null;

  const visible = NAV.filter((item) => {
    if (item.leaderPlus && user.role === 'EMPLOYEE') return false;
    return true;
  });
  const adminVisible = user.role === 'MANAGER' ? ADMIN_NAV : [];

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-all duration-200 md:flex',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
    >
      <div className="flex h-16 items-center gap-2.5 px-4">
        <Logo size="sm" priority />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-ink">Aahaas</p>
            <p className="truncate text-xs leading-tight text-muted">Task Management</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {visible.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-line/30 hover:text-ink',
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-brand')} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {item.href === '/tm/notifications' && unreadNotifications > 0 && (
                <span
                  className={cn(
                    'flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white',
                    collapsed ? 'absolute right-1 top-1' : 'ml-auto',
                  )}
                >
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </Link>
          );
        })}

        {adminVisible.length > 0 && (
          <>
            <div className={cn('mt-4 mb-1 px-3', collapsed && 'text-center')}>
              {!collapsed && <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Administration</p>}
            </div>
            {adminVisible.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'focus-ring group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-line/30 hover:text-ink',
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-brand')} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/tm/profile"
          className="focus-ring flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-line/30"
        >
          <Avatar name={user.full_name} src={user.avatar_url} size="sm" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{user.full_name}</p>
              <p className="truncate text-xs text-muted">{user.role[0] + user.role.slice(1).toLowerCase()}</p>
            </div>
          )}
        </Link>
        <button
          onClick={onToggle}
          className="focus-ring mt-1 flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs text-faint hover:bg-line/30 hover:text-muted"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
