'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { EQUIPMENT_CONDITIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatTile, useToast } from '@/components/ui';
import { ActPill, fmtDay } from '@/components/activities';

interface Opts { campuses: { id: string; name: string }[]; departments: { id: string; name: string; campusId: string | null }[]; staff: { id: string; name: string; campusId: string }[]; stores: { id: string; name: string; campusId: string }[]; items: { id: string; name: string; itemCode: string }[]; can: { manage: boolean; session: boolean } }
interface Lab { id: string; name: string; campusId: string; campus: string | null; departmentId: string | null; department: string | null; inchargeEmployeeId: string | null; incharge: string | null; assistantEmployeeId: string | null; assistant: string | null; storeId: string | null; store: string | null; capacity: number | null; isActive: boolean; equipment: number; calibrationDue: number; sessionsThisWeek: number; openBreakages: number; can: { manage: boolean; session: boolean } }
interface Equip { id: string; labId: string; lab: string; itemId: string | null; item: string | null; name: string; assetTag: string; quantity: number; condition: string; lastCalibrationDate: string | null; nextCalibrationDate: string | null; notes: string | null; calibration: string | null; can: { manage: boolean } }
type Tab = 'labs' | 'equipment' | 'due';
const blankLab = { campusId: '', name: '', departmentId: '', inchargeEmployeeId: '', assistantEmployeeId: '', storeId: '', capacity: '', isActive: true };
const blankEq = { labId: '', itemId: '', name: '', assetTag: '', quantity: '1', condition: 'WORKING', lastCalibrationDate: '', nextCalibrationDate: '', notes: '' };

/** Labs (M18.1): labs, their equipment register and the calibration due list. */
export default function LabsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('labs');
  const [opts, setOpts] = useState<Opts | null>(null);
  const [labs, setLabs] = useState<Lab[] | null>(null);
  const [equip, setEquip] = useState<Equip[] | null>(null);
  const [labFilter, setLabFilter] = useState('');
  const [lab, setLab] = useState<(typeof blankLab & { id?: string }) | null>(null);
  const [eq, setEq] = useState<(typeof blankEq & { id?: string }) | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { api<Opts>('/labs/options').then(setOpts).catch(() => setOpts(null)); }, []);
  useEffect(() => { api<Lab[]>('/labs').then(setLabs).catch(() => setLabs([])); }, [reload]);
  const loadEquip = useCallback(() => {
    if (tab === 'labs') return;
    setEquip(null);
    const p = new URLSearchParams();
    if (tab === 'due') p.set('due', 'true'); else if (labFilter) p.set('labId', labFilter);
    api<Equip[]>(`/labs/equipment?${p}`).then(setEquip).catch(() => setEquip([]));
  }, [tab, labFilter]);
  useEffect(loadEquip, [loadEquip, reload]);
  const reset = () => { setErrors({}); setError(null); };
  const submit = async (fn: () => Promise<unknown>, close: () => void) => {
    setBusy(true); reset();
    try { await fn(); toast(t('act.saved')); close(); setReload((n) => n + 1); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const saveLab = (e: FormEvent) => {
    e.preventDefault();
    if (!lab) return;
    const { id, ...f } = lab;
    const body = { ...f, departmentId: f.departmentId || null, inchargeEmployeeId: f.inchargeEmployeeId || null, assistantEmployeeId: f.assistantEmployeeId || null, storeId: f.storeId || null, capacity: f.capacity === '' ? null : Number(f.capacity) };
    void submit(() => api(id ? `/labs/${id}` : '/labs', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }), () => setLab(null));
  };
  const saveEq = (e: FormEvent) => {
    e.preventDefault();
    if (!eq) return;
    const { id, ...f } = eq;
    const body = { ...f, itemId: f.itemId || null, quantity: Number(f.quantity || 0), lastCalibrationDate: f.lastCalibrationDate || null, nextCalibrationDate: f.nextCalibrationDate || null, notes: f.notes || null };
    void submit(() => api(id ? `/labs/equipment/${id}` : '/labs/equipment', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }), () => setEq(null));
  };
  const manage = !!opts?.can.manage;
  const due = (labs ?? []).reduce((n, l) => n + l.calibrationDue, 0);
  const staffOf = (campusId: string) => (opts?.staff ?? []).filter((s) => s.campusId === campusId);
  const editLab = (l: Lab) => { reset(); setLab({ id: l.id, campusId: l.campusId, name: l.name, departmentId: l.departmentId ?? '', inchargeEmployeeId: l.inchargeEmployeeId ?? '', assistantEmployeeId: l.assistantEmployeeId ?? '', storeId: l.storeId ?? '', capacity: l.capacity == null ? '' : String(l.capacity), isActive: l.isActive }); };
  return (
    <>
      <PageHeader eyebrow={t('nav.labs')} title={t('lab.title')} description={t('lab.desc')}
        actions={manage && <>
          {tab !== 'labs' && <button type="button" className="btn" onClick={() => { reset(); setEq({ ...blankEq, labId: labFilter || labs?.[0]?.id || '' }); }} disabled={!labs?.length}><Icon name="plus" /> {t('lab.eq.new')}</button>}
          {tab === 'labs' && <button type="button" className="btn btn-primary" onClick={() => { reset(); setLab({ ...blankLab, campusId: opts?.campuses[0]?.id ?? '' }); }}><Icon name="plus" /> {t('lab.new')}</button>}
        </>} />
      <div className="stats pay-stats">
        <StatTile icon="building" label={t('lab.count')} value={labs ? labs.filter((l) => l.isActive).length : '…'} />
        <StatTile icon="calendar" label={t('lab.weekSessions')} value={labs ? labs.reduce((n, l) => n + l.sessionsThisWeek, 0) : '…'} href="/labs/sessions" />
        <StatTile icon="clock" label={t('lab.calDue')} value={labs ? due : '…'} hint={t('lab.calDueHint')} />
        <StatTile icon="alert" label={t('lab.openBreakages')} value={labs ? labs.reduce((n, l) => n + l.openBreakages, 0) : '…'} href="/labs/breakages" />
      </div>
      <div className="tabs" role="tablist" aria-label={t('lab.title')}>
        {(['labs', 'equipment', 'due'] as Tab[]).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`lab.tab.${x}` as MessageKey)}{x === 'due' && due > 0 ? <span className="tab-count">{due}</span> : null}</button>)}
      </div>

      {tab === 'labs' && (!labs ? <SkeletonRows rows={3} /> : !labs.length ? <EmptyState icon="building" title={t('lab.none')} text={t('lab.noneHint')} /> : (
        <div className="act-cards">
          {labs.map((l) => (
            <article key={l.id} className={`card act-card ${l.isActive ? '' : 'muted'}`} aria-labelledby={`lab-${l.id}`}>
              <div className="act-card-head">
                <h2 id={`lab-${l.id}`} className="card-title">{l.name}</h2>
                {l.can.manage && <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: l.name })} onClick={() => editLab(l)}><Icon name="edit" size={14} /></button>}
              </div>
              <p className="muted small">{[l.campus, l.department, l.capacity ? t('lab.seats', { n: l.capacity }) : null, l.isActive ? null : t('act.inactive')].filter(Boolean).join(' · ')}</p>
              <dl className="act-facts">
                <div><dt>{t('lab.incharge')}</dt><dd>{l.incharge ?? '—'}</dd></div>
                <div><dt>{t('lab.assistant')}</dt><dd>{l.assistant ?? '—'}</dd></div>
                <div><dt>{t('lab.store')}</dt><dd>{l.store ?? '—'}</dd></div>
              </dl>
              <div className="act-card-foot">
                <button type="button" className="btn btn-sm" onClick={() => { setLabFilter(l.id); setTab('equipment'); }}>{t('lab.equipmentN', { n: l.equipment })}</button>
                {l.calibrationDue > 0 && <span className="pill pill-warn"><span className="pill-dot" />{t('lab.dueN', { n: l.calibrationDue })}</span>}
                <Link href={`/labs/sessions?lab=${l.id}`} className="btn btn-sm btn-ghost">{t('lab.sessionsN', { n: l.sessionsThisWeek })}</Link>
              </div>
            </article>
          ))}
        </div>
      ))}

      {tab !== 'labs' && (
        <>
          {tab === 'equipment' && <div className="filter-bar card"><label className="inv-f">{t('lab.one')}<select value={labFilter} onChange={(e) => setLabFilter(e.target.value)}><option value="">{t('lab.allLabs')}</option>{labs?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div>}
          {tab === 'due' && <p className="muted">{t('lab.dueHint')}</p>}
          {!equip ? <SkeletonRows rows={4} /> : !equip.length ? <EmptyState icon="check" title={tab === 'due' ? t('lab.noDue') : t('lab.eq.none')} /> : (
            <div className="table-wrap card" role="region" aria-label={t(`lab.tab.${tab}` as MessageKey)} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('lab.eq.name')}</th><th scope="col">{t('lab.one')}</th><th scope="col" className="num">{t('lab.eq.qty')}</th><th scope="col">{t('lab.eq.condition')}</th><th scope="col">{t('lab.eq.nextCal')}</th>{manage && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
                <tbody>{equip.map((x) => (
                  <tr key={x.id}>
                    <td><strong>{x.name}</strong><span className="sub-line muted small"><span className="mono">{x.assetTag}</span>{x.item ? ` · ${x.item}` : ''}</span></td>
                    <td>{x.lab}</td>
                    <td className="num">{x.quantity}</td>
                    <td><ActPill prefix="lab.cond" status={x.condition} /></td>
                    <td>{fmtDay(locale, x.nextCalibrationDate)}{x.calibration && x.calibration !== 'OK' && <span className="sub-line"><ActPill prefix="lab.cal" status={x.calibration} /></span>}{x.lastCalibrationDate && <span className="sub-line muted small">{t('lab.eq.lastOn', { d: fmtDay(locale, x.lastCalibrationDate) })}</span>}</td>
                    {manage && <td>{x.can.manage && <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: x.name })} onClick={() => { reset(); setEq({ id: x.id, labId: x.labId, itemId: x.itemId ?? '', name: x.name, assetTag: x.assetTag, quantity: String(x.quantity), condition: x.condition, lastCalibrationDate: x.lastCalibrationDate ?? '', nextCalibrationDate: x.nextCalibrationDate ?? '', notes: x.notes ?? '' }); }}><Icon name="edit" size={14} /></button>}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal open={!!lab} onClose={() => setLab(null)} title={lab?.id ? t('lab.edit') : t('lab.new')} onSubmit={saveLab} busy={busy} error={error} wide>
        {lab && opts && <>
          <div className="grid-2">
            <Field id="lb-name" label={t('lab.name')} error={errors.name}><input id="lb-name" value={lab.name} placeholder={t('lab.namePh')} onChange={(e) => setLab({ ...lab, name: e.target.value })} /></Field>
            <Field id="lb-campus" label={t('act.campus')} error={errors.campusId}><select id="lb-campus" value={lab.campusId} onChange={(e) => setLab({ ...lab, campusId: e.target.value, inchargeEmployeeId: '', assistantEmployeeId: '', storeId: '' })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          </div>
          <div className="grid-3">
            <Field id="lb-dept" label={t('act.department')} error={errors.departmentId}><select id="lb-dept" value={lab.departmentId} onChange={(e) => setLab({ ...lab, departmentId: e.target.value })}><option value="">—</option>{opts.departments.filter((d) => !d.campusId || d.campusId === lab.campusId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field id="lb-in" label={t('lab.incharge')} error={errors.inchargeEmployeeId}><select id="lb-in" value={lab.inchargeEmployeeId} onChange={(e) => setLab({ ...lab, inchargeEmployeeId: e.target.value })}><option value="">—</option>{staffOf(lab.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field id="lb-as" label={t('lab.assistant')} error={errors.assistantEmployeeId}><select id="lb-as" value={lab.assistantEmployeeId} onChange={(e) => setLab({ ...lab, assistantEmployeeId: e.target.value })}><option value="">—</option>{staffOf(lab.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <div className="grid-2">
            <Field id="lb-store" label={t('lab.store')} hint={t('lab.storeHint')} error={errors.storeId}><select id="lb-store" value={lab.storeId} onChange={(e) => setLab({ ...lab, storeId: e.target.value })}><option value="">—</option>{opts.stores.filter((s) => s.campusId === lab.campusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field id="lb-cap" label={t('lab.capacity')} error={errors.capacity}><input id="lb-cap" inputMode="numeric" value={lab.capacity} onChange={(e) => setLab({ ...lab, capacity: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={lab.isActive} onChange={(e) => setLab({ ...lab, isActive: e.target.checked })} /> {t('act.active')}</label>
        </>}
      </Modal>

      <Modal open={!!eq} onClose={() => setEq(null)} title={eq?.id ? t('lab.eq.edit') : t('lab.eq.new')} subtitle={t('lab.eq.sub')} onSubmit={saveEq} busy={busy} error={error} wide>
        {eq && <>
          <div className="grid-3">
            <Field id="eq-lab" label={t('lab.one')} error={errors.labId}><select id="eq-lab" value={eq.labId} onChange={(e) => setEq({ ...eq, labId: e.target.value })}>{labs?.filter((l) => l.can.manage).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
            <Field id="eq-name" label={t('lab.eq.name')} error={errors.name}><input id="eq-name" value={eq.name} onChange={(e) => setEq({ ...eq, name: e.target.value })} /></Field>
            <Field id="eq-tag" label={t('lab.eq.tag')} hint={t('lab.eq.tagHint')} error={errors.assetTag}><input id="eq-tag" className="mono" value={eq.assetTag} onChange={(e) => setEq({ ...eq, assetTag: e.target.value })} /></Field>
          </div>
          <div className="grid-3">
            <Field id="eq-qty" label={t('lab.eq.qty')} error={errors.quantity}><input id="eq-qty" inputMode="numeric" value={eq.quantity} onChange={(e) => setEq({ ...eq, quantity: e.target.value })} /></Field>
            <Field id="eq-cond" label={t('lab.eq.condition')} error={errors.condition}><select id="eq-cond" value={eq.condition} onChange={(e) => setEq({ ...eq, condition: e.target.value })}>{EQUIPMENT_CONDITIONS.map((c) => <option key={c} value={c}>{t(`lab.cond.${c}` as MessageKey)}</option>)}</select></Field>
            <Field id="eq-item" label={t('lab.eq.item')} hint={t('act.optional')} error={errors.itemId}><select id="eq-item" value={eq.itemId} onChange={(e) => setEq({ ...eq, itemId: e.target.value })}><option value="">—</option>{opts?.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.itemCode}</option>)}</select></Field>
          </div>
          <div className="grid-3">
            <Field id="eq-last" label={t('lab.eq.lastCal')} error={errors.lastCalibrationDate}><input id="eq-last" type="date" value={eq.lastCalibrationDate} onChange={(e) => setEq({ ...eq, lastCalibrationDate: e.target.value })} /></Field>
            <Field id="eq-next" label={t('lab.eq.nextCal')} error={errors.nextCalibrationDate}><input id="eq-next" type="date" value={eq.nextCalibrationDate} onChange={(e) => setEq({ ...eq, nextCalibrationDate: e.target.value })} /></Field>
            <Field id="eq-notes" label={t('act.remarks')} error={errors.notes}><input id="eq-notes" value={eq.notes} onChange={(e) => setEq({ ...eq, notes: e.target.value })} /></Field>
          </div>
        </>}
      </Modal>
    </>
  );
}
