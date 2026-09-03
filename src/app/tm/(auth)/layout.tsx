import { Providers } from '@/components/tm/Providers';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute -bottom-40 right-1/4 h-96 w-96 rounded-full bg-brand/10 blur-3xl" />
        </div>
        <div className="relative w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-brand-ink shadow-glow">
              A
            </div>
            <div>
              <p className="text-lg font-semibold text-ink">Aahaas Task Management</p>
              <p className="text-sm text-muted">Internal productivity platform</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </Providers>
  );
}
