'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { DESIGNATION_CATEGORIES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { CampusPicker } from '@/components/CampusPicker';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Desig { id: string; code: string; name: string; category: string; isActive: boolean; staff: number }
interface Shift { id: string; campusId: string; campus: string; name: string; startTime: string; endTime: string; lateAfterMinutes: number; halfDayAfterMinutes: number; isActive: boolean; staff: number }
interface LType { id: string; code: string; name: string; daysPerYear: number | null; carryForwardMax: number | null; isPaid: boolean }
interface Year { id: string; name: string; isCurrent: boolean; startDate: string }
type Tab = 'designations' | 'shifts' | 'leave';

/** HR → Set-up (M14.1–M14.3): designations, shifts and who works them, leave carry-forward. */
export default function HrSetupPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('designations');
  return (
    <>
      <PageHeader eyebrow={t('nav.hr')} title={t('hr.setup.title')} description={t('hr.setup.desc')} />
      <div className="tabs" role="tablist" aria-label={t('hr.setup.title')}>
        {(['designations', 'shifts', 'leave'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`hr.setup.tab.${x}` as MessageKey)}</button>)}
      </div>
      {tab === 'designations' && <Designations />}
      {tab === 'shifts' && <Shifts />}
      {tab === 'leave' && <LeaveYearEnd />}
    </>
  );
}

function Designations() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const edit0 = can(PERMISSIONS.HR_SETUP);
  const [rows, setRows] = useState<Desig[] | null>(null);
  const [edit, setEdit] = useState<Desig | 'new' | null>(null);
  const [form, setForm] = useState({ code: '', name: '', category: 'TEACHING', isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Desig[]>('/hr/designations').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(edit === 'new' ? '/hr/designations' : `/hr/designations/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(form) }); toast(t('hr.d.saved')); setEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="panel-head"><p className="muted">{t('hr.d.hint')}</p>{edit0 && <button type="button" className="btn btn-primary" onClick={() => { setForm({ code: '', name: '', category: 'TEACHING', isActive: true }); setErrors({}); setError(null); setEdit('new'); }}><Icon name="plus" /> {t('hr.d.add')}</button>}</div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="users" title={t('hr.d.none')} /> : (
        <div className="table-wrap card p12-table">
          <table className="table">
            <thead><tr><th scope="col">{t('common.name')}</th><th scope="col">{t('common.code')}</th><th scope="col">{t('hr.d.category')}</th><th scope="col" className="num">{t('hr.d.staff')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
            <tbody>{rows.map((d) => <tr key={d.id} className={d.isActive ? undefined : 'row-dim'}><td>{d.name}</td><td className="code">{d.code}</td><td>{t(`hr.cat.${d.category}` as MessageKey)}</td><td className="num">{d.staff}</td><td>{edit0 && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.chart.editOf', { name: d.name })} onClick={() => { setForm({ code: d.code, name: d.name, category: d.category, isActive: d.isActive }); setErrors({}); setError(null); setEdit(d); }}><Icon name="edit" size={14} /></button>}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('hr.d.add') : edit ? edit.name : ''} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2"><Field id="d-name" label={t('common.name')} error={errors.name}><input id="d-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('hr.d.namePh')} /></Field><Field id="d-code" label={t('common.code')} error={errors.code}><input id="d-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="TGT" /></Field></div>
        <Field id="d-cat" label={t('hr.d.category')}><select id="d-cat" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>{DESIGNATION_CATEGORIES.map((c) => <option key={c} value={c}>{t(`hr.cat.${c}` as MessageKey)}</option>)}</select></Field>
        {edit !== 'new' && <label className="check"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> {t('ac2.chart.inUse')}</label>}
        {edit !== 'new' && <p className="muted small">{t('hr.d.renameHint')}</p>}
      </Modal>
    </>
  );
}

function Shifts() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const edit0 = can(PERMISSIONS.HR_SETUP);
  const [rows, setRows] = useState<Shift[] | null>(null);
  const [edit, setEdit] = useState<Shift | 'new' | null>(null);
  const [assign, setAssign] = useState<Shift | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string; campusId: string }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Shift[]>('/hr/shifts').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!edit) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(edit === 'new' ? '/hr/shifts' : `/hr/shifts/${edit.id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify(form) }); toast(t('hr.s.saved')); setEdit(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const openAssign = (s: Shift) => {
    api<{ id: string; name: string; campusId: string }[]>(`/hr/staff-options?campusId=${s.campusId}`).then((r) => setStaff(r.filter((x) => x.campusId === s.campusId))).catch(() => setStaff([]));
    setPicked([]); setError(null); setAssign(s);
  };
  const doAssign = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!assign) return;
    setBusy(true); setError(null);
    try { const r = await api<{ assigned: number }>('/hr/shifts/assign', { method: 'POST', body: JSON.stringify({ shiftId: assign.id, employeeIds: picked }) }); toast(t('hr.s.assigned', { n: r.assigned })); setAssign(null); load(); }
    catch (x) { setError(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const f = (k: string) => ({ value: String(form[k] ?? ''), onChange: (e: { target: { value: string } }) => setForm((x) => ({ ...x, [k]: e.target.value })) });
  return (
    <>
      <div className="panel-head"><p className="muted">{t('hr.s.hint')}</p>{edit0 && <button type="button" className="btn btn-primary" onClick={() => { setForm({ campusId: '', name: '', startTime: '08:30', endTime: '15:30', lateAfterMinutes: '10', halfDayAfterMinutes: '120', isActive: true }); setErrors({}); setError(null); setEdit('new'); }}><Icon name="plus" /> {t('hr.s.add')}</button>}</div>
      {!rows ? <SkeletonRows rows={3} /> : !rows.length ? <EmptyState icon="clock" title={t('hr.s.none')} /> : (
        <ul className="p12-committees">{rows.map((s) => (
          <li key={s.id} className={`card${s.isActive ? '' : ' row-dim'}`}>
            <span><strong>{s.name}</strong> <span className="muted">· {s.campus}</span><span className="sub-line small">{s.startTime}–{s.endTime} · {t('hr.s.rules', { late: s.lateAfterMinutes, half: s.halfDayAfterMinutes })}</span><span className="sub-line muted small">{t('hr.s.staffN', { n: s.staff })}</span></span>
            {edit0 && <span className="row-actions"><button type="button" className="btn btn-sm" onClick={() => openAssign(s)}><Icon name="users" size={14} /> {t('hr.s.assign')}</button><button type="button" className="btn btn-sm btn-ghost" aria-label={t('ac2.chart.editOf', { name: s.name })} onClick={() => { setForm({ campusId: s.campusId, name: s.name, startTime: s.startTime, endTime: s.endTime, lateAfterMinutes: String(s.lateAfterMinutes), halfDayAfterMinutes: String(s.halfDayAfterMinutes), isActive: s.isActive }); setErrors({}); setError(null); setEdit(s); }}><Icon name="edit" size={14} /></button></span>}
          </li>
        ))}</ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('hr.s.add') : edit ? edit.name : ''} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2"><Field id="s-name" label={t('common.name')} error={errors.name}><input id="s-name" {...f('name')} placeholder={t('hr.s.namePh')} /></Field><Field id="s-campus" label={t('common.campus')} error={errors.campusId}><CampusPicker id="s-campus" value={String(form.campusId ?? '')} onChange={(v) => setForm((x) => ({ ...x, campusId: v }))} allowInstitution={false} /></Field></div>
        <div className="grid-2"><Field id="s-start" label={t('hr.s.start')} error={errors.startTime}><input id="s-start" type="time" {...f('startTime')} /></Field><Field id="s-end" label={t('hr.s.end')} error={errors.endTime}><input id="s-end" type="time" {...f('endTime')} /></Field></div>
        <div className="grid-2"><Field id="s-late" label={t('hr.s.late')} hint={t('hr.s.lateHint')} error={errors.lateAfterMinutes}><input id="s-late" inputMode="numeric" {...f('lateAfterMinutes')} /></Field><Field id="s-half" label={t('hr.s.half')} hint={t('hr.s.halfHint')} error={errors.halfDayAfterMinutes}><input id="s-half" inputMode="numeric" {...f('halfDayAfterMinutes')} /></Field></div>
        {edit !== 'new' && <label className="check"><input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm((x) => ({ ...x, isActive: e.target.checked }))} /> {t('ac2.chart.inUse')}</label>}
      </Modal>
      <Modal open={!!assign} onClose={() => setAssign(null)} title={t('hr.s.assignTitle', { name: assign?.name ?? '' })} subtitle={assign?.campus} onSubmit={doAssign} submitLabel={t('hr.s.assign')} busy={busy} error={error} submitDisabled={!picked.length}>
        <div className="p12-staff-list">{staff.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} /> {s.name}</label>)}{!staff.length && <p className="muted small">{t('common.noMatches')}</p>}</div>
      </Modal>
    </>
  );
}

function LeaveYearEnd() {
  const { t } = useI18n();
  const { can } = useSession();
  const toast = useToast();
  const edit0 = can(PERMISSIONS.HR_SETUP);
  const [types, setTypes] = useState<LType[] | null>(null);
  const [years, setYears] = useState<Year[]>([]);
  const [run, setRun] = useState({ fromYearId: '', toYearId: '' });
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Year[]>('/academic-years').then((y) => {
      const sorted = [...y].sort((a, b) => a.startDate.localeCompare(b.startDate));
      setYears(sorted);
      const cur = sorted.findIndex((x) => x.isCurrent);
      setRun({ fromYearId: sorted[cur - 1]?.id ?? '', toYearId: sorted[cur]?.id ?? '' });
      const yid = sorted[cur]?.id ?? sorted[0]?.id;
      if (yid) api<{ types: LType[] }>(`/hr/leave-balances?yearId=${yid}`).then((r) => { setTypes(r.types); setLimits(Object.fromEntries(r.types.map((x) => [x.id, x.carryForwardMax == null ? '' : String(x.carryForwardMax)]))); }).catch(() => setTypes([]));
      else setTypes([]);
    }).catch(() => setYears([]));
  }, []);
  useEffect(load, [load]);
  const saveLimit = async (id: string) => { try { await api(`/hr/leave-types/${id}/carry-limit`, { method: 'PUT', body: JSON.stringify({ carryForwardMax: limits[id] === '' ? null : limits[id] }) }); toast(t('hr.ly.limitSaved')); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const carry = async () => {
    setBusy(true);
    try { const r = await api<{ added: number; skipped: number }>('/hr/leave-balances/carry-forward', { method: 'POST', body: JSON.stringify(run) }); toast(t('hr.ly.done', { n: r.added, s: r.skipped })); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (!types) return <SkeletonRows rows={3} />;
  const paid = types.filter((x) => x.isPaid && x.daysPerYear != null);
  return (
    <>
      <section className="card p12-block">
        <h2 className="section-title">{t('hr.ly.limits')}</h2>
        <p className="muted small">{t('hr.ly.limitsHint')}</p>
        {!paid.length ? <p className="muted">{t('hr.lb.noTypes')}</p> : <ul className="p12-action-list">{paid.map((x) => <li key={x.id}><span><strong>{x.name}</strong><span className="sub-line muted small">{t('hr.lb.perYear', { n: String(x.daysPerYear) })}</span></span><span className="row-actions"><label className="p12-inline">{t('hr.ly.carryUpTo')} <input inputMode="decimal" className="hr-num" value={limits[x.id] ?? ''} disabled={!edit0} onChange={(e) => setLimits((l) => ({ ...l, [x.id]: e.target.value }))} aria-label={t('hr.ly.limitOf', { name: x.name })} /></label>{edit0 && <button type="button" className="btn btn-sm" onClick={() => void saveLimit(x.id)}>{t('common.save')}</button>}</span></li>)}</ul>}
      </section>
      <section className="card p12-block">
        <h2 className="section-title">{t('hr.ly.runTitle')}</h2>
        <p className="muted small">{t('hr.ly.runHint')}</p>
        <div className="row-actions">
          <label className="p12-inline">{t('ac2.rep.from')} <select value={run.fromYearId} onChange={(e) => setRun((r) => ({ ...r, fromYearId: e.target.value }))}><option value="">—</option>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
          <label className="p12-inline">{t('ac2.rep.to')} <select value={run.toYearId} onChange={(e) => setRun((r) => ({ ...r, toYearId: e.target.value }))}><option value="">—</option>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
          {edit0 && <button type="button" className="btn btn-primary" disabled={busy || !run.fromYearId || !run.toYearId} onClick={() => void carry()}><Icon name="arrowRight" /> {t('hr.ly.run')}</button>}
        </div>
      </section>
    </>
  );
}
