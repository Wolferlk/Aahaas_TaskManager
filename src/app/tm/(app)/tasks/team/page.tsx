'use client';

import { Suspense, useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/tm/PageHeader';
import { Button } from '@/components/ui/Button';
import { TaskListView } from '@/components/tm/TaskListView';
import { TaskFormModal } from '@/components/tm/TaskFormModal';

function TeamTasksInner() {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Team Tasks"
        subtitle="Work assigned across the teams you lead."
        actions={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New Task</Button>}
      />
      <TaskListView view="team" />
      <TaskFormModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

export default function TeamTasksPage() {
  return (
    <Suspense fallback={null}>
      <TeamTasksInner />
    </Suspense>
  );
}
