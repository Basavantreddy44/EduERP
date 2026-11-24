'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, todayIST } from '@/components/accounts';
import { InvPill, fmtDate, inr, qty, unitLabel } from '@/components/inventory';
import { DocLogo } from '@/components/DocLogo';

interface Receipt { id: string; grnNo: string; receiptDate: string; vendorChallanNo: string | null; receivedBy: string | null; remarks: string | null; items: { id: string; item: string; unit: string; receivedQty: string; acceptedQty: string; rejectedQty: string; rejectionReason: string | null; rate: string; taxPercent: number; billedQty: string; unbilledQty: string }[] }
interface Po {
  id: string; poNo: string; status: string; poDate: string; deliveryDate: string | null; terms: string | null; subTotal: string; taxAmount: string; totalAmount: string; cancelReason: string | null;
  institution: string; campus: string; campusAddress: string | null; vendor: { id: string; name: string; gstin: string | null; address: string | null }; store: { id: string; name: string }; createdBy: string | null; prId: string | null;
  can: { receive: boolean; purchase: boolean; bill: boolean };
  items: { id: string; lineNo: number; item: string; itemCode: string; unit: string; hsnCode: string | null; quantity: string; rate: string; taxPercent: number; amount: string; taxAmount: string; receivedQty: string; pendingQty: string }[];
  receipts: Receipt[];
  bills: { id: string; internalNo: string; billNo: string; status: string; totalAmount: string; goodsReceiptId: string | null }[];
}
type RLine = { poItemId: string; receivedQty: string; rejectedQty: string; rejectionReason: string };

/** A purchase order: print it for the vendor, receive goods against it, and make the bill from a receipt. */
export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [po, setPo] = useState<Po | null>(null);
  const [missing, setMissing] = useState(false);
  const [recv, setRecv] = useState<{ receiptDate: string; vendorChallanNo: string; remarks: string; lines: RLine[] } | null>(null);
  const [bill, setBill] = useState<{ g: Receipt; billNo: string; billDate: string; dueDate: string; applyTds: boolean; qty: Record<string, string> } | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Po>(`/inventory/orders/${id}`).then(setPo).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const run = async (fn: () => Promise<{ [k: string]: unknown }>, done: (r: { [k: string]: unknown }) => string, close: () => void) => {
    setBusy(true); reset();
    try { const r = await fn(); toast(done(r)); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="file" title={t('inv.po.notFound')} action={<Link href="/inventory/orders" className="btn">{t('inv.po.title')}</Link>} />;
  if (!po) return <SkeletonRows rows={6} />;

  const open = ['APPROVED', 'PARTIAL'].includes(po.status);
  const startRecv = () => { reset(); setRecv({ receiptDate: todayIST(), vendorChallanNo: '', remarks: '', lines: po.items.filter((i) => Number(i.pendingQty) > 0).map((i) => ({ poItemId: i.id, receivedQty: i.pendingQty, rejectedQty: '0', rejectionReason: '' })) }); };
  const saveRecv = (e: FormEvent) => {
    e.preventDefault();
    if (!recv) return;
    const lines = recv.lines.filter((l) => Number(l.receivedQty) > 0).map((l) => ({ ...l, rejectedQty: l.rejectedQty || '0', rejectionReason: l.rejectionReason || null }));
    void run(() => api(`/inventory/orders/${po.id}/receipts`, { method: 'POST', body: JSON.stringify({ receiptDate: recv.receiptDate, vendorChallanNo: recv.vendorChallanNo || null, remarks: recv.remarks || null, lines }) }), (r) => t('inv.grn.done', { no: String(r.grnNo) }), () => setRecv(null));
  };
  const saveBill = (e: FormEvent) => {
    e.preventDefault();
    if (!bill) return;
    const lines = bill.g.items.filter((i) => Number(bill.qty[i.id]) > 0).map((i) => ({ grnItemId: i.id, quantity: bill.qty[i.id] }));
    void run(() => api(`/inventory/receipts/${bill.g.id}/bill`, { method: 'POST', body: JSON.stringify({ billNo: bill.billNo, billDate: bill.billDate, dueDate: bill.dueDate || null, applyTds: bill.applyTds, lines }) }), (r) => t('inv.bill.done', { no: String(r.internalNo ?? '') }), () => setBill(null));
  };
  const saveCancel = (e: FormEvent) => { e.preventDefault(); if (cancel !== null) void run(() => api(`/inventory/orders/${po.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: cancel }) }), (r) => (r.status === 'CLOSED' ? t('inv.po.closedToast') : t('inv.po.cancelledToast')), () => setCancel(null)); };
  const itemOf = (pid: string) => po.items.find((i) => i.id === pid)!;
  const setLine = (n: number, patch: Partial<RLine>) => setRecv((r) => (r ? { ...r, lines: r.lines.map((l, j) => (j === n ? { ...l, ...patch } : l)) } : r));
  const void_ = ['CANCELLED', 'REJECTED'].includes(po.status);
  return (
    <div className="receipt-page po-page">
      <div className="receipt-tools no-print">
        <Link href="/inventory/orders" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('inv.po.title')}</Link>
        <div className="row-actions">
          <InvPill status={po.status} />
          {open && po.can.purchase && <button type="button" className="btn btn-ghost" onClick={() => { reset(); setCancel(''); }}>{po.status === 'PARTIAL' ? t('inv.po.close') : t('inv.po.cancel')}</button>}
          {open && po.can.receive && <button type="button" className="btn" onClick={startRecv}><Icon name="download" size={16} /> {t('inv.grn.new')}</button>}
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="receipt" size={16} /> {t('inv.po.print')}</button>
        </div>
      </div>
      {po.status === 'PENDING_APPROVAL' && <p className="notice notice-warn no-print" role="status"><Icon name="clock" size={16} /> {t('inv.po.waiting')}</p>}
      {po.cancelReason && <p className="notice no-print" role="status"><Icon name="info" size={16} /> {t('inv.po.reasonShown', { r: po.cancelReason })}</p>}

      <article className={`receipt po ${void_ ? 'void' : ''}`} aria-label={t('inv.po.heading')}>
        {void_ && <div className="receipt-stamp" aria-hidden>{t(po.status === 'REJECTED' ? 'inv.st.REJECTED' : 'inv.st.CANCELLED')}</div>}
        {po.status === 'PENDING_APPROVAL' && <div className="receipt-stamp" aria-hidden>{t('inv.po.draft')}</div>}
        <header className="receipt-head">
          <div className="doc-brand">
            <DocLogo />
            <div>
              <h1>{po.institution}</h1>
              <p className="muted small">{po.campus}{po.campusAddress ? ` · ${po.campusAddress}` : ''}</p>
            </div>
          </div>
          <div className="receipt-title">
            <span>{t('inv.po.heading')}</span>
            <strong className="mono">{po.poNo}</strong>
            <span className="muted small">{fmtDate(locale, po.poDate)}</span>
          </div>
        </header>
        <dl className="receipt-who payslip-who">
          <div><dt>{t('inv.vendor')}</dt><dd><strong>{po.vendor.name}</strong>{po.vendor.address ? <span className="sub-line small">{po.vendor.address}</span> : null}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{po.vendor.gstin ?? '—'}</dd></div>
          <div><dt>{t('inv.po.deliverTo')}</dt><dd>{po.store.name}, {po.campus}</dd></div>
          <div><dt>{t('inv.po.deliveryBy')}</dt><dd>{fmtDate(locale, po.deliveryDate)}</dd></div>
        </dl>
        <table className="receipt-lines">
          <caption className="sr-only">{t('inv.po.heading')}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">{t('inv.item')}</th><th scope="col">HSN</th><th scope="col" className="num">{t('inv.quantity')}</th><th scope="col" className="num">{t('inv.rate')}</th><th scope="col" className="num">{t('inv.amount')}</th><th scope="col" className="num">GST</th><th scope="col" className="num no-print">{t('inv.po.received')}</th></tr></thead>
          <tbody>{po.items.map((i) => (
            <tr key={i.id}>
              <td>{i.lineNo}</td>
              <td>{i.item}<span className="sub-line muted small mono">{i.itemCode}</span></td>
              <td className="mono small">{i.hsnCode ?? ''}</td>
              <td className="num">{qty(i.quantity)} {unitLabel(t, i.unit)}</td>
              <td className="num">{inr(i.rate)}</td>
              <td className="num">{inr(i.amount)}</td>
              <td className="num">{inr(i.taxAmount)}<span className="sub-line muted small">{i.taxPercent}%</span></td>
              <td className="num no-print">{qty(i.receivedQty)}{Number(i.pendingQty) > 0 && open ? <span className="sub-line muted small">{t('inv.po.pending', { q: qty(i.pendingQty) })}</span> : null}</td>
            </tr>
          ))}</tbody>
          <tfoot>
            <tr><th scope="row" colSpan={5}>{t('inv.q.subTotal')}</th><td className="num">{inr(po.subTotal)}</td><td className="num">{inr(po.taxAmount)}</td><td className="no-print" /></tr>
            <tr><th scope="row" colSpan={5}>{t('inv.po.grand')}</th><td className="num" colSpan={2}><strong>{inr(po.totalAmount)}</strong></td><td className="no-print" /></tr>
          </tfoot>
        </table>
        {po.terms && <div className="po-terms"><h2 className="small">{t('inv.po.terms')}</h2><p className="pre-wrap small">{po.terms}</p></div>}
        <footer className="po-sign">
          <span className="muted small">{t('inv.po.preparedBy', { n: po.createdBy ?? '—' })}</span>
          <span className="po-sign-line">{t('inv.po.authorised')}</span>
        </footer>
      </article>

      {po.receipts.length > 0 && (
        <section className="card p12-block no-print" aria-labelledby="po-grn">
          <h2 id="po-grn" className="section-title">{t('inv.grn.title')}</h2>
          {po.receipts.map((g) => {
            const unbilled = g.items.some((i) => Number(i.unbilledQty) > 0);
            return (
              <div key={g.id} className="inv-grn">
                <div className="inv-grn-head">
                  <span><strong className="mono">{g.grnNo}</strong> · {fmtDate(locale, g.receiptDate)}{g.vendorChallanNo ? ` · ${t('inv.grn.challanShort', { n: g.vendorChallanNo })}` : ''}{g.receivedBy ? ` · ${g.receivedBy}` : ''}</span>
                  {unbilled && po.can.bill && <button type="button" className="btn btn-sm btn-primary" onClick={() => { reset(); setBill({ g, billNo: '', billDate: todayIST(), dueDate: '', applyTds: true, qty: Object.fromEntries(g.items.map((i) => [i.id, i.unbilledQty])) }); }}><Icon name="receipt" size={14} /> {t('inv.bill.make')}</button>}
                </div>
                <ul className="lib-mini">{g.items.map((i) => (
                  <li key={i.id}>
                    <span>{i.item}{Number(i.rejectedQty) > 0 && <span className="sub-line muted small">{t('inv.grn.rejectedLine', { q: qty(i.rejectedQty), r: i.rejectionReason ?? '' })}</span>}</span>
                    <span>{t('inv.grn.acceptedLine', { q: qty(i.acceptedQty), u: unitLabel(t, i.unit) })}{Number(i.billedQty) > 0 && <span className="sub-line muted small">{t('inv.grn.billedLine', { q: qty(i.billedQty) })}</span>}</span>
                  </li>
                ))}</ul>
              </div>
            );
          })}
        </section>
      )}
      {po.bills.length > 0 && (
        <section className="card p12-block no-print" aria-labelledby="po-bills">
          <h2 id="po-bills" className="section-title">{t('inv.bill.title')}</h2>
          <ul className="p12-action-list">{po.bills.map((b) => <li key={b.id}><span><Link href={`/accounts/bills/${b.id}`} className="mono">{b.internalNo}</Link> · {t('inv.bill.vendorNo', { n: b.billNo })}</span><span>{inr(b.totalAmount)} <AccPill status={b.status} /></span></li>)}</ul>
        </section>
      )}

      <Modal open={!!recv} onClose={() => setRecv(null)} title={t('inv.grn.new')} subtitle={t('inv.grn.sub', { store: po.store.name })} onSubmit={saveRecv} submitLabel={t('inv.grn.save')} busy={busy} error={error} wide>
        {recv && <>
          <div className="grid-3">
            <Field id="gr-date" label={t('inv.grn.date')} error={errors.receiptDate}><input id="gr-date" type="date" min={po.poDate} max={todayIST()} value={recv.receiptDate} onChange={(e) => setRecv({ ...recv, receiptDate: e.target.value })} /></Field>
            <Field id="gr-challan" label={t('inv.grn.challan')} error={errors.vendorChallanNo}><input id="gr-challan" value={recv.vendorChallanNo} onChange={(e) => setRecv({ ...recv, vendorChallanNo: e.target.value })} /></Field>
            <Field id="gr-rem" label={t('inv.remarks')} error={errors.remarks}><input id="gr-rem" value={recv.remarks} onChange={(e) => setRecv({ ...recv, remarks: e.target.value })} /></Field>
          </div>
          <div className="acc-lines">
            <table className="table">
              <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.grn.due')}</th><th scope="col" className="num">{t('inv.grn.receivedQ')}</th><th scope="col" className="num">{t('inv.grn.rejectedQ')}</th><th scope="col">{t('inv.grn.why')}</th></tr></thead>
              <tbody>{recv.lines.map((l, n) => { const i = itemOf(l.poItemId); return (
                <tr key={l.poItemId}>
                  <td>{i.item}</td>
                  <td className="num">{qty(i.pendingQty)} <span className="muted small">{unitLabel(t, i.unit)}</span></td>
                  <td className="num"><input aria-label={t('inv.grn.receivedLine', { n: n + 1 })} inputMode="decimal" value={l.receivedQty} onChange={(e) => setLine(n, { receivedQty: e.target.value })} /></td>
                  <td className="num"><input aria-label={t('inv.grn.rejectedLineLabel', { n: n + 1 })} inputMode="decimal" value={l.rejectedQty} onChange={(e) => setLine(n, { rejectedQty: e.target.value })} /></td>
                  <td><input aria-label={t('inv.grn.whyLine', { n: n + 1 })} value={l.rejectionReason} disabled={!(Number(l.rejectedQty) > 0)} placeholder={Number(l.rejectedQty) > 0 ? t('inv.grn.whyPh') : ''} onChange={(e) => setLine(n, { rejectionReason: e.target.value })} /></td>
                </tr>
              ); })}</tbody>
            </table>
            {errors.lines && <span className="field-error">{errors.lines}</span>}
          </div>
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.grn.note')}</p>
        </>}
      </Modal>

      <Modal open={!!bill} onClose={() => setBill(null)} title={t('inv.bill.make')} subtitle={bill ? t('inv.bill.sub', { grn: bill.g.grnNo, v: po.vendor.name }) : undefined} onSubmit={saveBill} submitLabel={t('inv.bill.save')} busy={busy} error={error} wide>
        {bill && <>
          <div className="grid-3">
            <Field id="bl-no" label={t('inv.bill.no')} error={errors.billNo}><input id="bl-no" value={bill.billNo} onChange={(e) => setBill({ ...bill, billNo: e.target.value })} /></Field>
            <Field id="bl-date" label={t('inv.bill.date')} error={errors.billDate}><input id="bl-date" type="date" max={todayIST()} value={bill.billDate} onChange={(e) => setBill({ ...bill, billDate: e.target.value })} /></Field>
            <Field id="bl-due" label={t('inv.bill.due')} error={errors.dueDate}><input id="bl-due" type="date" min={bill.billDate} value={bill.dueDate} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} /></Field>
          </div>
          <div className="acc-lines">
            <table className="table">
              <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.bill.left')}</th><th scope="col" className="num">{t('inv.bill.qty')}</th><th scope="col" className="num">{t('inv.rate')}</th><th scope="col" className="num">{t('inv.amount')}</th></tr></thead>
              <tbody>{bill.g.items.filter((i) => Number(i.unbilledQty) > 0).map((i, n) => (
                <tr key={i.id}>
                  <td>{i.item}<span className="sub-line muted small">GST {i.taxPercent}%</span></td>
                  <td className="num">{qty(i.unbilledQty)} <span className="muted small">{unitLabel(t, i.unit)}</span></td>
                  <td className="num"><input aria-label={t('inv.qtyLine', { n: n + 1 })} inputMode="decimal" value={bill.qty[i.id] ?? ''} onChange={(e) => setBill({ ...bill, qty: { ...bill.qty, [i.id]: e.target.value } })} /></td>
                  <td className="num">{inr(i.rate)}</td>
                  <td className="num">{inr(((Number(bill.qty[i.id]) || 0) * Number(i.rate)).toFixed(2))}</td>
                </tr>
              ))}</tbody>
            </table>
            {errors.lines && <span className="field-error">{errors.lines}</span>}
          </div>
          <label className="check"><input type="checkbox" checked={bill.applyTds} onChange={(e) => setBill({ ...bill, applyTds: e.target.checked })} /> {t('inv.bill.tds')}</label>
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.bill.note')}</p>
        </>}
      </Modal>

      <Modal open={cancel !== null} onClose={() => setCancel(null)} title={po.status === 'PARTIAL' ? t('inv.po.closeTitle', { no: po.poNo }) : t('inv.po.cancelTitle', { no: po.poNo })} subtitle={po.status === 'PARTIAL' ? t('inv.po.closeSub') : t('inv.po.cancelSub')} onSubmit={saveCancel} submitLabel={po.status === 'PARTIAL' ? t('inv.po.close') : t('inv.po.cancel')} busy={busy} error={error} danger>
        <Field id="pc-reason" label={t('inv.q.reason')} error={errors.reason}><input id="pc-reason" value={cancel ?? ''} onChange={(e) => setCancel(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
