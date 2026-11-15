'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatINR, rupeesInWords } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { paiseOf } from '@/components/fees';
import { studentName } from '@/components/students';

interface Receipt {
  id: string; receiptNo: string; paymentDate: string; amount: string; paymentMode: string; referenceNo: string | null; chequeDate: string | null; bankName: string | null;
  payerName: string; status: string; cancelledReason: string | null; notes: string | null; createdAt: string;
  institution: string; institutionLocal: string | null; cashierName: string | null; className: string | null; balanceAfter: string;
  student: { id: string; firstName: string; lastName: string | null; admissionNo: string; campus: { name: string; code: string; address: string | null; city: string | null; phone: string | null } };
  allocations: { id: string; amount: string; invoice: { invoiceNo: string; description: string }; item: { feeHead: { name: string; code: string } } }[];
}

/** A printable fee receipt (A5 on paper; the menu and buttons are hidden when printing). */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const day = useDay();
  const [r, setR] = useState<Receipt | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<Receipt>(`/fees/payments/${id}`).then(setR).catch(() => setMissing(true)); }, [id]);

  if (missing) return <EmptyState icon="receipt" title={t('fee.rc.notFound')} />;
  if (!r) return <SkeletonRows rows={6} />;
  const c = r.student.campus;
  const lines = r.allocations.reduce<{ key: string; head: string; bill: string; paise: number }[]>((acc, a) => {
    const key = `${a.invoice.invoiceNo}|${a.item.feeHead.code}`;
    const ex = acc.find((x) => x.key === key);
    if (ex) ex.paise += paiseOf(a.amount);
    else acc.push({ key, head: a.item.feeHead.name, bill: `${a.invoice.description} · ${a.invoice.invoiceNo}`, paise: paiseOf(a.amount) });
    return acc;
  }, []);

  return (
    <div className="receipt-page">
      <div className="receipt-tools no-print">
        <Link href={`/students/${r.student.id}`} className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {studentName(r.student)}</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="receipt" size={16} /> {t('fee.rc.print')}</button>
      </div>

      <article className={`receipt ${r.status !== 'SUCCESS' ? 'void' : ''}`} aria-label={`${t('fee.rc.title')} ${r.receiptNo}`}>
        {r.status !== 'SUCCESS' && <div className="receipt-stamp" aria-hidden>{t(`status.${r.status}` as MessageKey)}</div>}
        <header className="receipt-head">
          <div>
            <h1>{r.institution}</h1>
            {r.institutionLocal && <p lang="kn">{r.institutionLocal}</p>}
            <p className="muted small">{c.name}{c.address ? ` · ${c.address}` : ''}{c.city ? `, ${c.city}` : ''}{c.phone ? ` · ${c.phone}` : ''}</p>
          </div>
          <div className="receipt-title">
            <span>{t('fee.rc.title')}</span>
            <strong className="mono">{r.receiptNo}</strong>
            <span className="muted small">{day(r.paymentDate)}</span>
          </div>
        </header>

        <dl className="receipt-who">
          <div><dt>{t('fee.rc.receivedFrom')}</dt><dd>{r.payerName}</dd></div>
          <div><dt>{t('stu.col.student')}</dt><dd>{studentName(r.student)} <span className="mono muted">({r.student.admissionNo})</span></dd></div>
          {r.className && <div><dt>{t('stu.col.class')}</dt><dd>{r.className}</dd></div>}
          <div><dt>{t('fee.col.mode')}</dt><dd>{t(`fee.mode.${r.paymentMode}` as MessageKey)}{r.referenceNo ? ` · ${r.referenceNo}` : ''}{r.bankName ? ` · ${r.bankName}` : ''}{r.chequeDate ? ` · ${day(r.chequeDate)}` : ''}</dd></div>
        </dl>

        <table className="receipt-lines">
          <caption className="sr-only">{t('fee.rc.towards')}</caption>
          <thead><tr><th scope="col">{t('fee.rc.towards')}</th><th scope="col" className="num">{t('fee.acct.amount')}</th></tr></thead>
          <tbody>
            {lines.map((l) => <tr key={l.key}><td><strong>{l.head}</strong><span className="sub-line muted small">{l.bill}</span></td><td className="num">{formatINR(l.paise, { paise: l.paise % 100 !== 0 })}</td></tr>)}
          </tbody>
          <tfoot>
            <tr><th scope="row">{t('fee.rc.total')}</th><td className="num">{formatINR(paiseOf(r.amount), { paise: true })}</td></tr>
          </tfoot>
        </table>
        <p className="receipt-words">{rupeesInWords(paiseOf(r.amount))}</p>

        <footer className="receipt-foot">
          <span className="muted small">{t('fee.rc.balance', { v: formatINR(paiseOf(r.balanceAfter)) })}</span>
          {r.status !== 'SUCCESS' && <span className="small">{t('fee.rc.voidReason', { reason: r.cancelledReason ?? '' })}</span>}
          <span className="receipt-sign">{r.cashierName ?? ''}<span className="muted small">{t('fee.rc.receivedBy')}</span></span>
        </footer>
        <p className="receipt-note muted small">{t('fee.rc.note')}</p>
      </article>
    </div>
  );
}
