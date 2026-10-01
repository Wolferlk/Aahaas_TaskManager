'use client';

import { Suspense, useState } from 'react';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { PageHeader } from '@/components/tm/PageHeader';
import { Button } from '@/components/ui/Button';
import { TaskListView } from '@/components/tm/TaskListView';
import { TaskFormModal } from '@/components/tm/TaskFormModal';
import { MonthlyExportModal } from '@/components/tm/MonthlyExportModal';
import { useSession } from '@/hooks/useSession';

function TeamTasksInner() {
  const [addOpen, setAddOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Team Tasks"
        subtitle="Everything your people are working on."
        actions={
          <>
            {can('tm.report.export') && (
              <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)}>
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Monthly Excel
              </Button>
            )}
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> New Task</Button>
          </>
        }
      />
      <TaskListView view="team" />
      <TaskFormModal open={addOpen} onClose={() => setAddOpen(false)} />
      <MonthlyExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
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
