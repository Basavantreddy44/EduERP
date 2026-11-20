'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import type { Person } from '@/components/campuslife';
import { ActPill, MultiPicker, fmtDay } from '@/components/activities';
import { inr } from '@/components/inventory';

interface Lab { id: string; name: string; isActive: boolean; can: { manage: boolean; session: boolean } }
interface Equip { id: string; labId: string; name: string; assetTag: string; quantity: number }
interface Breakage { id: string; lab: string; itemDescription: string; equipment: string | null; student: string | null; breakageDate: string; quantity: number; chargeAmount: string; status: string; invoiceNo: string | null; waiveReason: string | null; remarks: string | null; reportedBy: string | null; can: { decide: boolean } }
const FILTERS = ['', 'REPORTED', 'PENDING_APPROVAL', 'CHARGED', 'WAIVED'] as const;

/** Labs → Breakages (M18.2): what was broken, by whom; charged to fees (after approval where set) or waived. */
function Breakages() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [equip, setEquip] = useState<Equip[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('');
  const [rows, setRows] = useState<Breakage[] | null>(null);
  const [form, setForm] = useState<{ labId: string; sessionId: string; equipmentId: string; itemDescription: string; student: Person[]; breakageDate: string; quantity: string; chargeAmount: string; markDamaged: boolean; remarks: string } | null>(null);
  const [decide, setDecide] = useState<{ b: Breakage; action: 'CHARGE' | 'WAIVE'; reason: string } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Breakage[]>(`/labs/breakages${filter ? `?status=${filter}` : ''}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  useEffect(() => { api<Lab[]>('/labs').then(setLabs).catch(() => setLabs([])); api<Equip[]>('/labs/equipment').then(setEquip).catch(() => setEquip([])); }, []);
  const reporters = labs.filter((l) => l.isActive && (l.can.session || l.can.manage));
  const start = useCallback((labId?: string, sessionId?: string) => {
    setErrors({}); setError(null);
    setForm({ labId: labId ?? reporters[0]?.id ?? '', sessionId: sessionId ?? '', equipmentId: '', itemDescription: '', student: [], breakageDate: todayIST(), quantity: '1', chargeAmount: '', markDamaged: false, remarks: '' });
  }, [reporters]);
  useEffect(() => { if (params.get('new') && labs.length) { start(params.get('lab') ?? undefined, params.get('session') ?? undefined); router.replace('/labs/breakages'); } }, [params, labs.length, start, router]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ status: string }>('/labs/breakages', { method: 'POST', body: JSON.stringify({ labId: form.labId, sessionId: form.sessionId || null, equipmentId: form.equipmentId || null, itemDescription: form.itemDescription, studentId: form.student[0]?.id ?? null, breakageDate: form.breakageDate, quantity: Number(form.quantity || 1), chargeAmount: form.chargeAmount || '0', markDamaged: form.markDamaged, remarks: form.remarks || null }) });
      toast(r.status === 'WAIVED' ? t('lab.br.savedNoCharge') : t('lab.br.saved')); setForm(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveDecide = async (e: FormEvent) => {
    e.preventDefault();
    if (!decide) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ status: string }>(`/labs/breakages/${decide.b.id}/decide`, { method: 'POST', body: JSON.stringify({ action: decide.action, reason: decide.reason || null }) });
      toast(t(`lab.br.toast.${r.status}` as MessageKey)); setDecide(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow={t('nav.labs')} title={t('lab.br.title')} description={t('lab.br.desc')}
        actions={reporters.length > 0 && <button type="button" className="btn btn-primary" onClick={() => start()}><Icon name="plus" /> {t('lab.br.report')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('lab.br.title')}>
        {FILTERS.map((x) => <button key={x || 'all'} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{x ? t(`lab.br.st.${x}` as MessageKey) : t('act.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="check" title={t('lab.br.none')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('lab.br.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('lab.br.what')}</th><th scope="col">{t('act.student')}</th><th scope="col" className="num">{t('lab.br.amount')}</th><th scope="col">{t('act.status')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id}>
                <td><strong>{b.itemDescription}</strong>{b.quantity > 1 && <span className="muted"> × {b.quantity}</span>}<span className="sub-line muted small">{[b.lab, b.equipment, fmtDay(locale, b.breakageDate), b.reportedBy].filter(Boolean).join(' · ')}</span>{b.remarks && <span className="sub-line small">{b.remarks}</span>}</td>
                <td>{b.student ?? <span className="muted">—</span>}</td>
                <td className="num">{Number(b.chargeAmount) > 0 ? inr(b.chargeAmount) : '—'}</td>
                <td><ActPill prefix="lab.br.st" status={b.status} />{b.invoiceNo && <span className="sub-line muted small mono">{b.invoiceNo}</span>}{b.waiveReason && <span className="sub-line muted small">{b.waiveReason}</span>}</td>
                <td>{b.can.decide && <span className="row-actions">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => { setErrors({}); setError(null); setDecide({ b, action: 'CHARGE', reason: '' }); }}>{t('lab.br.charge')}</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setErrors({}); setError(null); setDecide({ b, action: 'WAIVE', reason: '' }); }}>{t('lab.br.waive')}</button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={t('lab.br.report')} subtitle={t('lab.br.sub')} onSubmit={save} submitLabel={t('lab.br.save')} busy={busy} error={error} wide>
        {form && <>
          <div className="grid-3">
            <Field id="br-lab" label={t('lab.one')} error={errors.labId}><select id="br-lab" value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value, equipmentId: '', sessionId: '' })}>{reporters.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field id="br-eq" label={t('lab.br.equipment')} hint={t('act.optional')} error={errors.equipmentId}><select id="br-eq" value={form.equipmentId} onChange={(e) => { const x = equip.find((q) => q.id === e.target.value); setForm({ ...form, equipmentId: e.target.value, itemDescription: form.itemDescription || (x ? x.name : '') }); }}><option value="">—</option>{equip.filter((q) => q.labId === form.labId).map((q) => <option key={q.id} value={q.id}>{q.name} ({q.assetTag})</option>)}</select></Field>
            <Field id="br-date" label={t('act.date')} error={errors.breakageDate}><input id="br-date" type="date" max={todayIST()} value={form.breakageDate} onChange={(e) => setForm({ ...form, breakageDate: e.target.value })} /></Field>
          </div>
          <div className="grid-2">
            <Field id="br-what" label={t('lab.br.what')} error={errors.itemDescription}><input id="br-what" value={form.itemDescription} placeholder={t('lab.br.whatPh')} onChange={(e) => setForm({ ...form, itemDescription: e.target.value })} /></Field>
            <Field id="br-qty" label={t('lab.eq.qty')} error={errors.quantity}><input id="br-qty" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          </div>
          <Field id="br-stu" label={t('act.student')} hint={t('lab.br.studentHint')} error={errors.studentId}><MultiPicker endpoint="/labs/people" value={form.student} onChange={(p) => setForm({ ...form, student: p })} inputId="br-stu" placeholder={t('act.findStudent')} single /></Field>
          <div className="grid-2">
            <Field id="br-amt" label={t('lab.br.amountLabel')} hint={t('lab.br.amountHint')} error={errors.chargeAmount}><input id="br-amt" inputMode="decimal" value={form.chargeAmount} onChange={(e) => setForm({ ...form, chargeAmount: e.target.value })} /></Field>
            <Field id="br-rem" label={t('act.remarks')} error={errors.remarks}><input id="br-rem" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
          </div>
          {form.equipmentId && <label className="check"><input type="checkbox" checked={form.markDamaged} onChange={(e) => setForm({ ...form, markDamaged: e.target.checked })} /> {t('lab.br.markDamaged')}</label>}
        </>}
      </Modal>

      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.action === 'CHARGE' ? t('lab.br.chargeTitle', { amt: inr(decide.b.chargeAmount) }) : t('lab.br.waiveTitle')} subtitle={decide ? `${decide.b.itemDescription} · ${decide.b.student ?? ''}` : undefined} onSubmit={saveDecide} submitLabel={decide?.action === 'CHARGE' ? t('lab.br.charge') : t('lab.br.waive')} busy={busy} error={error}>
        {decide && (decide.action === 'CHARGE'
          ? <p className="muted">{t('lab.br.chargeNote')}</p>
          : <Field id="dc-r" label={t('lab.br.waiveWhy')} error={errors.reason}><input id="dc-r" value={decide.reason} onChange={(e) => setDecide({ ...decide, reason: e.target.value })} /></Field>)}
      </Modal>
    </>
  );
}

export default function LabBreakagesPage() {
  return <Suspense fallback={<SkeletonRows rows={4} />}><Breakages /></Suspense>;
}
