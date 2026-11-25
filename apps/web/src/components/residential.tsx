'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PERMISSIONS, staffMoveSchema, studentMoveSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { useToast } from './ui';
import { todayIST, useDay } from './admissions';

export interface MoveRow { id: string; personType: 'STUDENT' | 'STAFF'; personId: string; name: string; code: string; from: string; to: string; transferDate: string; orderNo: string | null; reason: string }
interface StudentOptions { levelName: string | null; section?: string; holdsBed: boolean; schools: { campusId: string; campus: string; sections: { id: string; name: string; available: number }[] }[] }

/** Phase 21 R2: "Move to another school" on the student page (head office). */
export function StudentMoveButton({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<StudentOptions | null>(null);
  const [f, setF] = useState({ toCampusId: '', sectionId: '', transferDate: todayIST(), orderNo: '', reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  if (!can(PERMISSIONS.STU_TRANSFER)) return null;

  async function start() {
    setOpen(true); setErrors({}); setOpts(null);
    setF({ toCampusId: '', sectionId: '', transferDate: todayIST(), orderNo: '', reason: '' });
    setOpts(await api<StudentOptions>(`/moves/students/${studentId}/options`).catch(() => ({ levelName: null, holdsBed: false, schools: [] })));
  }
  const school = opts?.schools.find((s) => s.campusId === f.toCampusId);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(studentMoveSchema, f);
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      await api(`/moves/students/${studentId}`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(t('mv.studentDone', { school: school?.campus ?? '' }));
      setOpen(false);
      onDone();
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors({ ...fields, ...(message && !Object.keys(fields).length ? { form: message } : {}) });
    } finally {
      setBusy(false);
    }
  }
  const blocked = !!opts && (opts.holdsBed || !opts.levelName || !opts.schools.length);
  return (
    <>
      <button type="button" className="btn" onClick={start}><Icon name="swap" size={16} /> {t('mv.moveSchool')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('mv.studentTitle')} subtitle={opts?.levelName ? t('mv.studentSub', { cls: opts.levelName }) : undefined}
        onSubmit={submit} submitLabel={t('mv.move')} busy={busy} error={errors.form} submitDisabled={!opts || blocked}>
        {!opts ? <p className="muted">{t('common.loading')}…</p> : opts.holdsBed ? (
          <div className="notice notice-warn"><Icon name="alert" />{t('mv.holdsBed')}</div>
        ) : !opts.levelName ? (
          <div className="notice"><Icon name="info" />{t('mv.noClass')}</div>
        ) : !opts.schools.length ? (
          <div className="notice"><Icon name="info" />{t('mv.noSchool', { cls: opts.levelName })}</div>
        ) : (
          <>
            <div className="grid-2">
              <Field id="mv-school" label={t('mv.toSchool')} error={errors.toCampusId}>
                <select id="mv-school" value={f.toCampusId} onChange={(e) => setF({ ...f, toCampusId: e.target.value, sectionId: '' })}>
                  <option value="">{t('mv.choose')}</option>
                  {opts.schools.map((s) => <option key={s.campusId} value={s.campusId}>{s.campus}</option>)}
                </select>
              </Field>
              <Field id="mv-section" label={t('mv.section', { cls: opts.levelName })} error={errors.sectionId}>
                <select id="mv-section" value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })} disabled={!school}>
                  <option value="">{t('mv.choose')}</option>
                  {school?.sections.map((s) => <option key={s.id} value={s.id} disabled={s.available === 0}>{s.name} · {t('mv.seats', { n: s.available })}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid-2">
              <Field id="mv-date" label={t('mv.date')} error={errors.transferDate}><input id="mv-date" type="date" value={f.transferDate} max={todayIST()} onChange={(e) => setF({ ...f, transferDate: e.target.value })} /></Field>
              <Field id="mv-order" label={t('mv.orderNo')} error={errors.orderNo} hint={t('mv.orderHint')}><input id="mv-order" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} /></Field>
            </div>
            <Field id="mv-reason" label={t('mv.reason')} error={errors.reason}><input id="mv-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <p className="muted small">{t('mv.studentKeeps')}</p>
          </>
        )}
      </Modal>
    </>
  );
}

/** Phase 21 R2: "Move to another school" on the staff page (head office). */
export function StaffMoveButton({ employeeId, campusName, onDone }: { employeeId: string; campusName: string; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string; campusId: string | null }[]>([]);
  const [f, setF] = useState({ toCampusId: '', departmentId: '', transferDate: todayIST(), orderNo: '', reason: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  if (!can(PERMISSIONS.HR_TRANSFER)) return null;

  async function start() {
    setOpen(true); setErrors({});
    setF({ toCampusId: '', departmentId: '', transferDate: todayIST(), orderNo: '', reason: '' });
    const [c, d] = await Promise.all([api<{ id: string; name: string }[]>('/campuses').catch(() => []), api<{ id: string; name: string; campusId: string | null }[]>('/departments').catch(() => [])]);
    setCampuses(c.filter((x) => x.name !== campusName));
    setDepts(Array.isArray(d) ? d : []);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validate(staffMoveSchema, { ...f, departmentId: f.departmentId || null });
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      const r = await api<{ hasLogin: boolean }>(`/moves/staff/${employeeId}`, { method: 'POST', body: JSON.stringify(v.data) });
      toast(r.hasLogin ? t('mv.staffDoneLogin') : t('mv.staffDone'));
      setOpen(false);
      onDone();
    } catch (err) {
      const { fields, message } = apiErrors(err);
      setErrors({ ...fields, ...(message && !Object.keys(fields).length ? { form: message } : {}) });
    } finally {
      setBusy(false);
    }
  }
  const choices = depts.filter((d) => !d.campusId || d.campusId === f.toCampusId);
  return (
    <>
      <button type="button" className="btn" onClick={start}><Icon name="swap" /> {t('mv.moveSchool')}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('mv.staffTitle')} onSubmit={submit} submitLabel={t('mv.move')} busy={busy} error={errors.form}>
        <div className="grid-2">
          <Field id="ms-school" label={t('mv.toSchool')} error={errors.toCampusId}>
            <select id="ms-school" value={f.toCampusId} onChange={(e) => setF({ ...f, toCampusId: e.target.value, departmentId: '' })}>
              <option value="">{t('mv.choose')}</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field id="ms-dept" label={t('mv.department')} error={errors.departmentId}>
            <select id="ms-dept" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} disabled={!f.toCampusId}>
              <option value="">{t('mv.noDepartment')}</option>
              {choices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field id="ms-date" label={t('mv.date')} error={errors.transferDate}><input id="ms-date" type="date" value={f.transferDate} onChange={(e) => setF({ ...f, transferDate: e.target.value })} /></Field>
          <Field id="ms-order" label={t('mv.orderNo')} error={errors.orderNo} hint={t('mv.orderHint')}><input id="ms-order" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} /></Field>
        </div>
        <Field id="ms-reason" label={t('mv.reason')} error={errors.reason}><input id="ms-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <p className="muted small">{t('mv.staffAccess')}</p>
      </Modal>
    </>
  );
}

/** The moves of one student or staff member (nothing shown when there are none). */
export function MovesHistory({ kind, id, refresh = 0 }: { kind: 'students' | 'staff'; id: string; refresh?: number }) {
  const { t } = useI18n();
  const day = useDay();
  const [rows, setRows] = useState<MoveRow[]>([]);
  const load = useCallback(() => { api<MoveRow[]>(`/moves/${kind}/${id}`).then(setRows).catch(() => setRows([])); }, [kind, id]);
  useEffect(load, [load, refresh]);
  if (!rows.length) return null;
  return (
    <section className="card moves-card" aria-labelledby={`moves-${id}`}>
      <h2 id={`moves-${id}`} className="card-title">{t('mv.historyTitle')}</h2>
      <ol className="moves-list">
        {rows.map((m) => (
          <li key={m.id}>
            <span className="moves-route"><strong>{m.from}</strong> <Icon name="arrowRight" size={14} /> <strong>{m.to}</strong></span>
            <span className="muted small">{day(m.transferDate)}{m.orderNo ? ` · ${t('mv.order', { no: m.orderNo })}` : ''}</span>
            <span className="small">{m.reason}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
