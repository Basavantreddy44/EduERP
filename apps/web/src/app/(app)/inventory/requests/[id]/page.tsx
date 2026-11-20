'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { InvPill, fmtDate, inr, qty, unitLabel, useInvOptions } from '@/components/inventory';

interface Quote { id: string; vendorId: string; vendor: string; quotationNo: string | null; quotationDate: string; validTill: string | null; deliveryDays: number | null; paymentTerms: string | null; subTotal: string; taxAmount: string; totalAmount: string; isSelected: boolean; selectionReason: string | null; coversAll: boolean; lowestTotal: boolean; items: { prItemId: string; rate: string; taxPercent: number; amount: string }[] }
interface Pr {
  id: string; prNo: string; campusId: string; department: string; requiredBy: string | null; justification: string; estimatedTotal: string; status: string;
  po: { id: string; poNo: string; status: string } | null; can: { purchase: boolean };
  items: { id: string; itemId: string; item: string; itemCode: string; unit: string; quantity: string; estimatedRate: string; remarks: string | null; lowestQuotationId: string | null }[];
  quotations: Quote[];
}

/** One purchase request: its items, the quotations side by side (comparative statement) and the order. */
export default function PurchaseRequestPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const opts = useInvOptions();
  const [pr, setPr] = useState<Pr | null>(null);
  const [missing, setMissing] = useState(false);
  const [quote, setQuote] = useState<{ vendorId: string; quotationNo: string; quotationDate: string; validTill: string; deliveryDays: string; paymentTerms: string; rates: Record<string, { rate: string; taxPercent: string }> } | null>(null);
  const [pick, setPick] = useState<{ q: Quote; reason: string } | null>(null);
  const [order, setOrder] = useState<{ q: Quote; storeId: string; poDate: string; deliveryDate: string; terms: string } | null>(null);
  const [cancel, setCancel] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Pr>(`/inventory/requests/${id}`).then(setPr).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const reset = () => { setErrors({}); setError(null); };
  const run = async (fn: () => Promise<unknown>, done: string, close: () => void) => {
    setBusy(true); reset();
    try { await fn(); toast(done); close(); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="clipboard" title={t('inv.pr.notFound')} action={<Link href="/inventory/requests" className="btn">{t('inv.pr.title')}</Link>} />;
  if (!pr) return <SkeletonRows rows={6} />;

  const open = pr.status === 'APPROVED' && pr.can.purchase;
  const quoted = new Set(pr.quotations.map((q) => q.vendorId));
  const startQuote = () => { reset(); setQuote({ vendorId: '', quotationNo: '', quotationDate: todayIST(), validTill: '', deliveryDays: '', paymentTerms: '', rates: Object.fromEntries(pr.items.map((i) => [i.id, { rate: '', taxPercent: '18' }])) }); };
  const saveQuote = (e: FormEvent) => {
    e.preventDefault();
    if (!quote) return;
    const items = pr.items.filter((i) => quote.rates[i.id]?.rate).map((i) => ({ prItemId: i.id, rate: quote.rates[i.id].rate, taxPercent: Number(quote.rates[i.id].taxPercent || 0) }));
    void run(() => api(`/inventory/requests/${pr.id}/quotations`, { method: 'POST', body: JSON.stringify({ vendorId: quote.vendorId, quotationNo: quote.quotationNo || null, quotationDate: quote.quotationDate, validTill: quote.validTill || null, deliveryDays: quote.deliveryDays === '' ? null : Number(quote.deliveryDays), paymentTerms: quote.paymentTerms || null, items }) }), t('inv.q.saved'), () => setQuote(null));
  };
  const savePick = (e: FormEvent) => { e.preventDefault(); if (pick) void run(() => api(`/inventory/quotations/${pick.q.id}/select`, { method: 'POST', body: JSON.stringify({ reason: pick.reason }) }), t('inv.q.selected', { v: pick.q.vendor }), () => setPick(null)); };
  const saveOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setBusy(true); reset();
    try {
      const r = await api<{ id: string; poNo: string; status: string }>(`/inventory/quotations/${order.q.id}/order`, { method: 'POST', body: JSON.stringify({ storeId: order.storeId, poDate: order.poDate, deliveryDate: order.deliveryDate || null, terms: order.terms || null }) });
      toast(r.status === 'APPROVED' ? t('inv.po.createdOpen', { no: r.poNo }) : t('inv.po.createdWait', { no: r.poNo }));
      router.push(`/inventory/orders/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const doCancel = (e: FormEvent) => { e.preventDefault(); void run(() => api(`/inventory/requests/${pr.id}/cancel`, { method: 'POST' }), t('inv.pr.cancelled'), () => setCancel(false)); };
  const campusStores = (opts?.stores ?? []).filter((s) => s.campusId === pr.campusId);
  const gstRates = [...new Set(['0', ...(opts?.taxCodes ?? []).map((c) => String(Number(c.rate)))])].sort((a, b) => Number(a) - Number(b));
  const q = quote;
  return (
    <>
      <Link href="/inventory/requests" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('inv.pr.title')}</Link>
      <PageHeader eyebrow={`${t('inv.pr.one')} · ${pr.department}`} title={pr.prNo} description={pr.justification}
        actions={<>
          <InvPill status={pr.status} />
          {pr.po && <Link href={`/inventory/orders/${pr.po.id}`} className="btn"><Icon name="file" /> {pr.po.poNo}</Link>}
          {['SUBMITTED', 'APPROVED'].includes(pr.status) && <button type="button" className="btn btn-ghost" onClick={() => { reset(); setCancel(true); }}>{t('inv.pr.cancel')}</button>}
          {open && <button type="button" className="btn btn-primary" onClick={startQuote}><Icon name="plus" /> {t('inv.q.add')}</button>}
        </>} />
      {pr.status === 'SUBMITTED' && <p className="notice notice-warn" role="status"><Icon name="clock" size={16} /> {t('inv.pr.waiting')}</p>}

      <section className="card p12-block" aria-labelledby="pr-items">
        <h2 id="pr-items" className="section-title">{t('inv.pr.itemsTitle')}</h2>
        <dl className="inv-facts">
          <div><dt>{t('inv.pr.estimate')}</dt><dd>{inr(pr.estimatedTotal)}</dd></div>
          <div><dt>{t('inv.pr.neededLabel')}</dt><dd>{fmtDate(locale, pr.requiredBy)}</dd></div>
        </dl>
        <div className="table-wrap" role="region" aria-label={t('inv.pr.itemsTitle')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.quantity')}</th><th scope="col" className="num">{t('inv.pr.estRate')}</th></tr></thead>
            <tbody>{pr.items.map((i) => <tr key={i.id}><td><strong>{i.item}</strong><span className="sub-line muted small mono">{i.itemCode}</span></td><td className="num">{qty(i.quantity)} <span className="muted small">{unitLabel(t, i.unit)}</span></td><td className="num">{inr(i.estimatedRate)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card p12-block" aria-labelledby="pr-cmp">
        <h2 id="pr-cmp" className="section-title">{t('inv.q.compare')}</h2>
        {!pr.quotations.length ? <p className="muted">{pr.status === 'APPROVED' ? t('inv.q.none') : t('inv.q.noneYet')}</p> : (
          <>
            <p className="muted small">{t('inv.q.compareHint')}</p>
            <div className="table-wrap" role="region" aria-label={t('inv.q.compare')} tabIndex={0}>
              <table className="table inv-compare">
                <thead><tr>
                  <th scope="col">{t('inv.item')}</th>
                  {pr.quotations.map((x) => (
                    <th key={x.id} scope="col" className={`num ${x.isSelected ? 'inv-chosen' : ''}`}>
                      {x.vendor}
                      <span className="sub-line muted small">{x.quotationNo ?? ''} {fmtDate(locale, x.quotationDate)}</span>
                      {x.isSelected && <span className="sub-line"><span className="pill pill-ok"><span className="pill-dot" />{t('inv.q.chosen')}</span></span>}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {pr.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.item}<span className="sub-line muted small">{qty(i.quantity)} {unitLabel(t, i.unit)}</span></th>
                      {pr.quotations.map((x) => {
                        const line = x.items.find((l) => l.prItemId === i.id);
                        const best = i.lowestQuotationId === x.id;
                        return <td key={x.id} className={`num ${best ? 'inv-best' : ''}`}>{line ? <>{inr(line.rate)}<span className="sub-line muted small">{inr(line.amount)} · GST {line.taxPercent}%</span>{best && <span className="sr-only"> {t('inv.q.lowest')}</span>}</> : <span className="muted">{t('inv.q.notQuoted')}</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><th scope="row">{t('inv.q.subTotal')}</th>{pr.quotations.map((x) => <td key={x.id} className="num">{inr(x.subTotal)}</td>)}</tr>
                  <tr><th scope="row">GST</th>{pr.quotations.map((x) => <td key={x.id} className="num">{inr(x.taxAmount)}</td>)}</tr>
                  <tr className="inv-total"><th scope="row">{t('inv.total')}</th>{pr.quotations.map((x) => <td key={x.id} className={`num ${x.lowestTotal ? 'inv-best' : ''}`}><strong>{inr(x.totalAmount)}</strong>{x.lowestTotal && <span className="sub-line small">{t('inv.q.lowestTotal')}</span>}{!x.coversAll && <span className="sub-line muted small">{t('inv.q.partial')}</span>}</td>)}</tr>
                  <tr><th scope="row">{t('inv.q.terms')}</th>{pr.quotations.map((x) => <td key={x.id} className="num small">{x.deliveryDays != null ? t('inv.q.days', { n: x.deliveryDays }) : '—'}{x.paymentTerms ? <span className="sub-line muted">{x.paymentTerms}</span> : null}{x.validTill ? <span className="sub-line muted">{t('inv.q.validTill', { d: fmtDate(locale, x.validTill) })}</span> : null}</td>)}</tr>
                  {open && <tr><td />{pr.quotations.map((x) => (
                    <td key={x.id} className="num">
                      {x.isSelected
                        ? <button type="button" className="btn btn-sm btn-primary" onClick={() => { reset(); setOrder({ q: x, storeId: campusStores[0]?.id ?? '', poDate: todayIST(), deliveryDate: '', terms: x.paymentTerms ?? '' }); }}>{t('inv.q.makeOrder')}</button>
                        : <button type="button" className="btn btn-sm" onClick={() => { reset(); setPick({ q: x, reason: x.lowestTotal ? t('inv.q.reasonLowest') : '' }); }}>{t('inv.q.choose')}</button>}
                    </td>
                  ))}</tr>}
                </tfoot>
              </table>
            </div>
            {pr.quotations.filter((x) => x.isSelected && x.selectionReason).map((x) => <p key={x.id} className="muted small">{t('inv.q.why', { v: x.vendor, r: x.selectionReason! })}</p>)}
          </>
        )}
      </section>

      <Modal open={!!q} onClose={() => setQuote(null)} title={t('inv.q.add')} subtitle={t('inv.q.addSub')} onSubmit={saveQuote} busy={busy} error={error} wide>
        {q && <>
          <div className="grid-3">
            <Field id="q-vendor" label={t('inv.vendor')} error={errors.vendorId} hint={opts && !opts.vendors.length ? t('inv.q.noVendors') : undefined}><select id="q-vendor" value={q.vendorId} onChange={(e) => setQuote({ ...q, vendorId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts?.vendors.filter((v) => !quoted.has(v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field id="q-no" label={t('inv.q.no')} error={errors.quotationNo}><input id="q-no" value={q.quotationNo} onChange={(e) => setQuote({ ...q, quotationNo: e.target.value })} /></Field>
            <Field id="q-date" label={t('inv.q.date')} error={errors.quotationDate}><input id="q-date" type="date" max={todayIST()} value={q.quotationDate} onChange={(e) => setQuote({ ...q, quotationDate: e.target.value })} /></Field>
          </div>
          <div className="grid-3">
            <Field id="q-valid" label={t('inv.q.validLabel')} error={errors.validTill}><input id="q-valid" type="date" value={q.validTill} onChange={(e) => setQuote({ ...q, validTill: e.target.value })} /></Field>
            <Field id="q-days" label={t('inv.q.deliveryDays')} error={errors.deliveryDays}><input id="q-days" inputMode="numeric" value={q.deliveryDays} onChange={(e) => setQuote({ ...q, deliveryDays: e.target.value })} /></Field>
            <Field id="q-terms" label={t('inv.q.payTerms')} error={errors.paymentTerms}><input id="q-terms" value={q.paymentTerms} placeholder={t('inv.q.payTermsPh')} onChange={(e) => setQuote({ ...q, paymentTerms: e.target.value })} /></Field>
          </div>
          <div className="acc-lines">
            <table className="table">
              <thead><tr><th scope="col">{t('inv.item')}</th><th scope="col" className="num">{t('inv.quantity')}</th><th scope="col" className="num">{t('inv.q.ratePer')}</th><th scope="col" className="num">{t('inv.q.gstPct')}</th></tr></thead>
              <tbody>{pr.items.map((i, n) => (
                <tr key={i.id}>
                  <td>{i.item}</td>
                  <td className="num">{qty(i.quantity)} <span className="muted small">{unitLabel(t, i.unit)}</span></td>
                  <td className="num"><input aria-label={t('inv.rateLine', { n: n + 1 })} inputMode="decimal" value={q.rates[i.id]?.rate ?? ''} onChange={(e) => setQuote({ ...q, rates: { ...q.rates, [i.id]: { ...q.rates[i.id], rate: e.target.value } } })} /></td>
                  <td className="num"><select aria-label={t('inv.q.gstLine', { n: n + 1 })} value={q.rates[i.id]?.taxPercent ?? '0'} onChange={(e) => setQuote({ ...q, rates: { ...q.rates, [i.id]: { ...q.rates[i.id], taxPercent: e.target.value } } })}>{gstRates.map((p) => <option key={p} value={p}>{p}%</option>)}</select></td>
                </tr>
              ))}</tbody>
            </table>
            {errors.items && <span className="field-error">{errors.items}</span>}
          </div>
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.q.blankNote')}</p>
        </>}
      </Modal>

      <Modal open={!!pick} onClose={() => setPick(null)} title={t('inv.q.chooseTitle', { v: pick?.q.vendor ?? '' })} subtitle={t('inv.q.chooseSub')} onSubmit={savePick} submitLabel={t('inv.q.choose')} busy={busy} error={error}>
        {pick && <Field id="pk-reason" label={t('inv.q.reason')} error={errors.reason}><input id="pk-reason" value={pick.reason} onChange={(e) => setPick({ ...pick, reason: e.target.value })} /></Field>}
      </Modal>

      <Modal open={!!order} onClose={() => setOrder(null)} title={t('inv.q.makeOrder')} subtitle={order ? t('inv.q.orderSub', { v: order.q.vendor, amt: inr(order.q.totalAmount) }) : undefined} onSubmit={saveOrder} submitLabel={t('inv.po.create')} busy={busy} error={error}>
        {order && <>
          <Field id="po-store" label={t('inv.po.deliverTo')} error={errors.storeId}><select id="po-store" value={order.storeId} onChange={(e) => setOrder({ ...order, storeId: e.target.value })}><option value="">{t('inv.choose')}</option>{campusStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <div className="grid-2">
            <Field id="po-date" label={t('inv.po.date')} error={errors.poDate}><input id="po-date" type="date" value={order.poDate} onChange={(e) => setOrder({ ...order, poDate: e.target.value })} /></Field>
            <Field id="po-del" label={t('inv.po.deliveryBy')} error={errors.deliveryDate}><input id="po-del" type="date" min={order.poDate} value={order.deliveryDate} onChange={(e) => setOrder({ ...order, deliveryDate: e.target.value })} /></Field>
          </div>
          <Field id="po-terms" label={t('inv.po.terms')} error={errors.terms}><textarea id="po-terms" rows={3} value={order.terms} onChange={(e) => setOrder({ ...order, terms: e.target.value })} /></Field>
        </>}
      </Modal>

      <Modal open={cancel} onClose={() => setCancel(false)} title={t('inv.pr.cancelTitle', { no: pr.prNo })} subtitle={t('inv.pr.cancelSub')} onSubmit={doCancel} submitLabel={t('inv.pr.cancel')} busy={busy} error={error} danger>
        <p className="muted">{pr.justification}</p>
      </Modal>
    </>
  );
}
