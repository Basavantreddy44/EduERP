'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EmptyState, SkeletonRows } from '@/components/ui';

/** HR → My profile: opens the signed-in staff member's own profile. */
export default function MyProfilePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [none, setNone] = useState(false);
  useEffect(() => { api<{ employeeId: string | null }>('/hr/me').then((r) => (r.employeeId ? router.replace(`/hr/staff/${r.employeeId}`) : setNone(true))).catch(() => setNone(true)); }, [router]);
  return none ? <EmptyState icon="users" title={t('hr.noStaffRecord')} text={t('hr.noStaffRecordHint')} /> : <SkeletonRows rows={4} />;
}
