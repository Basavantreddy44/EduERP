'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { ItemLine, ItemLinesEditor, emptyItemLine, fmtDate, inr, qty, useInvItems, useInvOptions } from '@/components/inventory';

interface Issue { id: string; issueNo: string; issueType: 'ISSUE' | 'TRANSFER'; issueDate: string; from: string; to: string; totalValue: string; remarks: string | null; items: { item: string; unit: string; quantity: string; value: string; returnable: boolean }[] }
type Form = { issueType: 'ISSUE' | 'TRANSFER'; fromStoreId: string; toStoreId: string; toDepartmentId: string; issuedToEmployeeId: string; issueDate: string; remarks: string; lines: ItemLine[] };

/** Inventory → Issues & transfers (M17.4): items handed to departments or staff, and moves between stores. */
function Issues() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [reload, setReload] = useState(0);
  const opts = useInvOptions();
  const items = useInvItems(reload);
  const [type, setType] = useState<'' | 'ISSUE' | 'TRANSFER'>('');
  const [rows, setRows] = useState<Issue[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [stock, setStock] = useState<Map<string, string>>(new Map());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Issue[]>(`/inventory/issues${type ? `?type=${type}` : ''}`).then(setRows).catch(() => setRows([])); }, [type]);
  useEffect(load, [load, reload]);
  const start = useCallback((issueType: 'ISSUE' | 'TRANSFER' = 'ISSUE') => {
    setErrors({}); setError(null);
    setForm({ issueType, fromStoreId: opts?.stores[0]?.id ?? '', toStoreId: '', toDepartmentId: '', issuedToEmployeeId: '', issueDate: todayIST(), remarks: '', lines: [emptyItemLine()] });
  }, [opts]);
  useEffect(() => { if (params.get('new') && opts && can(PERMISSIONS.INV_ISSUE)) { start(); router.replace('/inventory/issues'); } }, [params, opts, can, start, router]);
  const fromStore = form?.fromStoreId;
  useEffect(() => {
    if (!fromStore) { setStock(new Map()); return; }
    api<{ rows: { itemId: string; quantity: string }[] }>(`/inventory/stock?storeId=${fromStore}`).then((r) => setStock(new Map(r.rows.map((x) => [x.itemId, x.quantity])))).catch(() => setStock(new Map()));
  }, [fromStore, reload]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const transfer = form.issueType === 'TRANSFER';
      const r = await api<{ issueNo: string; totalValue: string }>('/inventory/issues', { method: 'POST', body: JSON.stringify({
        issueType: form.issueType, fromStoreId: form.fromStoreId, toStoreId: transfer ? form.toStoreId || null : null,
        toDepartmentId: transfer ? null : form.toDepartmentId || null, issuedToEmployeeId: transfer ? null : form.issuedToEmployeeId || null,
        issueDate: form.issueDate, remarks: form.remarks || null,
        items: form.lines.filter((l) => l.itemId && l.quantity).map((l) => ({ itemId: l.itemId, quantity: l.quantity, returnable: false })),
      }) });
      toast(t(transfer ? 'inv.iss.doneTransfer' : 'inv.iss.done', { no: r.issueNo, amt: inr(r.totalValue) }));
      setForm(null); setReload((n) => n + 1);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const campusOf = opts?.stores.find((s) => s.id === form?.fromStoreId)?.campusId;
  const stocked = items.filter((i) => Number(stock.get(i.id) ?? 0) > 0);
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.iss.title')} description={t('inv.iss.desc')}
        actions={can(PERMISSIONS.INV_ISSUE) && <>
          <button type="button" className="btn" onClick={() => start('TRANSFER')} disabled={!opts}><Icon name="swap" /> {t('inv.iss.newTransfer')}</button>
          <button type="button" className="btn btn-primary" onClick={() => start('ISSUE')} disabled={!opts}><Icon name="plus" /> {t('inv.iss.new')}</button>
        </>} />
      <div className="tabs" role="tablist" aria-label={t('inv.iss.title')}>
        {(['', 'ISSUE', 'TRANSFER'] as const).map((x) => <button key={x || 'all'} role="tab" aria-selected={type === x} className={type === x ? 'on' : ''} onClick={() => setType(x)}>{x === 'ISSUE' ? t('inv.iss.issues') : x === 'TRANSFER' ? t('inv.iss.transfers') : t('inv.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="swap" title={t('inv.iss.none')} text={t('inv.iss.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('inv.iss.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.iss.no')}</th><th scope="col">{t('inv.iss.fromTo')}</th><th scope="col">{t('inv.iss.what')}</th><th scope="col" className="num">{t('inv.value')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><strong className="mono">{r.issueNo}</strong><span className="sub-line muted small">{fmtDate(locale, r.issueDate)} · {r.issueType === 'TRANSFER' ? t('inv.iss.transferOne') : t('inv.iss.issueOne')}</span></td>
                <td>{r.from} <span aria-hidden>→</span><span className="sr-only">{t('inv.iss.to')}</span> <strong>{r.to}</strong>{r.remarks && <span className="sub-line muted small">{r.remarks}</span>}</td>
                <td className="small">{r.items.map((i) => `${i.item} × ${qty(i.quantity)}`).join(', ')}</td>
                <td className="num">{inr(r.totalValue)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.issueType === 'TRANSFER' ? t('inv.iss.newTransfer') : t('inv.iss.new')} subtitle={form?.issueType === 'TRANSFER' ? t('inv.iss.transferSub') : t('inv.iss.sub')} onSubmit={save} submitLabel={form?.issueType === 'TRANSFER' ? t('inv.iss.saveTransfer') : t('inv.iss.save')} busy={busy} error={error} wide>
        {form && opts && <>
          <div className="grid-3">
            <Field id="is-from" label={t('inv.iss.from')} error={errors.fromStoreId}><select id="is-from" value={form.fromStoreId} onChange={(e) => setForm({ ...form, fromStoreId: e.target.value, lines: [emptyItemLine()] })}><option value="">{t('inv.choose')}</option>{opts.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            {form.issueType === 'TRANSFER'
              ? <Field id="is-to" label={t('inv.iss.toStore')} error={errors.toStoreId}><select id="is-to" value={form.toStoreId} onChange={(e) => setForm({ ...form, toStoreId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts.stores.filter((s) => s.id !== form.fromStoreId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              : <>
                <Field id="is-dept" label={t('inv.department')} error={errors.toDepartmentId}><select id="is-dept" value={form.toDepartmentId} onChange={(e) => setForm({ ...form, toDepartmentId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts.departments.filter((d) => !d.campusId || d.campusId === campusOf).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
                <Field id="is-who" label={t('inv.iss.person')} hint={t('inv.optional')} error={errors.issuedToEmployeeId}><select id="is-who" value={form.issuedToEmployeeId} onChange={(e) => setForm({ ...form, issuedToEmployeeId: e.target.value })}><option value="">—</option>{opts.staff.filter((s) => !campusOf || s.campusId === campusOf).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              </>}
          </div>
          <div className="grid-2">
            <Field id="is-date" label={t('inv.date')} error={errors.issueDate}><input id="is-date" type="date" max={todayIST()} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></Field>
            <Field id="is-rem" label={t('inv.remarks')} error={errors.remarks}><input id="is-rem" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
          </div>
          {form.fromStoreId && !stocked.length ? <p className="notice notice-warn"><Icon name="alert" size={16} /> {t('inv.iss.empty')}</p> : (
            <ItemLinesEditor items={stocked} lines={form.lines} setLines={(l) => setForm({ ...form, lines: l })} showRate={false} stockOf={(id) => stock.get(id) ?? '0'} error={errors.items} />
          )}
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.iss.note')}</p>
        </>}
      </Modal>
    </>
  );
}

export default function IssuesPage() {
  return <Suspense fallback={<SkeletonRows rows={4} />}><Issues /></Suspense>;
}
