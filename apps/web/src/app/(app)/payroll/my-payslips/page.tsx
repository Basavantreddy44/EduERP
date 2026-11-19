'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { rupees } from '@/components/accounts';
import { useMonthLabel } from '@/components/payroll';

interface Data { employee: { name: string; code: string } | null; payslips: { id: string; month: number; year: number; paidOn: string | null; gross: string; deductions: string; net: string; paidDays: number; lopDays: number }[] }

/** My payslips: every released payslip of the signed-in staff member. */
export default function MyPayslipsPage() {
  const { t, locale } = useI18n();
  const label = useMonthLabel();
  const [v, setV] = useState<Data | null>(null);
  useEffect(() => { api<Data>('/payroll/my-payslips').then(setV).catch(() => setV({ employee: null, payslips: [] })); }, []);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader eyebrow={t('nav.payroll')} title={t('pay.mine.title')} description={v?.employee ? `${v.employee.name} · ${v.employee.code}` : t('pay.mine.desc')} />
      {!v ? <SkeletonRows rows={4} /> : !v.employee ? <EmptyState icon="users" title={t('pay.mine.noStaff')} /> : !v.payslips.length ? <EmptyState icon="receipt" title={t('pay.mine.none')} text={t('pay.mine.noneHint')} /> : (
        <ul className="pay-mine">{v.payslips.map((p) => (
          <li key={p.id} className="card">
            <span><strong>{label(p.month, p.year)}</strong><span className="sub-line muted small">{p.paidOn ? t('pay.mine.paid', { d: d(p.paidOn) }) : ''}{p.lopDays ? ` · ${t('pay.mine.lop', { n: p.lopDays })}` : ''}</span></span>
            <span className="pay-mine-amt"><span className="muted small">{t('pay.net')}</span><strong>{rupees(p.net, { paise: true })}</strong></span>
            <Link className="btn btn-sm" href={`/payroll/payslips/${p.id}`}>{t('pay.payslip')}</Link>
          </li>
        ))}</ul>
      )}
    </>
  );
}
