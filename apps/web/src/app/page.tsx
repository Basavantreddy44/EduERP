'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { homeFor } from '@/lib/routes';

export default function Index() {
  const { loading, session } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(session ? homeFor(session) : '/login');
  }, [loading, session, router]);
  return null;
}
