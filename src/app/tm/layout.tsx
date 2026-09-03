import { Providers } from '@/components/tm/Providers';

export default function TmLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
