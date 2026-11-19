'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { AccPill, AccountSelect, rupees, todayIST, useChart, useCostCentres } from '@/components/accounts';

interface Bill { id: string; internalNo: string; billNo: string; vendorId: string; vendor: string; billDate: string; dueDate: string | null; total: string; tds: string; payable: string; paid: string; balance: string; status: string; overdue: boolean }
interface Vendor { id: string; name: string; vendorCode: string; stateCode: string; status: string; tdsSection: string | null }
interface Tax { id: string; code: string; name: string; ratePercent: string; effectiveFrom: string; effectiveTo: string | null }
interface Item { accountId: string; costCentreId: string; description: string; quantity: string; rate: string; taxCodeId: string }
interface Preview { interState: boolean; subTotal: string; taxAmount: string; cgst: string; sgst: string; igst: string; tdsAmount: string; tdsNote: string; total: string; payable: string }
type Filter = 'OPEN' | 'PENDING_APPROVAL' | 'ALL';
const newItem = (): Item => ({ accountId: '', costCentreId: '', description: '', quantity: '1', rate: '', taxCodeId: '' });

/** Accounts → Bills (M13.2): vendor bills with GST and TDS worked out, approval and posting. */
export default function BillsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const entry = can(PERMISSIONS.ACC_ENTRY);
  const chart = useChart();
  const ccs = useCostCentres();
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [rows, setRows] = useState<Bill[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ campusId: '', vendorId: '', billNo: '', billDate: todayIST(), dueDate: '', applyTds: true, notes: '' });
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Bill[]>(`/accounts/bills${filter === 'ALL' ? '' : `?status=${filter}`}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  useEffect(() => {
    api<Vendor[]>('/accounts/vendors').then((v) => setVendors(v.filter((x) => x.status === 'ACTIVE'))).catch(() => setVendors([]));
    api<{ taxCodes: Tax[] }>('/accounts/statutory').then((s) => setTaxes(s.taxCodes)).catch(() => setTaxes([]));
  }, []);
  const body = useMemo(() => ({
    ...form, dueDate: form.dueDate || null, notes: form.notes || null,
    items: items.filter((i) => i.accountId || i.rate).map((i) => ({ accountId: i.accountId, costCentreId: i.costCentreId || null, description: i.description, quantity: i.quantity || '1', rate: i.rate, taxCodeId: i.taxCodeId || null })),
  }), [form, items]);
  // Live GST / TDS preview while typing (server does the same sums when saving).
  useEffect(() => {
    if (!open || !form.vendorId || !form.campusId || !body.items.length || body.items.some((i) => !i.accountId || !i.rate || !i.description)) { setPreview(null); return; }
    const h = window.setTimeout(() => { api<Preview>('/accounts/bills/preview', { method: 'POST', body: JSON.stringify({ ...body, billNo: body.billNo || 'preview' }) }).then(setPreview).catch(() => setPreview(null)); }, 350);
    return () => window.clearTimeout(h);
  }, [open, body, form.vendorId, form.campusId]);
  const start = () => { setForm({ campusId: '', vendorId: vendors[0]?.id ?? '', billNo: '', billDate: todayIST(), dueDate: '', applyTds: true, notes: '' }); setItems([newItem()]); setPreview(null); setErrors({}); setError(null); setOpen(true); };
  const setItem = (i: number, patch: Partial<Item>) => setItems((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string; internalNo: string; status: string }>('/accounts/bills', { method: 'POST', body: JSON.stringify(body) });
      toast(r.status === 'PENDING_APPROVAL' ? t('ac2.bill.sentApproval', { no: r.internalNo }) : t('ac2.bill.saved', { no: r.internalNo })); setOpen(false); window.location.href = `/accounts/bills/${r.id}`;
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const vendor = vendors.find((v) => v.id === form.vendorId);
  const liveTaxes = taxes.filter((x) => x.effectiveFrom <= form.billDate && (!x.effectiveTo || x.effectiveTo >= form.billDate));
  return (
    <>
      <PageHeader eyebrow={t('nav.accounts')} title={t('ac2.bills.title')} description={t('ac2.bills.desc')}
        actions={entry && <><Link href="/accounts/vendors" className="btn"><Icon name="users" /> {t('ac2.vendors.title')}</Link><button type="button" className="btn btn-primary" onClick={start} disabled={!chart || !vendors.length}><Icon name="plus" /> {t('ac2.bill.new')}</button></>} />
      {entry && chart && !vendors.length && <p className="notice"><Icon name="info" /> {t('ac2.bill.addVendorFirst')}</p>}
      <div className="tabs" role="tablist" aria-label={t('ac2.bills.title')}>
        {(['OPEN', 'PENDING_APPROVAL', 'ALL'] as Filter[]).map((x) => <button key={x} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{t(`ac2.bills.f.${x}` as MessageKey)}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="receipt" title={t('ac2.bills.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.bill.no')}</th><th scope="col">{t('ac2.vendor')}</th><th scope="col">{t('ac2.bill.date')}</th><th scope="col" className="num">{t('ac2.bill.total')}</th><th scope="col" className="num">{t('ac2.bill.balance')}</th><th scope="col">{t('common.status')}</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={['CANCELLED', 'REJECTED'].includes(b.status) ? 'row-dim' : undefined}>
                  <td><Link href={`/accounts/bills/${b.id}`} className="code">{b.internalNo}</Link><span className="sub-line muted small">{t('ac2.bill.theirNo', { no: b.billNo })}</span></td>
                  <td>{b.vendor}</td>
                  <td>{d(b.billDate)}{b.dueDate && <span className={`sub-line small ${b.overdue ? 'text-bad' : 'muted'}`}>{t('ac2.bill.dueOn', { d: d(b.dueDate) })}</span>}</td>
                  <td className="num">{rupees(b.total, { paise: true })}{Number(b.tds) > 0 && <span className="sub-line muted small">{t('ac2.bill.tdsShort', { amt: rupees(b.tds, { paise: true }) })}</span>}</td>
                  <td className="num">{rupees(b.balance, { paise: true })}</td>
                  <td><AccPill status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('ac2.bill.new')} subtitle={t('ac2.bill.newSub')} onSubmit={save} submitLabel={t('ac2.bill.save')} busy={busy} error={error} wide>
        <div className="grid-3">
          <Field id="bl-vendor" label={t('ac2.vendor')} error={errors.vendorId}><select id="bl-vendor" value={form.vendorId} onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field id="bl-no" label={t('ac2.bill.vendorNo')} error={errors.billNo}><input id="bl-no" value={form.billNo} onChange={(e) => setForm((f) => ({ ...f, billNo: e.target.value }))} /></Field>
          <Field id="bl-campus" label={t('common.campus')} error={errors.campusId}><CampusPicker id="bl-campus" value={form.campusId} onChange={(v) => setForm((f) => ({ ...f, campusId: v }))} allowInstitution={false} /></Field>
        </div>
        <div className="grid-3">
          <Field id="bl-date" label={t('ac2.bill.date')} error={errors.billDate}><input id="bl-date" type="date" max={todayIST()} value={form.billDate} onChange={(e) => setForm((f) => ({ ...f, billDate: e.target.value }))} /></Field>
          <Field id="bl-due" label={t('ac2.bill.due')} error={errors.dueDate}><input id="bl-due" type="date" min={form.billDate} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
          <Field id="bl-tds" label={t('ac2.bill.tds')} hint={vendor?.tdsSection ? t('ac2.bill.tdsHint', { s: vendor.tdsSection }) : t('ac2.bill.noTdsSection')}><label className="check"><input id="bl-tds" type="checkbox" checked={form.applyTds} disabled={!vendor?.tdsSection} onChange={(e) => setForm((f) => ({ ...f, applyTds: e.target.checked }))} /> {t('ac2.bill.applyTds')}</label></Field>
        </div>
        <div className="acc-lines">
          <table className="table">
            <thead><tr><th scope="col">{t('ac2.bill.item')}</th><th scope="col">{t('ac2.account')}</th>{ccs.length > 0 && <th scope="col">{t('ac2.costCentre')}</th>}<th scope="col" className="num">{t('ac2.bill.qty')}</th><th scope="col" className="num">{t('ac2.bill.rate')}</th><th scope="col">{t('ac2.bill.gst')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td><input aria-label={t('ac2.bill.itemN', { n: i + 1 })} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder={t('ac2.bill.itemPh')} /></td>
                  <td>{chart && <AccountSelect id={`bl-acc-${i}`} label={t('ac2.accountLine', { n: i + 1 })} chart={chart} value={it.accountId} onChange={(v) => setItem(i, { accountId: v })} types={['EXPENSE', 'ASSET']} only={(a) => !['CASH', 'PETTY_CASH', 'BANK', 'STUDENT_RECEIVABLE', 'GATEWAY_CLEARING', 'CHEQUES_IN_HAND', 'VENDOR_ADVANCES', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST'].includes(a.systemKey ?? '') && !a.bankAccountId} />}</td>
                  {ccs.length > 0 && <td><select aria-label={t('ac2.costCentre')} value={it.costCentreId} onChange={(e) => setItem(i, { costCentreId: e.target.value })}><option value="">—</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>}
                  <td className="num"><input aria-label={t('ac2.bill.qtyN', { n: i + 1 })} inputMode="decimal" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td className="num"><input aria-label={t('ac2.bill.rateN', { n: i + 1 })} inputMode="decimal" value={it.rate} onChange={(e) => setItem(i, { rate: e.target.value })} /></td>
                  <td><select aria-label={t('ac2.bill.gstN', { n: i + 1 })} value={it.taxCodeId} onChange={(e) => setItem(i, { taxCodeId: e.target.value })}><option value="">{t('ac2.bill.noGst')}</option>{liveTaxes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                  <td>{items.length > 1 && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.removeLine', { n: i + 1 })} onClick={() => setItems((l) => l.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm" onClick={() => setItems((l) => [...l, newItem()])}><Icon name="plus" size={14} /> {t('ac2.bill.addItem')}</button>
          {errors.items && <span className="field-error">{errors.items}</span>}
        </div>
        {preview ? (
          <dl className="kv acc-preview" aria-live="polite">
            <div><dt>{t('ac2.bill.subTotal')}</dt><dd>{rupees(preview.subTotal, { paise: true })}</dd></div>
            <div><dt>{preview.interState ? t('ac2.bill.igst') : t('ac2.bill.cgstSgst')}</dt><dd>{preview.interState ? rupees(preview.igst, { paise: true }) : `${rupees(preview.cgst, { paise: true })} + ${rupees(preview.sgst, { paise: true })}`}</dd></div>
            <div><dt>{t('ac2.bill.total')}</dt><dd>{rupees(preview.total, { paise: true })}</dd></div>
            <div><dt>{t('ac2.bill.tdsKept')}</dt><dd>{rupees(preview.tdsAmount, { paise: true })}<span className="sub-line muted small">{preview.tdsNote}</span></dd></div>
            <div><dt>{t('ac2.bill.payable')}</dt><dd><strong>{rupees(preview.payable, { paise: true })}</strong></dd></div>
          </dl>
        ) : <p className="muted small">{t('ac2.bill.previewHint')}</p>}
        <Field id="bl-notes" label={t('ac2.notes')} error={errors.notes}><input id="bl-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
