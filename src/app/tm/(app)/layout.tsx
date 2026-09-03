import { Providers } from '@/components/tm/Providers';
import { AppShell } from '@/components/tm/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
