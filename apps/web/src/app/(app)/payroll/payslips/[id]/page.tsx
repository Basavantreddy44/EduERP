'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatINR, toPaise } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useMonthLabel } from '@/components/payroll';
import { DocLogo } from '@/components/DocLogo';

interface Line { name: string; amount: string }
interface Slip {
  id: string; runNo: string; month: number; year: number; status: string; isReleased: boolean; paidOn: string | null; institution: string; campus: string; campusAddress: string | null;
  employee: { name: string; code: string; designation: string | null; joiningDate: string; panLast4: string | null; uanNo: string | null; pfNo: string | null; esiNo: string | null };
  bank: string | null; monthDays: number; employedDays: number; lopDays: number; paidDays: number;
  earnings: Line[]; deductions: Line[]; employer: Line[]; gross: string; deductionsTotal: string; employerTotal: string; net: string;
  tax: { projectedTaxable: string; yearTax: string; deductedBefore: string; deductedTotal: string };
}
const inr = (v: string) => formatINR(toPaise(v), { paise: true });

/** A payslip, ready to print or save as PDF from the browser. */
export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const label = useMonthLabel();
  const [s, setS] = useState<Slip | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<Slip>(`/payroll/payslips/${id}`).then(setS).catch(() => setMissing(true)); }, [id]);
  if (missing) return <EmptyState icon="receipt" title={t('pay.slip.notFound')} action={<Link href="/payroll/my-payslips" className="btn">{t('nav.payMine')}</Link>} />;
  if (!s) return <SkeletonRows rows={6} />;
  const d = (x: string | null) => (x ? new Date(`${x}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const rows = Math.max(s.earnings.length, s.deductions.length);
  return (
    <div className="receipt-page payslip-page">
      <div className="receipt-tools no-print">
        <button type="button" className="back-link btn-link" onClick={() => history.back()}><Icon name="chevronRight" size={16} className="flip" /> {t('pay.back')}</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="receipt" size={16} /> {t('pay.slip.print')}</button>
      </div>
      <article className={`receipt payslip ${s.isReleased ? '' : 'void'}`} aria-label={t('pay.slip.title', { m: label(s.month, s.year) })}>
        {!s.isReleased && <div className="receipt-stamp" aria-hidden>{t('pay.slip.draft')}</div>}
        <header className="receipt-head">
          <div className="doc-brand">
            <DocLogo />
            <div>
              <h1>{s.institution}</h1>
              <p className="muted small">{s.campus}{s.campusAddress ? ` · ${s.campusAddress}` : ''}</p>
            </div>
          </div>
          <div className="receipt-title">
            <span>{t('pay.slip.heading')}</span>
            <strong>{label(s.month, s.year)}</strong>
            <span className="muted small mono">{s.runNo}</span>
          </div>
        </header>
        <dl className="receipt-who payslip-who">
          <div><dt>{t('pay.name')}</dt><dd>{s.employee.name} <span className="mono muted">({s.employee.code})</span></dd></div>
          <div><dt>{t('pay.slip.designation')}</dt><dd>{s.employee.designation ?? '—'}</dd></div>
          <div><dt>{t('pay.slip.joined')}</dt><dd>{d(s.employee.joiningDate)}</dd></div>
          <div><dt>{t('pay.slip.pan')}</dt><dd>{s.employee.panLast4 ? `••••${s.employee.panLast4}` : '—'}</dd></div>
          <div><dt>{t('pay.slip.uan')}</dt><dd>{s.employee.uanNo ?? '—'}</dd></div>
          {s.employee.esiNo && <div><dt>{t('pay.slip.esi')}</dt><dd>{s.employee.esiNo}</dd></div>}
          <div><dt>{t('pay.slip.days')}</dt><dd>{t('pay.slip.daysLine', { paid: s.paidDays, of: s.monthDays, lop: s.lopDays })}</dd></div>
          <div><dt>{t('pay.slip.bank')}</dt><dd>{s.bank ?? t('pay.noBank')}</dd></div>
        </dl>
        <table className="receipt-lines payslip-lines">
          <caption className="sr-only">{t('pay.slip.title', { m: label(s.month, s.year) })}</caption>
          <thead><tr><th scope="col">{t('pay.earnings')}</th><th scope="col" className="num">{t('pay.amount')}</th><th scope="col">{t('pay.deductions')}</th><th scope="col" className="num">{t('pay.amount')}</th></tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td>{s.earnings[i]?.name ?? ''}</td><td className="num">{s.earnings[i] ? inr(s.earnings[i].amount) : ''}</td>
                <td>{s.deductions[i]?.name ?? ''}</td><td className="num">{s.deductions[i] ? inr(s.deductions[i].amount) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">{t('pay.slip.grossTotal')}</th><td className="num">{inr(s.gross)}</td><th scope="row">{t('pay.slip.dedTotal')}</th><td className="num">{inr(s.deductionsTotal)}</td></tr></tfoot>
        </table>
        <p className="payslip-net"><span>{t('pay.slip.net')}</span><strong>{inr(s.net)}</strong></p>
        <div className="payslip-notes">
          {s.employer.length > 0 && <p className="muted small">{t('pay.slip.employer', { list: s.employer.map((e) => `${e.name} ${inr(e.amount)}`).join(' · ') })}</p>}
          <p className="muted small">{t('pay.slip.taxLine', { taxable: inr(s.tax.projectedTaxable), tax: inr(s.tax.yearTax), done: inr(s.tax.deductedTotal) })}</p>
          {s.paidOn && <p className="muted small">{t('pay.slip.paidOn', { d: d(s.paidOn) })}</p>}
        </div>
        <p className="receipt-note muted small">{t('pay.slip.computer')}</p>
      </article>
    </div>
  );
}
