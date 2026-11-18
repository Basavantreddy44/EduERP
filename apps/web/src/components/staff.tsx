'use client';

import { FormEvent, useEffect, useState } from 'react';
import { EMPLOYEE_TYPES, GENDERS, createEmployeeSchema, updateEmployeeSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Field, Modal } from '@/components/Modal';
import { Icon } from '@/components/Icon';
import { todayIST } from '@/components/admissions';

export interface StaffOptions {
  campuses: { id: string; code: string; name: string }[];
  departments: { id: string; name: string; code: string; campusId: string | null }[];
  counts: Record<string, number>;
}
export interface StaffRow {
  id: string; employeeCode: string; firstName: string; lastName: string | null; nameLocal: string | null; gender: string; phone: string | null; email: string | null;
  designation: string | null; employeeType: string; joiningDate: string; leftOn: string | null; status: string; campusId: string; departmentId: string | null; userId: string | null;
  campus: { code: string; name: string }; department: { name: string; code: string } | null; user: { fullName: string; email: string | null } | null;
}

export function useStaffOptions(reload = 0) {
  const [opts, setOpts] = useState<StaffOptions | null>(null);
  useEffect(() => { api<StaffOptions>('/staff/options').then(setOpts).catch(() => setOpts({ campuses: [], departments: [], counts: {} })); }, [reload]);
  return opts;
}

export const staffName = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();
export const fmtPhone = (p: string) => p.replace(/(\d{5})(\d{5})/, '$1 $2');
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

type Initial = Partial<StaffRow> & { dob?: string | null };

/** Add or edit a staff member. On edit the campus and employee code are fixed. */
export function StaffForm({ opts, initial, defaultCampusId, busy, error, errors, setErrors, onClose, onSave }: {
  opts: StaffOptions; initial?: Initial; defaultCampusId?: string; busy: boolean; error: string | null; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onClose: () => void; onSave: (body: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const editing = !!initial?.id;
  const [v, setV] = useState({
    campusId: initial?.campusId ?? defaultCampusId ?? opts.campuses[0]?.id ?? '',
    employeeCode: initial?.employeeCode ?? '', firstName: initial?.firstName ?? '', lastName: initial?.lastName ?? '', nameLocal: initial?.nameLocal ?? '',
    gender: initial?.gender ?? 'FEMALE', dob: initial?.dob ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '', departmentId: initial?.departmentId ?? '',
    designation: initial?.designation ?? '', employeeType: initial?.employeeType ?? 'TEACHING', joiningDate: initial?.joiningDate ?? todayIST(),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const depts = opts.departments.filter((d) => !d.campusId || d.campusId === v.campusId);

  function submit(e: FormEvent) {
    e.preventDefault();
    const common = {
      firstName: v.firstName.trim(), lastName: orNull(v.lastName), nameLocal: orNull(v.nameLocal), gender: v.gender, dob: orNull(v.dob), phone: orNull(v.phone.replace(/\s/g, '')),
      email: orNull(v.email), departmentId: orNull(v.departmentId), designation: orNull(v.designation), employeeType: v.employeeType, joiningDate: v.joiningDate,
    };
    const body = editing ? common : { ...common, campusId: v.campusId, employeeCode: orNull(v.employeeCode) };
    const r = validate(editing ? updateEmployeeSchema : createEmployeeSchema, body);
    if (!r.ok) return setErrors(r.errors);
    onSave(body);
  }

  return (
    <Modal open wide onClose={onClose} title={editing ? t('staff.edit') : t('staff.add')} subtitle={editing ? `${staffName(initial as StaffRow)} · ${initial?.employeeCode}` : t('staff.addHint')} onSubmit={submit} submitLabel={editing ? t('common.save') : t('staff.addSubmit')} busy={busy} error={error}>
      <>
        <h3 className="form-section"><Icon name="users" size={16} /> {t('staff.personal')}</h3>
        <div className="grid-2">
          <Field id="e-first" label={t('app.firstName')} error={errors.firstName}><input id="e-first" value={v.firstName} onChange={set('firstName')} autoFocus /></Field>
          <Field id="e-last" label={t('app.lastName')} error={errors.lastName}><input id="e-last" value={v.lastName} onChange={set('lastName')} /></Field>
          <Field id="e-local" label={t('app.nameLocal')} error={errors.nameLocal}><input id="e-local" lang="kn" value={v.nameLocal} onChange={set('nameLocal')} /></Field>
          <Field id="e-dob" label={t('staff.dob')} error={errors.dob}><input id="e-dob" type="date" max={todayIST()} value={v.dob ?? ''} onChange={set('dob')} /></Field>
        </div>
        <fieldset className="field">
          <legend className="label">{t('app.gender')}</legend>
          <div className="segmented" role="radiogroup" aria-label={t('app.gender')}>
            {GENDERS.map((g) => <button key={g} type="button" role="radio" aria-checked={v.gender === g} className={v.gender === g ? 'on' : ''} onClick={() => setV({ ...v, gender: g })}>{t(`staff.gender.${g}` as MessageKey)}</button>)}
          </div>
        </fieldset>
      </>

      <>
        <h3 className="form-section"><Icon name="department" size={16} /> {t('staff.work')}</h3>
        <fieldset className="field">
          <legend className="label">{t('staff.type')}</legend>
          <div className="segmented" role="radiogroup" aria-label={t('staff.type')}>
            {EMPLOYEE_TYPES.map((x) => <button key={x} type="button" role="radio" aria-checked={v.employeeType === x} className={v.employeeType === x ? 'on' : ''} onClick={() => setV({ ...v, employeeType: x })}>{t(`staff.type.${x}` as MessageKey)}</button>)}
          </div>
        </fieldset>
        <div className="grid-2">
          {!editing && opts.campuses.length > 1 && (
            <Field id="e-campus" label={t('common.campus')} error={errors.campusId}>
              <select id="e-campus" value={v.campusId} onChange={(e) => setV({ ...v, campusId: e.target.value, departmentId: '' })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
          )}
          {!editing && (
            <Field id="e-code" label={t('staff.code')} hint={t('staff.codeHint')} error={errors.employeeCode}><input id="e-code" className="mono" value={v.employeeCode} onChange={set('employeeCode')} maxLength={20} /></Field>
          )}
          <Field id="e-dept" label={t('staff.department')} error={errors.departmentId}>
            <select id="e-dept" value={v.departmentId} onChange={set('departmentId')}><option value="">—</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </Field>
          <Field id="e-desig" label={t('staff.designation')} error={errors.designation}><input id="e-desig" value={v.designation} onChange={set('designation')} placeholder={t('staff.designationPh')} maxLength={80} /></Field>
          <Field id="e-join" label={t('staff.joining')} error={errors.joiningDate}><input id="e-join" type="date" value={v.joiningDate} onChange={set('joiningDate')} /></Field>
        </div>
      </>

      <>
        <h3 className="form-section"><Icon name="phone" size={16} /> {t('staff.contact')}</h3>
        <div className="grid-2">
          <Field id="e-phone" label={t('staff.mobile')} error={errors.phone}><input id="e-phone" inputMode="numeric" maxLength={11} value={v.phone} onChange={set('phone')} placeholder="98450 12345" /></Field>
          <Field id="e-email" label={t('staff.email')} error={errors.email}><input id="e-email" type="email" value={v.email} onChange={set('email')} /></Field>
        </div>
      </>
    </Modal>
  );
}
