'use client';

import { forwardRef, useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'focus-ring h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-faint transition-colors',
        'hover:border-faint/60',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/**
 * A password box with a reveal toggle. Typing a password you cannot see is
 * the single biggest source of "my password is wrong" support traffic, so
 * every password field in the app uses this rather than a bare `type=password`.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, id, ...props }, ref) => {
  const [reveal, setReveal] = useState(false);
  const fallbackId = useId();

  return (
    <div className="relative">
      <Input
        ref={ref}
        id={id ?? fallbackId}
        type={reveal ? 'text' : 'password'}
        className={cn('pr-11', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setReveal((v) => !v)}
        className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-faint transition-colors hover:text-ink"
        aria-label={reveal ? 'Hide password' : 'Show password'}
        title={reveal ? 'Hide password' : 'Show password'}
      >
        {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'focus-ring w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint transition-colors',
        'hover:border-faint/60',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'focus-ring h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors',
        'hover:border-faint/60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-medium text-ink', className)} {...props} />;
}

export function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs text-red-500">{children}</p>;
}

export function FieldHint({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs text-muted">{children}</p>;
}
