'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { applyLeaveSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { FieldErrors, apiErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { todayIST } from '@/components/admissions';

export interface LeaveType { id: string; name: string; code: string; appliesTo: 'STUDENT' | 'EMPLOYEE'; isPaid: boolean; daysPerYear: number | null; status: string }
export interface Balance { applicant: { id: string; name: string; code: string }; year: string | null; types: { id: string; name: string; code: string; isPaid: boolean; allowed: number | null; taken: number; waiting: number; left: number | null }[] }
export interface PersonPick { id: string; label: string; sub: string }
type Pick = PersonPick;

export function useLeaveTypes(reload = 0) {
  const [types, setTypes] = useState<LeaveType[] | null>(null);
  useEffect(() => { api<LeaveType[]>('/leave/types').then(setTypes).catch(() => setTypes([])); }, [reload]);
  return types;
}

/** Searchable person picker (students or staff) for applying on someone's behalf. */
export function PersonSearch({ kind, value, onPick, deskCampusId, inputId = 'lv-who' }: { kind: 'STUDENT' | 'EMPLOYEE'; value: Pick | null; onPick: (p: Pick | null) => void; /** Front desk: search the campus’s students without student-record rights. */ deskCampusId?: string; inputId?: string }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Pick[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const h = window.setTimeout(() => {
      if (kind === 'STUDENT' && deskCampusId) {
        api<{ id: string; name: string; admissionNo: string }[]>(`/front-office/students?campusId=${deskCampusId}&q=${encodeURIComponent(q)}`)
          .then((r) => setHits(r.map((s) => ({ id: s.id, label: s.name, sub: s.admissionNo })))).catch(() => setHits([]));
      } else if (kind === 'STUDENT') {
        api<{ items: { id: string; firstName: string; lastName: string | null; admissionNo: string; levelName: string | null; sectionName: string | null }[] }>(`/students?q=${encodeURIComponent(q)}&status=ACTIVE&pageSize=8`)
          .then((r) => setHits(r.items.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName ?? ''}`.trim(), sub: `${s.admissionNo}${s.levelName ? ` · ${s.levelName} – ${s.sectionName}` : ''}` })))).catch(() => setHits([]));
      } else {
        api<{ items: { id: string; firstName: string; lastName: string | null; employeeCode: string; designation: string | null }[] }>(`/staff?q=${encodeURIComponent(q)}&status=ACTIVE&pageSize=8`)
          .then((r) => setHits(r.items.map((s) => ({ id: s.id, label: `${s.firstName} ${s.lastName ?? ''}`.trim(), sub: `${s.employeeCode}${s.designation ? ` · ${s.designation}` : ''}` })))).catch(() => setHits([]));
      }
    }, 250);
    return () => window.clearTimeout(h);
  }, [q, kind, deskCampusId]);
  if (value) {
    return (
      <div className="leave-picked">
        <span><strong>{value.label}</strong><span className="sub-line muted small">{value.sub}</span></span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPick(null)}><Icon name="x" size={14} /> {t('leave.change')}</button>
      </div>
    );
  }
  return (
    <div className="leave-search">
      <input id={inputId} className="input" type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'STUDENT' ? t('leave.findStudent') : t('leave.findStaff')} />
      {hits.length > 0 && (
        <ul className="leave-hits" role="listbox" aria-label={t('leave.results')}>
          {hits.map((h) => <li key={h.id}><button type="button" role="option" aria-selected={false} onClick={() => { onPick(h); setQ(''); }}><strong>{h.label}</strong><span className="muted small">{h.sub}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

/** Apply for leave: for yourself (staff), or for a chosen student / staff member. */
export function ApplyLeaveDialog({ kind, self, types, onClose, onDone }: { kind: 'STUDENT' | 'EMPLOYEE'; self: boolean; types: LeaveType[]; onClose: () => void; onDone: (status: string) => void }) {
  const { t } = useI18n();
  const options = useMemo(() => types.filter((x) => x.appliesTo === kind && x.status === 'ACTIVE'), [types, kind]);
  const [who, setWho] = useState<Pick | null>(null);
  const [v, setV] = useState({ leaveTypeId: options[0]?.id ?? '', fromDate: todayIST(), toDate: todayIST(), halfDay: false, reason: '' });
  const [balance, setBalance] = useState<Balance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => {
    if (!self && !who) { setBalance(null); return; }
    api<Balance>(`/leave/balance?applicantType=${kind}${who ? `&id=${who.id}` : ''}`).then(setBalance).catch(() => setBalance(null));
  }, [self, who, kind]);
  const chosen = balance?.types.find((x) => x.id === v.leaveTypeId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!self && !who) return setErrors({ who: kind === 'STUDENT' ? t('leave.pickStudent') : t('leave.pickStaff') });
    const body = { applicantType: kind, ...(kind === 'STUDENT' ? { studentId: who!.id } : { employeeId: self ? null : who!.id }), leaveTypeId: v.leaveTypeId, fromDate: v.fromDate, toDate: v.halfDay ? v.fromDate : v.toDate, halfDay: v.halfDay, reason: v.reason.trim() };
    const r = validate(applyLeaveSchema, body);
    if (!r.ok) return setErrors(r.errors);
    setBusy(true); setError(null);
    try { const res = await api<{ status: string }>('/leave/requests', { method: 'POST', body: JSON.stringify(body) }); onDone(res.status); }
    catch (err) { const x = apiErrors(err); setErrors(x.fields); setError(x.message); } finally { setBusy(false); }
  }

  return (
    <Modal open wide onClose={onClose} title={self ? t('leave.applyMine') : kind === 'STUDENT' ? t('leave.applyStudent') : t('leave.applyStaff')} onSubmit={submit} submitLabel={t('leave.submit')} busy={busy} error={error}>
      {!self && (
        <div className="field">
          <label htmlFor="lv-who">{kind === 'STUDENT' ? t('stu.col.student') : t('staff.title')}</label>
          <PersonSearch kind={kind} value={who} onPick={setWho} />
          {errors.who && <span className="err">{errors.who}</span>}
        </div>
      )}
      {options.length === 0 ? <p className="note-info"><Icon name="info" size={15} /> {t('leave.noTypes')}</p> : (
        <fieldset className="field">
          <legend className="label">{t('leave.type')}</legend>
          <div className="choice-list leave-types">
            {options.map((o) => {
              const b = balance?.types.find((x) => x.id === o.id);
              return (
                <label key={o.id} className={`choice ${v.leaveTypeId === o.id ? 'on' : ''}`}>
                  <input type="radio" name="lt" checked={v.leaveTypeId === o.id} onChange={() => setV({ ...v, leaveTypeId: o.id })} />
                  <span><strong>{o.name}</strong><span className="sub-line muted">{b && b.left !== null ? t('leave.daysLeft', { n: b.left, of: b.allowed ?? 0 }) : o.daysPerYear ? t('leave.perYear', { n: o.daysPerYear }) : t('leave.noLimit')}{kind === 'EMPLOYEE' && !o.isPaid ? ` · ${t('leave.unpaid')}` : ''}</span></span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <label className="check leave-half"><input type="checkbox" checked={v.halfDay} onChange={(e) => setV({ ...v, halfDay: e.target.checked, toDate: v.fromDate })} /> {t('leave.halfDay')}</label>
      <div className="grid-2">
        <Field id="lv-from" label={v.halfDay ? t('common.date') : t('leave.from')} error={errors.fromDate}><input id="lv-from" type="date" value={v.fromDate} onChange={(e) => setV({ ...v, fromDate: e.target.value, toDate: e.target.value > v.toDate || v.halfDay ? e.target.value : v.toDate })} /></Field>
        {!v.halfDay && <Field id="lv-to" label={t('leave.to')} error={errors.toDate}><input id="lv-to" type="date" min={v.fromDate} value={v.toDate} onChange={(e) => setV({ ...v, toDate: e.target.value })} /></Field>}
      </div>
      <Field id="lv-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="lv-reason" rows={2} maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={kind === 'STUDENT' ? t('leave.reasonPhStudent') : t('leave.reasonPhStaff')} /></Field>
      <p className="note-info"><Icon name="info" size={15} /> {t('leave.daysNote')}{chosen?.left !== null && chosen ? ` ${t('leave.balanceNote', { n: chosen.left ?? 0 })}` : ''}</p>
    </Modal>
  );
}
