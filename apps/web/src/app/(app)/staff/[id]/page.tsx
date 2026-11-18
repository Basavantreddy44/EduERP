'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EMPLOYEE_STATUSES, LEFT_STATUSES, changeEmployeeStatusSchema } from '@eduerp/shared';
import { api } from '@/lib/api';
import { FieldErrors, apiErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { initials } from '@/components/students';
import { StaffForm, StaffRow, fmtPhone, staffName, useStaffOptions } from '@/components/staff';

type Staff = StaffRow & { dob: string | null; canManage: boolean };
type Dialog = null | 'edit' | 'status' | 'link';
interface LoginOption { id: string; fullName: string; email: string | null }

/** Staff profile (M3.1): details, edit, status (leaving with the last working day), link to a login. */
export default function StaffProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const opts = useStaffOptions();
  const [s, setS] = useState<Staff | null>(null);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const load = useCallback(() => { api<Staff>(`/staff/${id}`).then(setS).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const open = (d: Dialog) => { setError(null); setErrors({}); setDialog(d); };
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setError(null);
    try { await work(); toast(done); setDialog(null); load(); } catch (e) { const r = apiErrors(e); setErrors(r.fields); setError(r.message); } finally { setBusy(false); }
  }

  if (missing) return <EmptyState icon="search" title={t('staff.notFound')} action={<Link className="btn" href="/staff"><Icon name="chevronRight" className="flip" /> {t('staff.back')}</Link>} />;
  if (!s) return <SkeletonRows rows={8} />;
  const left = (LEFT_STATUSES as readonly string[]).includes(s.status);

  return (
    <>
      <Link href="/staff" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('staff.back')}</Link>

      <section className="card profile-head">
        <span className="avatar avatar-lg" aria-hidden="true">{initials(s)}</span>
        <div className="profile-main">
          <p className="eyebrow">{t('staff.title')}</p>
          <h1 className="page-title">{staffName(s)}</h1>
          {s.nameLocal && <p className="profile-local" lang="kn">{s.nameLocal}</p>}
          <ul className="chips">
            <li className="chip mono"><Icon name="users" size={14} /> {s.employeeCode}</li>
            <li className="chip"><Icon name="department" size={14} /> {s.designation ?? t(`staff.type.${s.employeeType}` as MessageKey)}{s.department ? ` · ${s.department.name}` : ''}</li>
            <li className="chip"><Icon name="campus" size={14} /> {s.campus.name}</li>
            <li><StatusBadge status={s.status} label={t(`staff.status.${s.status}` as MessageKey)} /></li>
          </ul>
        </div>
        {s.canManage && (
          <div className="profile-actions">
            <button type="button" className="btn" onClick={() => open('edit')}><Icon name="edit" size={16} /> {t('staff.edit')}</button>
            <button type="button" className="btn" onClick={() => open('status')}><Icon name="clock" size={16} /> {t('staff.changeStatus')}</button>
          </div>
        )}
        <dl className="profile-facts">
          <div><dt>{t('staff.joining')}</dt><dd>{day(s.joiningDate)}</dd></div>
          {s.leftOn && <div><dt>{t('staff.leftOn')}</dt><dd>{day(s.leftOn)}</dd></div>}
          <div><dt>{t('staff.mobile')}</dt><dd>{s.phone ? <a href={`tel:${s.phone}`}>{fmtPhone(s.phone)}</a> : '—'}</dd></div>
        </dl>
      </section>

      <div className="grid-2 staff-cards">
        <section className="card">
          <h2 className="section-title">{t('staff.details')}</h2>
          <dl className="kv">
            <div><dt>{t('app.gender')}</dt><dd>{t(`staff.gender.${s.gender}` as MessageKey)}</dd></div>
            <div><dt>{t('staff.dob')}</dt><dd>{s.dob ? day(s.dob) : '—'}</dd></div>
            <div><dt>{t('staff.type')}</dt><dd>{t(`staff.type.${s.employeeType}` as MessageKey)}</dd></div>
            <div><dt>{t('staff.department')}</dt><dd>{s.department?.name ?? '—'}</dd></div>
            <div><dt>{t('staff.designation')}</dt><dd>{s.designation ?? '—'}</dd></div>
            <div className="kv-wide"><dt>{t('staff.email')}</dt><dd>{s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : '—'}</dd></div>
          </dl>
        </section>

        <section className="card staff-login">
          <h2 className="section-title">{t('staff.login')}</h2>
          {s.user ? (
            <>
              <p className="staff-login-who"><span className="pill pill-ok"><Icon name="check" size={12} /> {t('staff.hasLogin')}</span> <strong>{s.user.fullName}</strong>{s.user.email && <span className="muted"> · {s.user.email}</span>}</p>
              <p className="muted small">{t('staff.loginHint')}</p>
              {s.canManage && <button type="button" className="btn btn-sm" onClick={() => open('link')}><Icon name="swap" size={15} /> {t('staff.changeLogin')}</button>}
            </>
          ) : (
            <>
              <p className="muted">{t('staff.noLoginText')}</p>
              {s.canManage && !left && <button type="button" className="btn btn-sm" onClick={() => open('link')}><Icon name="lock" size={15} /> {t('staff.linkLogin')}</button>}
            </>
          )}
          {left && s.user && <p className="note-info small"><Icon name="info" size={14} /> {t('staff.leftLoginNote')}</p>}
        </section>
      </div>

      {dialog === 'edit' && opts && (
        <StaffForm opts={opts} initial={s} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)}
          onSave={(body) => void run(() => api(`/staff/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) }), t('staff.saved'))} />
      )}
      {dialog === 'status' && <StatusDialog s={s} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={() => setDialog(null)}
        onSave={(body) => void run(() => api(`/staff/${s.id}/status`, { method: 'POST', body: JSON.stringify(body) }), t('staff.statusSaved'))} />}
      {dialog === 'link' && <LinkDialog s={s} busy={busy} error={error} onClose={() => setDialog(null)}
        onSave={(userId) => void run(() => api(`/staff/${s.id}/user`, { method: 'POST', body: JSON.stringify({ userId }) }), userId ? t('staff.linked') : t('staff.unlinked'))} />}
    </>
  );
}

function StatusDialog({ s, busy, error, errors, setErrors, onClose, onSave }: { s: Staff; busy: boolean; error: string | null; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const choices = EMPLOYEE_STATUSES.filter((x) => x !== s.status);
  const [v, setV] = useState({ status: choices[0] as string, leftOn: todayIST(), reason: '' });
  const leaving = (LEFT_STATUSES as readonly string[]).includes(v.status);
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { status: v.status, leftOn: leaving ? v.leftOn : null, reason: v.reason.trim() };
    const r = validate(changeEmployeeStatusSchema, body);
    if (!r.ok) return setErrors(r.errors);
    onSave(body);
  }
  return (
    <Modal open onClose={onClose} title={t('staff.changeStatus')} subtitle={`${staffName(s)} · ${t(`staff.status.${s.status}` as MessageKey)}`} onSubmit={submit} submitLabel={t('stu.saveStatus')} busy={busy} error={error} danger={v.status === 'TERMINATED'}>
      <fieldset className="field">
        <legend className="label">{t('stu.newStatus')}</legend>
        <div className="choice-list">
          {choices.map((c) => (
            <label key={c} className={`choice ${v.status === c ? 'on' : ''}`}>
              <input type="radio" name="es" checked={v.status === c} onChange={() => setV({ ...v, status: c })} />
              <span><strong>{t(`staff.status.${c}` as MessageKey)}</strong><span className="sub-line muted">{t(`staff.statusHint.${c}` as MessageKey)}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {leaving && (
        <div className="grid-2">
          <Field id="es-date" label={t('staff.leftOn')} error={errors.leftOn}><input id="es-date" type="date" min={s.joiningDate} max={todayIST()} value={v.leftOn} onChange={(e) => setV({ ...v, leftOn: e.target.value })} /></Field>
        </div>
      )}
      <Field id="es-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="es-reason" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
    </Modal>
  );
}

function LinkDialog({ s, busy, error, onClose, onSave }: { s: Staff; busy: boolean; error: string | null; onClose: () => void; onSave: (userId: string | null) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<LoginOption[] | null>(null);
  const [pick, setPick] = useState(s.userId ?? '');
  useEffect(() => { api<LoginOption[]>(`/staff/${s.id}/linkable-users`).then(setList).catch(() => setList([])); }, [s.id]);
  return (
    <Modal open onClose={onClose} title={t('staff.linkLogin')} subtitle={staffName(s)} busy={busy} error={error} submitLabel={pick ? t('staff.linkSubmit') : t('staff.unlinkSubmit')}
      onSubmit={(e) => { e.preventDefault(); onSave(pick || null); }}>
      <p className="muted small">{t('staff.linkHelp')}</p>
      {list === null ? <SkeletonRows rows={2} /> : (
        <Field id="lk-user" label={t('staff.login')}>
          <select id="lk-user" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{t('staff.noLoginOption')}</option>
            {list.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.email ? ` · ${u.email}` : ''}</option>)}
          </select>
        </Field>
      )}
      {list?.length === 0 && <p className="note-info small"><Icon name="info" size={14} /> {t('staff.noLogins')} <Link href="/users">{t('nav.users')}</Link></p>}
    </Modal>
  );
}
