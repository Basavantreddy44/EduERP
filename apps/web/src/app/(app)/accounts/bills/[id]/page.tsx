'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, rupees } from '@/components/accounts';

interface View {
  id: string; internalNo: string; billNo: string; billDate: string; dueDate: string | null; status: string; notes: string | null; cancelReason: string | null; campusId: string;
  vendor: { id: string; name: string; gstin: string | null; stateCode: string; pan: string | null };
  subTotal: string; taxAmount: string; tdsAmount: string; tdsSection: string | null; tdsRate: string | null; total: string; payable: string; paid: string; balance: string; journalEntryNo: string | null;
  items: { lineNo: number; account: string; costCentre: string | null; description: string; quantity: string; rate: string; amount: string; taxRate: string; cgst: string; sgst: string; igst: string; itcClaimable: boolean }[];
  payments: { paymentNo: string; date: string; mode: string; amount: string; isAdjustment: boolean; status: string }[];
}

/** One vendor bill: what was bought, GST and TDS, payments against it, the journal it posted. */
export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api<View>(`/accounts/bills/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const doCancel = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { await api(`/accounts/bills/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); toast(t('ac2.bill.cancelled')); setCancel(false); load(); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="receipt" title={t('ac2.bill.notFound')} action={<Link href="/accounts/bills" className="btn">{t('ac2.bills.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const inter = v.items.some((i) => Number(i.igst) > 0);
  const live = !['CANCELLED', 'REJECTED'].includes(v.status);
  return (
    <>
      <Link href="/accounts/bills" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('ac2.bills.title')}</Link>
      <PageHeader eyebrow={`${v.internalNo} · ${t('ac2.bill.theirNo', { no: v.billNo })}`} title={v.vendor.name}
        actions={<><AccPill status={v.status} />{can(PERMISSIONS.ACC_ENTRY) && live && Number(v.paid) === 0 && <button type="button" className="btn btn-ghost" onClick={() => { setReason(''); setError(null); setCancel(true); }}>{t('ac2.bill.cancel')}</button>}{['APPROVED', 'PARTIAL'].includes(v.status) && can(PERMISSIONS.ACC_ENTRY) && <Link href={`/accounts/payments?vendor=${v.vendor.id}`} className="btn btn-primary"><Icon name="rupee" /> {t('ac2.bill.pay')}</Link>}</>} />
      {v.status === 'PENDING_APPROVAL' && <p className="notice"><Icon name="clock" /> {t('ac2.bill.waiting')}</p>}
      {v.cancelReason && <p className="notice"><Icon name="info" /> {t('ac2.bill.cancelledBecause', { r: v.cancelReason })}</p>}
      <dl className="kv">
        <div><dt>{t('ac2.bill.date')}</dt><dd>{d(v.billDate)}</dd></div>
        <div><dt>{t('ac2.bill.due')}</dt><dd>{d(v.dueDate)}</dd></div>
        <div><dt>GSTIN</dt><dd>{v.vendor.gstin ?? '—'}</dd></div>
        <div><dt>PAN</dt><dd>{v.vendor.pan ?? '—'}</dd></div>
        <div><dt>{t('ac2.bill.journal')}</dt><dd>{v.journalEntryNo ?? <span className="muted">{t('ac2.bill.notPosted')}</span>}</dd></div>
        {v.notes && <div className="kv-wide"><dt>{t('ac2.notes')}</dt><dd>{v.notes}</dd></div>}
      </dl>
      <div className="table-wrap card p12-table">
        <table className="table">
          <thead><tr><th scope="col">{t('ac2.bill.item')}</th><th scope="col">{t('ac2.account')}</th><th scope="col" className="num">{t('ac2.bill.qty')}</th><th scope="col" className="num">{t('ac2.bill.rate')}</th><th scope="col" className="num">{t('ac2.bill.amount')}</th><th scope="col" className="num">{inter ? t('ac2.bill.igst') : t('ac2.bill.cgstSgst')}</th></tr></thead>
          <tbody>
            {v.items.map((i) => (
              <tr key={i.lineNo}>
                <td>{i.description}{i.costCentre && <span className="sub-line muted small">{i.costCentre}</span>}</td>
                <td>{i.account}</td>
                <td className="num">{Number(i.quantity)}</td>
                <td className="num">{rupees(i.rate, { paise: true })}</td>
                <td className="num">{rupees(i.amount, { paise: true })}</td>
                <td className="num">{Number(i.taxRate) > 0 ? <>{inter ? rupees(i.igst, { paise: true }) : `${rupees(i.cgst, { paise: true })} + ${rupees(i.sgst, { paise: true })}`}<span className="sub-line muted small">{Number(i.taxRate)}% · {i.itcClaimable ? t('ac2.bill.claimable') : t('ac2.bill.inCost')}</span></> : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>{t('ac2.bill.subTotal')}</td><td className="num">{rupees(v.subTotal, { paise: true })}</td><td className="num">{rupees(v.taxAmount, { paise: true })}</td></tr>
            <tr><td colSpan={5}>{t('ac2.bill.total')}</td><td className="num">{rupees(v.total, { paise: true })}</td></tr>
            {Number(v.tdsAmount) > 0 && <tr><td colSpan={5}>{t('ac2.bill.tdsLine', { s: v.tdsSection ?? '', r: Number(v.tdsRate) })}</td><td className="num">− {rupees(v.tdsAmount, { paise: true })}</td></tr>}
            <tr><td colSpan={5}><strong>{t('ac2.bill.payable')}</strong></td><td className="num"><strong>{rupees(v.payable, { paise: true })}</strong></td></tr>
          </tfoot>
        </table>
      </div>
      <section className="card p12-block" aria-labelledby="bl-pays">
        <h2 id="bl-pays" className="section-title">{t('ac2.bill.payments')} <span className="muted small">· {t('ac2.bill.balanceIs', { amt: rupees(v.balance, { paise: true }) })}</span></h2>
        {v.payments.length ? (
          <ul className="p12-action-list">
            {v.payments.map((p, i) => <li key={i}><span><strong>{p.paymentNo}</strong><span className="sub-line muted small">{d(p.date)} · {p.isAdjustment ? t('ac2.pay.adjusted') : t(`ac2.mode.${p.mode}` as MessageKey)}</span></span><span className="row-actions"><span>{rupees(p.amount, { paise: true })}</span><AccPill status={p.status} /></span></li>)}
          </ul>
        ) : <p className="muted">{t('ac2.bill.noPayments')}</p>}
      </section>
      <Modal open={cancel} onClose={() => setCancel(false)} title={t('ac2.bill.cancel')} subtitle={v.journalEntryNo ? t('ac2.bill.cancelPosted') : undefined} onSubmit={doCancel} submitLabel={t('ac2.bill.cancel')} busy={busy} error={error} danger submitDisabled={reason.trim().length < 5}>
        <Field id="bl-reason" label={t('ac2.reason')} hint={t('ac2.reasonHint')}><input id="bl-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
