'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { CommandPalette } from './CommandPalette';
import { TaskFormModal } from './TaskFormModal';
import { useSession } from '@/hooks/useSession';
import { Spinner } from '@/components/ui/Misc';
import { Logo } from './Logo';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, validating } = useSession();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    // Only bounce to login once /me has actually settled - redirecting while a
    // revalidation is still in flight would act on a stale logged-out cache.
    if (!loading && !validating && !user) router.replace('/tm/login');
  }, [loading, validating, user, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Render the shell whenever we have a user, even mid-revalidation, so the periodic
  // /me refresh never blanks the app.
  if (!user) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-bg">
        <Logo size="lg" priority className="animate-pulse" />
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setPaletteOpen(true)} onAdd={() => setAddOpen(true)} />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
      </div>
      <MobileNav onAdd={() => setAddOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onCreateTask={() => setAddOpen(true)} />
      <TaskFormModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
