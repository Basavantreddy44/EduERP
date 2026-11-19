'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees, todayIST } from '@/components/accounts';
import { Breakdown, BreakdownView } from '@/components/payroll';

interface Hist { id: string; structureId: string; structure: string; monthlyGross: string; effectiveFrom: string; effectiveTo: string | null; pf: boolean; esi: boolean; pt: boolean; tdsOverride: string | null; remarks: string | null; by: string | null; overrides: { componentId: string; value: number | null }[] }
interface View { employee: { id: string; name: string; code: string; designation: string | null; joiningDate: string; status: string }; history: Hist[]; preview: Breakdown | null; previewError: string | null; opening: { fy: string; taxablePaid: string | null; tdsDeducted: string | null; remarks: string | null } }
interface Structure { id: string; name: string; isActive: boolean; items: { componentId: string; code: string; name: string; componentType: string; calcType: string; value: number | null }[] }

/** One staff member's salary: current breakdown, history and revisions. */
export default function SalaryPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.PAYROLL_SALARY);
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [structs, setStructs] = useState<Structure[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ structureId: '', monthlyGross: '', effectiveFrom: todayIST(), pfApplicable: true, esiApplicable: true, ptApplicable: true, tdsMonthlyOverride: '', remarks: '' });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Breakdown | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opOpen, setOpOpen] = useState(false);
  const [op, setOp] = useState({ taxablePaid: '', tdsDeducted: '', remarks: '' });
  const saveOpening = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!v) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(`/payroll/salaries/${employeeId}/opening`, { method: 'PUT', body: JSON.stringify({ fy: v.opening.fy, taxablePaid: op.taxablePaid || '0', tdsDeducted: op.tdsDeducted || '0', remarks: op.remarks || null }) }); toast(t('pay.op.saved')); setOpOpen(false); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const load = useCallback(() => { api<View>(`/payroll/salaries/${employeeId}`).then(setV).catch(() => setMissing(true)); }, [employeeId]);
  useEffect(load, [load]);
  useEffect(() => { api<Structure[]>('/payroll/structures').then((s) => setStructs(s.filter((x) => x.isActive))).catch(() => setStructs([])); }, []);
  const struct = structs.find((s) => s.id === form.structureId);
  const editable = (struct?.items ?? []).filter((i) => ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS'].includes(i.calcType));
  const body = () => ({
    employeeId, structureId: form.structureId, monthlyGross: form.monthlyGross, effectiveFrom: form.effectiveFrom, pfApplicable: form.pfApplicable, esiApplicable: form.esiApplicable, ptApplicable: form.ptApplicable,
    tdsMonthlyOverride: form.tdsMonthlyOverride === '' ? null : form.tdsMonthlyOverride, remarks: form.remarks || null,
    overrides: editable.filter((i) => vals[i.componentId] !== undefined && vals[i.componentId] !== '' && Number(vals[i.componentId]) !== i.value).map((i) => ({ componentId: i.componentId, value: Number(vals[i.componentId]) })),
  });
  const start = () => {
    const cur = v?.history.find((h) => !h.effectiveTo);
    const sid = cur?.structureId ?? structs[0]?.id ?? '';
    setForm({ structureId: sid, monthlyGross: cur?.monthlyGross ?? '', effectiveFrom: cur ? todayIST() : (v?.employee.joiningDate ?? todayIST()), pfApplicable: cur?.pf ?? true, esiApplicable: cur?.esi ?? true, ptApplicable: cur?.pt ?? true, tdsMonthlyOverride: cur?.tdsOverride ?? '', remarks: '' });
    setVals(Object.fromEntries((cur?.overrides ?? []).map((o) => [o.componentId, String(o.value ?? '')])));
    setPreview(null); setErrors({}); setError(null); setOpen(true);
  };
  const work = async () => {
    setBusy(true); setErrors({}); setError(null);
    try { setPreview(await api<Breakdown>('/payroll/salaries/preview', { method: 'POST', body: JSON.stringify(body()) })); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); setPreview(null); } finally { setBusy(false); }
  };
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { const r = await api<{ revision: boolean }>('/payroll/salaries', { method: 'POST', body: JSON.stringify(body()) }); toast(r.revision ? t('pay.sal.revised') : t('pay.sal.saved')); setOpen(false); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="users" title={t('pay.sal.notFound')} action={<Link href="/payroll/salaries" className="btn">{t('pay.sal.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const cur = v.history.find((h) => !h.effectiveTo);
  const left = ['RESIGNED', 'TERMINATED'].includes(v.employee.status);
  return (
    <>
      <Link href="/payroll/salaries" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('pay.sal.title')}</Link>
      <PageHeader eyebrow={`${v.employee.code}${v.employee.designation ? ` · ${v.employee.designation}` : ''}`} title={v.employee.name}
        actions={manage && !left && <button type="button" className="btn btn-primary" disabled={!structs.length} onClick={start}><Icon name={cur ? 'edit' : 'plus'} /> {cur ? t('pay.sal.revise') : t('pay.sal.set')}</button>} />
      {!cur ? <EmptyState icon="rupee" title={t('pay.sal.noneYet')} text={t('pay.sal.noneYetHint')} /> : (
        <section className="card p12-block" aria-labelledby="sal-now">
          <h2 id="sal-now" className="section-title">{t('pay.sal.current')} <span className="muted small">· {cur.structure} · {t('pay.sal.fromDate', { d: d(cur.effectiveFrom) })}</span></h2>
          {v.preview ? <BreakdownView b={v.preview} /> : <p className="field-error">{v.previewError}</p>}
          <p className="muted small">{t('pay.sal.fullMonthNote')}</p>
        </section>
      )}
      {cur && (
        <section className="card p12-block" aria-labelledby="sal-op">
          <div className="section-head"><h2 id="sal-op" className="section-title">{t('pay.op.title', { fy: v.opening.fy })}</h2>{manage && <button type="button" className="btn btn-sm" onClick={() => { setOp({ taxablePaid: v.opening.taxablePaid ?? '', tdsDeducted: v.opening.tdsDeducted ?? '', remarks: v.opening.remarks ?? '' }); setErrors({}); setError(null); setOpOpen(true); }}><Icon name="edit" size={16} /> {t('pay.edit')}</button>}</div>
          {v.opening.taxablePaid == null ? <p className="muted small">{t('pay.op.none')}</p> : <dl className="pay-lines"><div><dt>{t('pay.op.taxable')}</dt><dd className="num">{rupees(v.opening.taxablePaid, { paise: true })}</dd></div><div><dt>{t('pay.op.tds')}</dt><dd className="num">{rupees(v.opening.tdsDeducted, { paise: true })}</dd></div></dl>}
        </section>
      )}
      {v.history.length > 0 && (
        <section className="card p12-block" aria-labelledby="sal-hist">
          <h2 id="sal-hist" className="section-title">{t('pay.sal.history')}</h2>
          <ul className="p12-action-list">{v.history.map((h) => (
            <li key={h.id}>
              <span><strong>{rupees(h.monthlyGross)}</strong> <span className="muted small">{t('pay.sal.aMonth')}</span><span className="sub-line muted small">{h.structure} · {d(h.effectiveFrom)} – {h.effectiveTo ? d(h.effectiveTo) : t('pay.sal.now')}{h.by ? ` · ${h.by}` : ''}{h.remarks ? ` · ${h.remarks}` : ''}</span></span>
              <span className="small muted">{[h.pf && 'PF', h.esi && 'ESI', h.pt && 'PT'].filter(Boolean).join(' · ')}{h.tdsOverride != null ? ` · ${t('pay.sal.tdsAt', { amt: rupees(h.tdsOverride) })}` : ''}</span>
            </li>
          ))}</ul>
        </section>
      )}
      <Modal open={opOpen} onClose={() => setOpOpen(false)} title={t('pay.op.title', { fy: v.opening.fy })} subtitle={t('pay.op.sub')} onSubmit={saveOpening} submitLabel={t('pay.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="op-tax" label={t('pay.op.taxable')} hint={t('pay.op.taxableHint')} error={errors.taxablePaid}><input id="op-tax" inputMode="decimal" value={op.taxablePaid} onChange={(e) => setOp((o) => ({ ...o, taxablePaid: e.target.value }))} /></Field>
          <Field id="op-tds" label={t('pay.op.tds')} error={errors.tdsDeducted}><input id="op-tds" inputMode="decimal" value={op.tdsDeducted} onChange={(e) => setOp((o) => ({ ...o, tdsDeducted: e.target.value }))} /></Field>
        </div>
        <Field id="op-rem" label={t('ac2.notes')}><input id="op-rem" value={op.remarks} onChange={(e) => setOp((o) => ({ ...o, remarks: e.target.value }))} /></Field>
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title={cur ? t('pay.sal.revise') : t('pay.sal.set')} subtitle={cur ? t('pay.sal.reviseSub', { d: d(cur.effectiveFrom) }) : t('pay.sal.setSub')} onSubmit={save} submitLabel={t('pay.sal.save')} busy={busy} error={error} wide>
        <div className="grid-3">
          <Field id="sl-struct" label={t('pay.sal.structure')} error={errors.structureId}><select id="sl-struct" value={form.structureId} onChange={(e) => { setForm((f) => ({ ...f, structureId: e.target.value })); setVals({}); setPreview(null); }}>{structs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field id="sl-gross" label={t('pay.sal.gross')} error={errors.monthlyGross}><input id="sl-gross" inputMode="decimal" value={form.monthlyGross} onChange={(e) => { setForm((f) => ({ ...f, monthlyGross: e.target.value })); setPreview(null); }} /></Field>
          <Field id="sl-from" label={t('pay.sal.from')} error={errors.effectiveFrom}><input id="sl-from" type="date" value={form.effectiveFrom} onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))} /></Field>
        </div>
        {editable.length > 0 && (
          <fieldset className="check-group pay-values"><legend>{t('pay.sal.values')}</legend>
            {editable.map((i) => (
              <Field key={i.componentId} id={`sv-${i.code}`} label={`${i.name} (${i.calcType === 'FIXED' ? '₹' : i.calcType === 'PERCENT_OF_BASIC' ? t('pay.pctBasic') : t('pay.pctGross')})`}>
                <input id={`sv-${i.code}`} inputMode="decimal" placeholder={i.value == null ? '' : String(i.value)} value={vals[i.componentId] ?? ''} onChange={(e) => { setVals((x) => ({ ...x, [i.componentId]: e.target.value })); setPreview(null); }} />
              </Field>
            ))}
            <span className="muted small">{t('pay.sal.valuesHint')}</span>
          </fieldset>
        )}
        <fieldset className="check-group"><legend>{t('pay.sal.statutory')}</legend>
          <label className="check"><input type="checkbox" checked={form.pfApplicable} onChange={(e) => { setForm((f) => ({ ...f, pfApplicable: e.target.checked })); setPreview(null); }} /> {t('pay.sal.pf')}</label>
          <label className="check"><input type="checkbox" checked={form.esiApplicable} onChange={(e) => { setForm((f) => ({ ...f, esiApplicable: e.target.checked })); setPreview(null); }} /> {t('pay.sal.esi')}</label>
          <label className="check"><input type="checkbox" checked={form.ptApplicable} onChange={(e) => { setForm((f) => ({ ...f, ptApplicable: e.target.checked })); setPreview(null); }} /> {t('pay.sal.pt')}</label>
        </fieldset>
        <div className="grid-2">
          <Field id="sl-tds" label={t('pay.sal.tdsOverride')} hint={t('pay.sal.tdsHint')} error={errors.tdsMonthlyOverride}><input id="sl-tds" inputMode="decimal" value={form.tdsMonthlyOverride} onChange={(e) => { setForm((f) => ({ ...f, tdsMonthlyOverride: e.target.value })); setPreview(null); }} /></Field>
          <Field id="sl-rem" label={t('ac2.notes')}><input id="sl-rem" value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></Field>
        </div>
        <div className="pay-preview">
          <button type="button" className="btn" disabled={busy || !form.monthlyGross} onClick={() => void work()}><Icon name="eye" /> {t('pay.sal.workOut')}</button>
          {preview && <BreakdownView b={preview} />}
        </div>
      </Modal>
    </>
  );
}
