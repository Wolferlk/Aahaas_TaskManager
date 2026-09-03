'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/tm/PageHeader';
import { TaskListView } from '@/components/tm/TaskListView';

function Inner() {
  return (
    <>
      <PageHeader title="My Tasks" subtitle="Everything assigned to you" />
      <TaskListView view="my" />
    </>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
