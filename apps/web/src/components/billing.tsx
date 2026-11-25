'use client';

import { formatINR, rupeesInWords } from '@eduerp/shared';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { StatusBadge } from '@/components/ui';

/** Phase 22 SaaS billing: shapes and pieces shared by the platform console and the institution's bills page. */
export interface SaasInvoice {
  id: string; tenantId: string; tenantName: string | null; invoiceNo: string; kind: 'FIRST' | 'RENEWAL'; planName: string; edition: string; billingCycle: 'MONTHLY' | 'YEARLY';
  periodStart: string; periodEnd: string; studentCount: number; rate: number; taxable: number; gstRate: number; cgst: number; sgst: number; igst: number; total: number;
  paid: number; balance: number; issueDate: string; dueDate: string; status: string; overdue: boolean; cancelReason: string | null;
  buyer: { name: string; address: string; state: string | null; gstin: string | null };
  seller: { name: string; address: string; state: string; gstin: string | null; sac: string | null; bankName: string | null; bankAccountName: string | null; bankAccountNo: string | null; bankIfsc: string | null; upiId: string | null };
}
export interface SaasPayment { id: string; invoiceId: string; invoiceNo: string | null; paidOn: string; amount: number; mode: string; reference: string | null; note: string | null; status: string; reverseReason: string | null }
export interface SaasInvoiceDetail extends SaasInvoice { payments: SaasPayment[] }
export interface StatementLine { date: string; kind: 'INVOICE' | 'CANCELLED' | 'PAYMENT' | 'REVERSAL'; ref: string; debit: number; credit: number; balance: number }
export interface BillingOverview {
  subscription: null | {
    id: string; plan: { id: string; name: string; code: string; monthly: number | null; yearly: number | null }; status: string; billingCycle: 'MONTHLY' | 'YEARLY'; nextCycle: 'MONTHLY' | 'YEARLY' | null;
    rate: number; studentCount: number; amount: number; startDate: string; endDate: string;
  };
  activeStudents: number;
  account: { status: string; graceDays: number; overdue: null | { kind: 'INVOICE' | 'TRIAL'; invoiceId: string | null; invoiceNo: string | null; amount: number; dueDate: string; lastDay: string }; upcoming: null | { invoiceId: string; invoiceNo: string; amount: number; dueDate: string } };
  balance: number;
  invoices: SaasInvoice[];
  payments: SaasPayment[];
  statement: StatementLine[];
  payTo: { name: string; bankName: string | null; bankAccountName: string | null; bankAccountNo: string | null; bankIfsc: string | null; upiId: string | null };
}

/** Rupees (₹1,234.50) from a rupee amount. */
export const inr = (v: number, paise = true) => formatINR(Math.round(v * 100), { paise });

export function useDayText() {
  const { locale } = useI18n();
  return (x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
}

/** "Unpaid", "Overdue", "Paid"… with the right colour. */
export function InvoiceStatus({ inv }: { inv: Pick<SaasInvoice, 'status' | 'overdue'> }) {
  const { t } = useI18n();
  if (inv.overdue) return <span className="pill pill-bad"><span className="pill-dot" />{t('bill.st.OVERDUE')}</span>;
  return <StatusBadge status={inv.status} label={t(`bill.st.${inv.status}` as MessageKey)} />;
}

/** The printable tax invoice (A4; menus and buttons are hidden when printing). */
export function SaasInvoiceDoc({ inv }: { inv: SaasInvoiceDetail }) {
  const { t } = useI18n();
  const day = useDayText();
  const s = inv.seller;
  const intra = inv.igst === 0 && inv.cgst + inv.sgst > 0;
  const payments = inv.payments.filter((p) => p.status === 'RECORDED');
  return (
    <article className={`receipt saas-invoice ${inv.status === 'CANCELLED' ? 'void' : ''}`} aria-label={`${t('bill.taxInvoice')} ${inv.invoiceNo}`}>
      {inv.status === 'CANCELLED' && <div className="receipt-stamp" aria-hidden>{t('bill.st.CANCELLED')}</div>}
      <header className="receipt-head">
        <div>
          <h1>{s.name}</h1>
          <p className="muted small">{s.address}{s.state ? `, ${s.state}` : ''}</p>
          {s.gstin && <p className="small">GSTIN <span className="mono">{s.gstin}</span></p>}
        </div>
        <div className="receipt-title">
          <span>{t('bill.taxInvoice')}</span>
          <strong className="mono">{inv.invoiceNo}</strong>
          {inv.status === 'PAID' && <span className="saas-paid">{t('bill.st.PAID')}</span>}
          <span className="muted small">{t('bill.issued')} {day(inv.issueDate)}</span>
          <span className="small"><strong>{t('bill.dueOn')} {day(inv.dueDate)}</strong></span>
        </div>
      </header>

      <dl className="receipt-who">
        <div><dt>{t('bill.billTo')}</dt><dd>{inv.buyer.name}<span className="sub-line muted small">{inv.buyer.address || '—'}</span></dd></div>
        <div><dt>{t('bill.buyerGst')}</dt><dd>{inv.buyer.gstin ? <span className="mono">{inv.buyer.gstin}</span> : t('bill.unregistered')}<span className="sub-line muted small">{t('bill.placeOfSupply')}: {inv.buyer.state ?? s.state}</span></dd></div>
      </dl>

      <table className="receipt-lines">
        <caption className="sr-only">{t('bill.lines')}</caption>
        <thead><tr><th scope="col">{t('bill.description')}</th><th scope="col" className="num">{t('bill.students')}</th><th scope="col" className="num">{t('bill.rate')}</th><th scope="col" className="num">{t('fee.acct.amount')}</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <strong>{t('bill.lineText', { plan: inv.planName })}</strong>
              <span className="sub-line muted small">{t(inv.billingCycle === 'YEARLY' ? 'bill.yearly' : 'bill.monthly')} · {day(inv.periodStart)} – {day(inv.periodEnd)}{s.sac ? ` · SAC ${s.sac}` : ''}</span>
            </td>
            <td className="num">{inv.studentCount}</td>
            <td className="num">{inr(inv.rate)}</td>
            <td className="num">{inr(inv.taxable)}</td>
          </tr>
        </tbody>
        <tfoot className="saas-totals">
          <tr><th scope="row" colSpan={3}>{t('bill.taxable')}</th><td className="num">{inr(inv.taxable)}</td></tr>
          {intra ? (
            <>
              <tr><th scope="row" colSpan={3}>CGST @ {inv.gstRate / 2}%</th><td className="num">{inr(inv.cgst)}</td></tr>
              <tr><th scope="row" colSpan={3}>SGST @ {inv.gstRate / 2}%</th><td className="num">{inr(inv.sgst)}</td></tr>
            </>
          ) : (
            <tr><th scope="row" colSpan={3}>IGST @ {inv.gstRate}%</th><td className="num">{inr(inv.igst)}</td></tr>
          )}
          <tr className="grand"><th scope="row" colSpan={3}>{t('bill.total')}</th><td className="num">{inr(inv.total)}</td></tr>
        </tfoot>
      </table>
      <p className="receipt-words">{rupeesInWords(Math.round(inv.total * 100))}</p>

      {payments.length > 0 && (
        <p className="small">
          <strong>{t('bill.received')}:</strong> {payments.map((p) => `${inr(p.amount)} · ${day(p.paidOn)}${p.reference ? ` · ${p.reference}` : ''}`).join('; ')}
          {inv.balance > 0 && <> · <strong>{t('bill.balanceDue')}: {inr(inv.balance)}</strong></>}
        </p>
      )}
      {inv.status === 'CANCELLED' && <p className="small">{t('bill.cancelledBecause', { reason: inv.cancelReason ?? '' })}</p>}

      <footer className="saas-pay">
        <div>
          <h2>{t('bill.howToPay')}</h2>
          {s.bankAccountNo ? (
            <dl className="saas-bank">
              <div><dt>{t('bill.accountName')}</dt><dd>{s.bankAccountName ?? s.name}</dd></div>
              <div><dt>{t('bill.accountNo')}</dt><dd className="mono">{s.bankAccountNo}</dd></div>
              <div><dt>IFSC</dt><dd className="mono">{s.bankIfsc ?? '—'}</dd></div>
              <div><dt>{t('bill.bank')}</dt><dd>{s.bankName ?? '—'}</dd></div>
              {s.upiId && <div><dt>UPI</dt><dd className="mono">{s.upiId}</dd></div>}
            </dl>
          ) : <p className="muted small">{t('bill.noBankYet')}</p>}
          <p className="muted small">{t('bill.quoteNumber', { no: inv.invoiceNo })}</p>
        </div>
        <span className="receipt-sign">{s.name}<span className="muted small">{t('bill.authorised')}</span></span>
      </footer>
      <p className="receipt-note muted small">{t('bill.computerMade')}</p>
    </article>
  );
}
