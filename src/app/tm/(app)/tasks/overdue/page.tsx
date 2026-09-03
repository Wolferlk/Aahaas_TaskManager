'use client';

import { Suspense } from 'react';
import { PageHeader } from '@/components/tm/PageHeader';
import { TaskListView } from '@/components/tm/TaskListView';

function Inner() {
  return (
    <>
      <PageHeader title="Overdue" subtitle="Tasks past their deadline" />
      <TaskListView view="overdue" />
    </>
  );
}

export default function Page() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
