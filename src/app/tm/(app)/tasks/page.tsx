'use client';

import { Suspense, useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/tm/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { TaskListView } from '@/components/tm/TaskListView';
import { TaskFormModal } from '@/components/tm/TaskFormModal';

const TABS = [
  { id: 'my', label: 'My Tasks' },
  { id: 'created', label: 'Created by Me' },
  { id: 'personal', label: 'Personal' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

function TasksInner() {
  const [tab, setTab] = useState('my');
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="Everything assigned to you, created by you, or personal."
        actions={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New Task</Button>}
      />
      <div className="px-4 pt-4 sm:px-6">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      <TaskListView view={tab} />
      <TaskFormModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksInner />
    </Suspense>
  );
}
