'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/tm/PageHeader';
import { TaskListView } from '@/components/tm/TaskListView';

function Inner() {
  return (
    <>
      <PageHeader title="Completed" subtitle="Finished work" />
      <TaskListView view="completed" />
    </>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
