import Image from 'next/image';
import { cn } from '@/lib/cn';

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 72 } as const;

/**
 * The Aahaas mark. Uses the real brand asset everywhere rather than a
 * letter placeholder, so /tm reads as part of the Operations System.
 */
export function Logo({
  size = 'md',
  className,
  priority,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  priority?: boolean;
}) {
  const px = SIZES[size];
  return (
    <Image
      src="/aahaas-logo.png"
      alt="Aahaas"
      width={px}
      height={px}
      priority={priority}
      className={cn('shrink-0 object-contain', className)}
      style={{ width: px, height: px }}
    />
  );
}

export function LogoLockup({
  size = 'md',
  subtitle = 'Task Management',
  className,
}: {
  size?: keyof typeof SIZES;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Logo size={size} priority />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight text-ink">Aahaas</p>
        {subtitle && <p className="truncate text-xs leading-tight text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
