import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-sky-500', 'bg-violet-500', 'bg-teal-500', 'bg-orange-500',
];

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizes = {
    xs: 'h-5 w-5 text-[9px]',
    sm: 'h-7 w-7 text-[11px]',
    md: 'h-9 w-9 text-xs',
    lg: 'h-12 w-12 text-sm',
    xl: 'h-20 w-20 text-xl',
  };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ''}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-surface', sizes[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface',
        colorFor(name ?? '?'),
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}

export function AvatarStack({ people, max = 4 }: { people: Array<{ id: number; full_name: string; avatar_url?: string | null }>; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.full_name} src={p.avatar_url} size="sm" />
      ))}
      {rest > 0 && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-line text-[11px] font-medium text-muted ring-2 ring-surface">
          +{rest}
        </div>
      )}
    </div>
  );
}
