'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/tm/PageHeader';
import { TaskListView } from '@/components/tm/TaskListView';

function Inner() {
  return (
    <>
      <PageHeader title="Created by Me" subtitle="Tasks you created for yourself or others" />
      <TaskListView view="created" />
    </>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
