'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Two-step delete for a record inside a form.
 *
 * The first click only arms the button; the second one performs the delete. It
 * keeps a destructive action a deliberate act without throwing another modal on
 * top of the one the person is already in.
 */
export function DeleteButton({
  label = 'Delete',
  question,
  onDelete,
  disabled,
}: {
  label?: string;
  /** Shown once the button is armed, e.g. "Delete Accounts permanently?" */
  question: string;
  onDelete: () => Promise<void>;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!armed) {
    return (
      <Button type="button" variant="ghost" disabled={disabled} onClick={() => setArmed(true)}>
        <Trash2 className="h-4 w-4 text-red-500" /> {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{question}</span>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => setArmed(false)}>
        No
      </Button>
      <Button
        type="button"
        variant="danger"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onDelete();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        Yes, delete
      </Button>
    </div>
  );
}
