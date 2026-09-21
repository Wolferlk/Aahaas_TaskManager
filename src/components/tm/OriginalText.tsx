'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The text a person actually typed or pasted when recording a day — free-form
 * notes, or the rows of a tracker table — shown exactly as entered.
 *
 * AI rewrites that text into items and a summary, so without this a reader
 * could only ever see the rewrite. Who may see it is decided by the API that
 * returned the update (the author, their Leader, Managers); this component
 * only renders what it is given.
 */
export function OriginalText({ text, className }: { text: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return null;

  const lines = text.trim().split('\n').length;

  return (
    <div className={cn('mt-3', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focus-ring flex items-center gap-1.5 rounded text-xs font-medium text-muted hover:text-ink"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FileText className="h-3.5 w-3.5" />
        {open ? 'Hide original text' : `Original text as entered · ${lines} line${lines === 1 ? '' : 's'}`}
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-line/10 p-3 font-mono text-xs leading-relaxed text-muted">
          {text.trim()}
        </pre>
      )}
    </div>
  );
}
