import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

export default async function TmIndex() {
  const user = await getSessionUser();
  redirect(user ? '/tm/dashboard' : '/tm/login');
}
