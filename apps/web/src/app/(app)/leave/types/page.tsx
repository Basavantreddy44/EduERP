'use client';

import { FormEvent, useState } from 'react';
import { PERMISSIONS, leaveTypeSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { FieldErrors, apiErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { LeaveType, useLeaveTypes } from '@/components/leave';

/** Leave types (M3.4): for staff (paid / unpaid, days per year) and for students. */
export default function LeaveTypesPage() {
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const [reload, setReload] = useState(0);
  const types = useLeaveTypes(reload);
  const [editing, setEditing] = useState<LeaveType | 'new-EMPLOYEE' | 'new-STUDENT' | null>(null);
  const canEdit = can(PERMISSIONS.LEAVE_STAFF);

  if (!types) return <SkeletonRows rows={5} />;
  const group = (k: 'EMPLOYEE' | 'STUDENT') => (
    <section className="card leave-type-card" key={k}>
      <div className="panel-head">
        <h2 className="section-title">{k === 'EMPLOYEE' ? t('leave.forStaffTypes') : t('leave.forStudentTypes')}</h2>
        {canEdit && <button type="button" className="btn btn-sm" onClick={() => setEditing(`new-${k}`)}><Icon name="plus" size={15} /> {t('leave.addType')}</button>}
      </div>
      {types.filter((x) => x.appliesTo === k).length === 0 ? <p className="muted small">{t('leave.noTypesYet')}</p> : (
        <ul className="leave-type-list">
          {types.filter((x) => x.appliesTo === k).map((x) => (
            <li key={x.id} className={x.status !== 'ACTIVE' ? 'row-muted' : ''}>
              <span className="mono leave-code">{x.code}</span>
              <span><strong>{x.name}</strong><span className="sub-line muted small">{x.daysPerYear ? t('leave.perYear', { n: x.daysPerYear }) : t('leave.noLimit')}{k === 'EMPLOYEE' ? ` · ${x.isPaid ? t('leave.paid') : t('leave.unpaid')}` : ''}</span></span>
              {x.status !== 'ACTIVE' && <StatusBadge status="INACTIVE" label={t('leave.retired')} />}
              {canEdit && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(x)}><Icon name="edit" size={14} /> {t('common.edit')}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('nav.leaveTypes')} description={t('leave.typesDesc')} />
      {types.length === 0 && !canEdit ? <EmptyState icon="calendar" title={t('leave.noTypesYet')} /> : <div className="grid-2 leave-type-grid">{group('EMPLOYEE')}{group('STUDENT')}</div>}
      {editing && <TypeDialog value={editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); toast(msg); setReload((n) => n + 1); }} />}
    </>
  );
}

function TypeDialog({ value, onClose, onDone }: { value: LeaveType | 'new-EMPLOYEE' | 'new-STUDENT'; onClose: () => void; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const isNew = typeof value === 'string';
  const appliesTo = isNew ? (value.slice(4) as 'EMPLOYEE' | 'STUDENT') : value.appliesTo;
  const [v, setV] = useState({ name: isNew ? '' : value.name, code: isNew ? '' : value.code, isPaid: isNew ? true : value.isPaid, days: isNew ? '' : value.daysPerYear?.toString() ?? '', active: isNew ? true : value.status === 'ACTIVE' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  async function submit(e: FormEvent) {
    e.preventDefault();
    const daysPerYear = v.days.trim() === '' ? null : Number(v.days);
    const body = { name: v.name.trim(), code: v.code.trim(), appliesTo, isPaid: v.isPaid, daysPerYear };
    const r = validate(leaveTypeSchema, body);
    if (!r.ok) return setErrors(r.errors);
    setBusy(true); setError(null);
    try {
      if (isNew) await api('/leave/types', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/leave/types/${value.id}`, { method: 'PATCH', body: JSON.stringify({ name: body.name, isPaid: body.isPaid, daysPerYear, status: v.active ? 'ACTIVE' : 'INACTIVE' }) });
      onDone(t('leave.typeSaved'));
    } catch (err) { const x = apiErrors(err); setErrors(x.fields); setError(x.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? t('leave.addType') : t('leave.editType')} subtitle={appliesTo === 'EMPLOYEE' ? t('leave.forStaffTypes') : t('leave.forStudentTypes')} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
      <div className="grid-2">
        <Field id="lt-name" label={t('leave.typeName')} error={errors.name}><input id="lt-name" value={v.name} maxLength={50} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={appliesTo === 'EMPLOYEE' ? t('leave.typeNamePhStaff') : t('leave.typeNamePhStudent')} /></Field>
        <Field id="lt-code" label={t('leave.code')} error={errors.code}><input id="lt-code" className="mono" value={v.code} maxLength={10} disabled={!isNew} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="CL" /></Field>
        <Field id="lt-days" label={t('leave.daysPerYear')} hint={t('leave.daysPerYearHint')} error={errors.daysPerYear}><input id="lt-days" type="number" min="0.5" step="0.5" inputMode="decimal" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></Field>
      </div>
      {appliesTo === 'EMPLOYEE' && <label className="check"><input type="checkbox" checked={v.isPaid} onChange={(e) => setV({ ...v, isPaid: e.target.checked })} /> {t('leave.paidLabel')}</label>}
      {!isNew && <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {t('leave.inUse')}</label>}
    </Modal>
  );
}
