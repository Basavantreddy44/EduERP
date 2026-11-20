'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

interface Pr { id: string; prNo: string; campusId: string; department: string; requestedBy: string; requiredBy: string | null; justification: string; estimatedTotal: string; status: string; items: number; quotations: number; createdAt: string }
const FILTERS = ['', 'SUBMITTED', 'APPROVED', 'ORDERED', 'REJECTED', 'CANCELLED'] as const;

/** Inventory → Purchase requests (M17.2): departments ask for items; approved ones go for quotations. */
function PurchaseRequests() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const opts = useInvOptions();
  const items = useInvItems();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [rows, setRows] = useState<Pr[] | null>(null);
  const [form, setForm] = useState<{ campusId: string; departmentId: string; requiredBy: string; justification: string; lines: ItemLine[] } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Pr[]>(`/inventory/requests${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const start = useCallback(() => {
    setErrors({}); setError(null);
    setForm({ campusId: opts?.campuses[0]?.id ?? '', departmentId: '', requiredBy: '', justification: '', lines: [emptyItemLine()] });
  }, [opts]);
  useEffect(() => { if (params.get('new') && opts && can(PERMISSIONS.INV_REQUEST)) { start(); router.replace('/inventory/requests'); } }, [params, opts, can, start, router]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string; prNo: string; status: string }>('/inventory/requests', { method: 'POST', body: JSON.stringify({ campusId: form.campusId, departmentId: form.departmentId, requiredBy: form.requiredBy || null, justification: form.justification, items: lineItems(form.lines, 'estimatedRate') }) });
      toast(r.status === 'APPROVED' ? t('inv.pr.createdOpen', { no: r.prNo }) : t('inv.pr.createdWait', { no: r.prNo }));
      setForm(null); router.push(`/inventory/requests/${r.id}`);
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.inventory')} title={t('inv.pr.title')} description={t('inv.pr.desc')}
        actions={can(PERMISSIONS.INV_REQUEST) && <button type="button" className="btn btn-primary" onClick={start} disabled={!opts}><Icon name="plus" /> {t('inv.pr.new')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('inv.pr.title')}>
        {FILTERS.map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`inv.st.${x}` as MessageKey) : t('inv.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="clipboard" title={t('inv.pr.none')} text={t('inv.pr.noneHint')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('inv.pr.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('inv.pr.no')}</th><th scope="col">{t('inv.department')}</th><th scope="col">{t('inv.pr.why')}</th><th scope="col" className="num">{t('inv.pr.estimate')}</th><th scope="col" className="num">{t('inv.pr.quotes')}</th><th scope="col">{t('inv.status')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/inventory/requests/${r.id}`} className="mono"><strong>{r.prNo}</strong></Link><span className="sub-line muted small">{fmtDate(locale, r.createdAt)}</span></td>
                <td>{r.department}<span className="sub-line muted small">{r.requestedBy}</span></td>
                <td className="small">{r.justification}<span className="sub-line muted">{t('inv.pr.itemsN', { n: r.items })}{r.requiredBy ? ` · ${t('inv.pr.neededBy', { d: fmtDate(locale, r.requiredBy) })}` : ''}</span></td>
                <td className="num">{inr(r.estimatedTotal)}</td>
                <td className="num">{r.quotations}</td>
                <td><InvPill status={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={t('inv.pr.new')} subtitle={t('inv.pr.sub')} onSubmit={save} submitLabel={t('inv.pr.send')} busy={busy} error={error} wide>
        {form && opts && <>
          <div className="grid-3">
            {opts.campuses.length > 1 && <Field id="pr-campus" label={t('inv.campus')} error={errors.campusId}><select id="pr-campus" value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, departmentId: '' })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field id="pr-dept" label={t('inv.department')} error={errors.departmentId}><select id="pr-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">{t('inv.choose')}</option>{opts.departments.filter((d) => !d.campusId || d.campusId === form.campusId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field id="pr-need" label={t('inv.pr.neededLabel')} error={errors.requiredBy}><input id="pr-need" type="date" min={todayIST()} value={form.requiredBy} onChange={(e) => setForm({ ...form, requiredBy: e.target.value })} /></Field>
          </div>
          <Field id="pr-why" label={t('inv.pr.why')} hint={t('inv.pr.whyHint')} error={errors.justification}><input id="pr-why" value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} /></Field>
          <ItemLinesEditor items={items} lines={form.lines} setLines={(l) => setForm({ ...form, lines: l })} rateLabel={t('inv.pr.estRate')} error={errors.items} />
          <p className="muted small"><Icon name="info" size={14} /> {t('inv.pr.howNote')}</p>
        </>}
      </Modal>
    </>
  );
}

export default function PurchaseRequestsPage() {
  return <Suspense fallback={<SkeletonRows rows={4} />}><PurchaseRequests /></Suspense>;
}
