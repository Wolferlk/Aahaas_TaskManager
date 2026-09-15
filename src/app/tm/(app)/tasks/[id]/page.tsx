'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { TaskDetailContent } from '@/components/tm/TaskDrawer';

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const taskId = Number(params?.id);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <AlertCircle className="h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-ink">Task not found</p>
        <Link href="/tm/tasks" className="mt-2 text-sm font-medium text-brand hover:underline">
          Back to tasks
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <TaskDetailContent taskId={taskId} onChanged={() => router.refresh()} />
    </div>
  );
}
