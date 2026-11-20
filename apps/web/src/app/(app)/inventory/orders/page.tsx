'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { InvPill, ItemLine, ItemLinesEditor, emptyItemLine, fmtDate, inr, lineItems, useInvItems, useInvOptions } from '@/components/inventory';

interface Po { id: string; poNo: string; vendor: string; store: string; poDate: string; deliveryDate: string | null; totalAmount: string; status: string }
const FILTERS = ['', 'PENDING_APPROVAL', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const;

/** Inventory → Purchase orders (M17.3): orders to vendors, what has arrived, what is still due. */
export default function PurchaseOrdersPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const opts = useInvOptions();
  const items = useInvItems();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [rows, setRows] = useState<Po[] | null>(null);
  const [form, setForm] = useState<{ campusId: string; vendorId: string; storeId: string; poDate: string; deliveryDate: string; terms: string; lines: ItemLine[] } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Po[]>(`/inventory/orders${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const start = () => {
    setErrors({}); setError(null);
    const campusId = opts?.campuses[0]?.id ?? '';
    setForm({ campusId, vendorId: '', storeId: opts?.stores.find((s) => s.campusId === campusId)?.id ?? '', poDate: todayIST(), deliveryDate: '', terms: '', lines: [emptyItemLine()] });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const { lines, ...f } = form;
      const r = await api<{ id: string; poNo: string; status: string }>('/inventory/orders', { method: 'POST', body: JSON.stringify({ ...f, deliveryDate: f.deliveryDate || null, terms: f.terms || null, items: lineItems(lines, 'rate') }) });
      toast(r.status === 'APPROVED' ? t('inv.po.createdOpen', { no: r.poNo }) : t('inv.po.createdWait', { no: r.poNo }));
      router.push(`/inventory/orders/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const due = (p: Po) => p.deliveryDate && ['APPROVED', 'PARTIAL'].includes(p.status) && p.deliveryDate < todayIST();
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.po.title')} description={t('inv.po.desc')}
        actions={can(PERMISSIONS.INV_PURCHASE) && <button type="button" className="btn btn-primary" onClick={start} disabled={!opts}><Icon name="plus" /> {t('inv.po.direct')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('inv.po.title')}>
        {FILTERS.map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`inv.st.${x}` as MessageKey) : t('inv.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="file" title={t('inv.po.none')} text={t('inv.po.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('inv.po.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.po.no')}</th><th scope="col">{t('inv.vendor')}</th><th scope="col">{t('inv.po.deliverTo')}</th><th scope="col">{t('inv.po.deliveryBy')}</th><th scope="col" className="num">{t('inv.total')}</th><th scope="col">{t('inv.status')}</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/inventory/orders/${p.id}`} className="mono"><strong>{p.poNo}</strong></Link><span className="sub-line muted small">{fmtDate(locale, p.poDate)}</span></td>
                <td>{p.vendor}</td>
                <td>{p.store}</td>
                <td className={due(p) ? 'text-bad' : undefined}>{fmtDate(locale, p.deliveryDate)}{due(p) && <span className="sub-line small">{t('inv.po.late')}</span>}</td>
                <td className="num">{inr(p.totalAmount)}</td>
                <td><InvPill status={p.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('inv.po.direct')} subtitle={t('inv.po.directSub')} onSubmit={save} submitLabel={t('inv.po.create')} busy={busy} error={error} wide>
        {form && opts && <>
          <div className="grid-3">
            {opts.campuses.length > 1 && <Field id="po-campus" label={t('inv.campus')} error={errors.campusId}><select id="po-campus" value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, storeId: opts.stores.find((s) => s.campusId === e.target.value)?.id ?? '' })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field id="po-vendor" label={t('inv.vendor')} error={errors.vendorId}><select id="po-vendor" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field id="po-store" label={t('inv.po.deliverTo')} error={errors.storeId}><select id="po-store" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts.stores.filter((s) => s.campusId === form.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <div className="grid-3">
            <Field id="po-date" label={t('inv.po.date')} error={errors.poDate}><input id="po-date" type="date" value={form.poDate} onChange={(e) => setForm({ ...form, poDate: e.target.value })} /></Field>
            <Field id="po-del" label={t('inv.po.deliveryBy')} error={errors.deliveryDate}><input id="po-del" type="date" min={form.poDate} value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} /></Field>
            <Field id="po-terms" label={t('inv.po.terms')} error={errors.terms}><input id="po-terms" value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></Field>
          </div>
          <ItemLinesEditor items={items} lines={form.lines} setLines={(l) => setForm({ ...form, lines: l })} rateLabel={t('inv.po.rateExGst')} error={errors.items} />
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.po.gstNote')}</p>
        </>}
      </Modal>
    </>
  );
}
