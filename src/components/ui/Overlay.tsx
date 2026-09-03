'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

export function Modal({
  open,
  onClose,
  children,
  className,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  useLockBody(open);
  useEscape(open, onClose);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-up bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={cn(
          'relative z-10 max-h-[90vh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-2xl border border-line bg-elevated shadow-pop',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  children,
  className,
  title,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  width?: string;
}) {
  useLockBody(open);
  useEscape(open, onClose);
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-up bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className={cn(
          'relative z-10 h-full w-full animate-slide-in overflow-y-auto border-l border-line bg-elevated shadow-pop',
          width,
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function OverlayHeader({
  title,
  subtitle,
  onClose,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-elevated/95 px-6 py-4 backdrop-blur">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-ink">{title}</div>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <button
          onClick={onClose}
          className="focus-ring rounded-lg p-2 text-muted hover:bg-line/40 hover:text-ink"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
