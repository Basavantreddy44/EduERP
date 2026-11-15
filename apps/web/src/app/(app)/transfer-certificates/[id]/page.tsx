'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { studentName } from '@/components/students';

interface Tc {
  id: string; tcNo: string; issueDate: string; leavingDate: string; lastClass: string | null; lastYear: string | null; reason: string; conduct: string; remarks: string | null;
  duesCleared: boolean; status: string; institution: string; institutionLocal: string | null; issuedBy: string | null;
  student: {
    id: string; firstName: string; lastName: string | null; nameLocal: string | null; admissionNo: string; dob: string; gender: string; category: string | null; religion: string | null;
    motherTongue: string | null; admissionDate: string; apaarId: string | null;
    campus: { name: string; address: string | null; city: string | null; phone: string | null };
    guardians: { relation: string; guardian: { name: string } }[];
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const under100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const yearWords = (y: number) => {
  const th = Math.floor(y / 1000);
  const rest = y % 1000;
  const h = Math.floor(rest / 100);
  const r = rest % 100;
  return [th ? `${ONES[th]} Thousand` : '', h ? `${ONES[h]} Hundred` : '', r ? under100(r) : ''].filter(Boolean).join(' ');
};
/** Date of birth in words, as written on a TC: "Fifteenth March Two Thousand Eighteen" style (cardinal day). */
const dateInWords = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${under100(d)} ${MONTHS[m - 1]} ${yearWords(y)}`;
};

/** A printable Transfer Certificate (A4; the menu and buttons are hidden when printing). */
export default function TransferCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const day = useDay();
  const [tc, setTc] = useState<Tc | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<Tc>(`/transfer-certificates/${id}`).then(setTc).catch(() => setMissing(true)); }, [id]);

  if (missing) return <EmptyState icon="file" title={t('stu.tc.notFound')} />;
  if (!tc) return <SkeletonRows rows={8} />;
  const s = tc.student;
  const c = s.campus;
  const parent = (rel: string) => s.guardians.find((g) => g.relation === rel)?.guardian.name ?? null;
  const rows: [MessageKey, ReactNode][] = [
    ['stu.tc.f.name', <>{studentName(s)}{s.nameLocal && <span className="sub-line" lang="kn">{s.nameLocal}</span>}</>],
    ['stu.tc.f.father', parent('FATHER') ?? '—'],
    ['stu.tc.f.mother', parent('MOTHER') ?? '—'],
    ...(parent('GUARDIAN') ? [['stu.tc.f.guardian', parent('GUARDIAN')] as [MessageKey, ReactNode]] : []),
    ['stu.tc.f.dob', <>{day(s.dob)}<span className="sub-line muted">{dateInWords(s.dob)}</span></>],
    ['stu.tc.f.gender', t(`gender.${s.gender}` as MessageKey)],
    ['stu.tc.f.category', [s.category ? t(`category.${s.category}` as MessageKey) : null, s.religion].filter(Boolean).join(' · ') || '—'],
    ['stu.tc.f.motherTongue', s.motherTongue ?? '—'],
    ['stu.tc.f.admission', <><span className="mono">{s.admissionNo}</span> · {day(s.admissionDate)}</>],
    ['stu.tc.f.lastClass', tc.lastClass ? `${tc.lastClass}${tc.lastYear ? ` · ${tc.lastYear}` : ''}` : '—'],
    ['stu.tc.f.leaving', day(tc.leavingDate)],
    ['stu.tc.f.reason', tc.reason],
    ['stu.tc.f.fees', tc.duesCleared ? t('stu.tc.feesPaid') : '—'],
    ['stu.tc.f.conduct', t(`stu.tc.conduct.${tc.conduct}` as MessageKey)],
    ...(s.apaarId ? [['stu.tc.f.apaar', <span key="a" className="mono">{s.apaarId}</span>] as [MessageKey, ReactNode]] : []),
    ...(tc.remarks ? [['stu.tc.f.remarks', tc.remarks] as [MessageKey, ReactNode]] : []),
  ];

  return (
    <div className="receipt-page tc-page">
      <div className="receipt-tools no-print">
        <Link href={`/students/${s.id}`} className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {studentName(s)}</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="file" size={16} /> {t('stu.tc.print')}</button>
      </div>

      <article className={`receipt tc ${tc.status !== 'ISSUED' ? 'void' : ''}`} aria-label={`${t('stu.tc.title')} ${tc.tcNo}`}>
        {tc.status !== 'ISSUED' && <div className="receipt-stamp" aria-hidden>{t(`status.${tc.status}` as MessageKey)}</div>}
        <header className="tc-head">
          <h1>{tc.institution}</h1>
          {tc.institutionLocal && <p lang="kn" className="tc-local">{tc.institutionLocal}</p>}
          <p className="muted small">{c.name}{c.address ? ` · ${c.address}` : ''}{c.city ? `, ${c.city}` : ''}{c.phone ? ` · ${c.phone}` : ''}</p>
          <p className="tc-title">{t('stu.tc.title')}</p>
          <div className="tc-meta">
            <span>{t('stu.tc.no')} <strong className="mono">{tc.tcNo}</strong></span>
            <span>{t('stu.tc.issued')} <strong>{day(tc.issueDate)}</strong></span>
          </div>
        </header>

        <ol className="tc-fields">
          {rows.map(([k, v]) => <li key={k}><span className="tc-label">{t(k)}</span><span className="tc-value">{v}</span></li>)}
        </ol>

        <p className="tc-cert">{t('stu.tc.certify', { name: studentName(s) })}</p>

        <footer className="tc-foot">
          <span className="receipt-sign">{tc.issuedBy ?? ''}<span className="muted small">{t('stu.tc.preparedBy')}</span></span>
          <span className="receipt-sign"><span className="tc-sign-space" aria-hidden /><span className="muted small">{t('stu.tc.principal')}</span></span>
        </footer>
        <p className="receipt-note muted small">{t('stu.tc.note')}</p>
      </article>
    </div>
  );
}
