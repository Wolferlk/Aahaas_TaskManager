'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { PageHeader, PageBody } from '@/components/tm/PageHeader';
import { EmptyState } from '@/components/ui/Misc';
import { MemberWorkspace } from '@/components/tm/MemberWorkspace';
import { useSession } from '@/hooks/useSession';

function MembersInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, loading } = useSession();

  const raw = Number(sp.get('user'));
  const selectedId = Number.isFinite(raw) && raw > 0 ? raw : null;

  // The selected person lives in the URL so a supervisor can link a colleague
  // straight to the person they are talking about.
  const select = useCallback(
    (id: number) => {
      const next = new URLSearchParams(sp.toString());
      next.set('user', String(id));
      router.replace(`/tm/members?${next}`, { scroll: false });
    },
    [router, sp],
  );

  if (loading) return null;

  if (user && user.role === 'EMPLOYEE') {
    return (
      <>
        <PageHeader title="My People" />
        <PageBody>
          <EmptyState
            icon={ShieldAlert}
            title="This page is for Leaders and Managers"
            description="You can see your own work under My Tasks and Daily Updates."
          />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My People"
        subtitle="Every person you lead — their tasks, status, daily updates and activity, in one place."
      />
      <PageBody>
        <MemberWorkspace selectedId={selectedId} onSelect={select} />
      </PageBody>
    </>
  );
}

export default function MembersPage() {
  return (
    <Suspense fallback={null}>
      <MembersInner />
    </Suspense>
  );
}
