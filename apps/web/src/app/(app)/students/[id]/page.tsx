'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  BLOOD_GROUPS, CATEGORIES, CONDUCT_OPTIONS, GENDERS, GUARDIAN_RELATIONS, MANUAL_STUDENT_STATUSES, PERMISSIONS, addGuardianSchema, changeSectionSchema, changeStudentStatusSchema,
  issueTcSchema, updateGuardianSchema, updateStudentSchema, formatINR, toPaise,
} from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { Documents } from '@/components/Documents';
import { StudentFees } from '@/components/StudentFees';
import { EmptyState, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { SeatOption, SeatPicker, ageOn, initials, studentName } from '@/components/students';

interface Sibling { id: string; admissionNo: string; firstName: string; lastName: string | null; status: string }
interface GuardianLink {
  guardianId: string; relation: string; isPrimary: boolean;
  guardian: { id: string; name: string; phone: string | null; email: string | null; occupation: string | null };
  siblings: Sibling[];
}
interface Enrolment {
  id: string; status: string; rollNo: string | null; enrolledOn: string; endedOn: string | null; remarks: string | null;
  academicYear: { id: string; name: string; isCurrent: boolean; status: string };
  section: { id: string; name: string; level: { id: string; name: string; program: { id: string; name: string } } };
}
interface History { id: string; oldStatus: string | null; newStatus: string; effectiveDate: string; reason: string; createdAt: string; byName: string | null }
interface Student {
  id: string; admissionNo: string; firstName: string; lastName: string | null; nameLocal: string | null; dob: string; gender: string; category: string | null;
  religion: string | null; motherTongue: string | null; aadhaarLast4: string | null; bloodGroup: string | null; apaarId: string | null; address: string | null;
  admissionDate: string; status: string; campusId: string; campus: { id: string; code: string; name: string };
  enrollments: Enrolment[]; guardians: GuardianLink[]; statusHistory: History[]; applications: { id: string; applicationNo: string }[]; canManage: boolean;
}
interface TcLite { id: string; tcNo: string; issueDate: string; status: string }
interface NoDues { clear: boolean; balance: string; pendingRefunds: number; openBills: { invoiceNo: string; description: string; balanceAmount: string }[] }
interface Lookup { id: string; name: string; phone: string; children: (Sibling & { relation: string })[]; otherChildren: number }

type Tab = 'details' | 'parents' | 'class' | 'history' | 'fees' | 'documents';
type Dialog = null | 'edit' | 'status' | 'section' | 'addParent' | 'tc' | { editParent: GuardianLink } | { removeParent: GuardianLink };

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
const fmtPhone = (p: string) => p.replace(/(\d{5})(\d{5})/, '$1 $2');

export default function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, hasModule } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [s, setS] = useState<Student | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>('details');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [tcs, setTcs] = useState<TcLite[]>([]);
  const router = useRouter();

  const load = useCallback(() => {
    api<Student>(`/students/${id}`).then(setS).catch(() => setMissing(true));
    api<TcLite[]>(`/students/${id}/tcs`).then(setTcs).catch(() => setTcs([]));
  }, [id]);
  useEffect(load, [load]);

  const open = (d: Dialog) => { setError(null); setErrors({}); setDialog(d); };
  const close = () => setDialog(null);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      toast(done);
      close();
      load();
    } catch (e) {
      const r = apiErrors(e);
      setErrors(r.fields);
      setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <EmptyState icon="search" title={t('stu.notFound')} action={<Link className="btn" href="/students"><Icon name="chevronRight" className="flip" /> {t('stu.back')}</Link>} />;
  if (!s) return <SkeletonRows rows={8} />;

  const current = s.enrollments.find((e) => e.status === 'ACTIVE' && e.academicYear.isCurrent) ?? s.enrollments.find((e) => e.status === 'ACTIVE');
  const primary = s.guardians.find((g) => g.isPrimary);
  const manage = s.canManage;
  const left = ['TRANSFERRED', 'PASSED_OUT'].includes(s.status);
  const issuedTc = tcs.find((x) => x.status === 'ISSUED');
  const canTc = can(PERMISSIONS.STU_TC_ISSUE) && !issuedTc && s.status !== 'TRANSFERRED' && s.status !== 'DROPPED';
  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'details', label: t('stu.tab.details') },
    { key: 'parents', label: t('stu.tab.parents'), count: s.guardians.length },
    { key: 'class', label: t('stu.tab.class'), count: s.enrollments.length },
    { key: 'history', label: t('stu.tab.history'), count: s.statusHistory.length },
    ...(can(PERMISSIONS.FEE_READ) && hasModule('FEES') ? [{ key: 'fees' as Tab, label: t('nav.fees') }] : []),
    ...(can(PERMISSIONS.FILES_FILE_READ) ? [{ key: 'documents' as Tab, label: t('app.docs.title') }] : []),
  ];

  return (
    <>
      <Link href="/students" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('stu.back')}</Link>

      <section className="card profile-head">
        <span className="avatar avatar-lg" aria-hidden="true">{initials(s)}</span>
        <div className="profile-main">
          <p className="eyebrow">{t('nav.students')}</p>
          <h1 className="page-title">{studentName(s)}</h1>
          {s.nameLocal && <p className="profile-local" lang="kn">{s.nameLocal}</p>}
          <ul className="chips">
            <li className="chip mono"><Icon name="cap" size={14} /> {s.admissionNo}</li>
            {current ? (
              <li className="chip"><Icon name="layers" size={14} /> {current.section.level.name} – {current.section.name}{current.rollNo ? ` · ${t('stu.roll')} ${current.rollNo}` : ''}</li>
            ) : <li className="chip muted">{t('stu.noClass')}</li>}
            <li className="chip"><Icon name="campus" size={14} /> {s.campus.name}</li>
            <li><StatusBadge status={s.status} /></li>
          </ul>
        </div>
        {(manage || canTc || issuedTc) && (
          <div className="profile-actions">
            {manage && <button type="button" className="btn" onClick={() => open('edit')}><Icon name="edit" size={16} /> {t('stu.edit')}</button>}
            {manage && current && ['ACTIVE', 'INACTIVE'].includes(s.status) && <button type="button" className="btn" onClick={() => open('section')}><Icon name="swap" size={16} /> {t('stu.changeSection')}</button>}
            {manage && !left && <button type="button" className="btn" onClick={() => open('status')}><Icon name="clock" size={16} /> {t('stu.changeStatus')}</button>}
            {issuedTc ? <Link className="btn" href={`/transfer-certificates/${issuedTc.id}`}><Icon name="file" size={16} /> {t('stu.tc.view', { no: issuedTc.tcNo })}</Link>
              : canTc && <button type="button" className="btn" onClick={() => open('tc')}><Icon name="file" size={16} /> {t('stu.tc.issue')}</button>}
          </div>
        )}
        <dl className="profile-facts">
          <div><dt>{t('stu.age')}</dt><dd>{t('stu.years', { n: ageOn(s.dob) })}</dd></div>
          <div><dt>{t('stu.admittedOn')}</dt><dd>{day(s.admissionDate)}</dd></div>
          <div><dt>{t('stu.mainContact')}</dt><dd>{primary?.guardian.phone ? <a href={`tel:${primary.guardian.phone}`}>{primary.guardian.name} · {fmtPhone(primary.guardian.phone)}</a> : '—'}</dd></div>
        </dl>
      </section>

      <div className="tabs scroll" role="tablist" aria-label={t('stu.title')}>
        {TABS.map((x) => (
          <button key={x.key} id={`tab-${x.key}`} role="tab" type="button" aria-selected={tab === x.key} aria-controls={`panel-${x.key}`} className={`tab ${tab === x.key ? 'on' : ''}`} onClick={() => setTab(x.key)}>
            {x.label}{x.count !== undefined && <span className="tab-count">{x.count}</span>}
          </button>
        ))}
      </div>

      <section className="card" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'details' && (
          <dl className="kv">
            <div><dt>{t('adm.dob')}</dt><dd>{day(s.dob)}</dd></div>
            <div><dt>{t('app.gender')}</dt><dd>{t(`gender.${s.gender}` as MessageKey)}</dd></div>
            <div><dt>{t('app.category')}</dt><dd>{s.category ? t(`category.${s.category}` as MessageKey) : '—'}</dd></div>
            <div><dt>{t('stu.bloodGroup')}</dt><dd>{s.bloodGroup ?? '—'}</dd></div>
            <div><dt>{t('app.religion')}</dt><dd>{s.religion ?? '—'}</dd></div>
            <div><dt>{t('app.motherTongue')}</dt><dd>{s.motherTongue ?? '—'}</dd></div>
            <div><dt>{t('app.aadhaar')}</dt><dd className="mono">{s.aadhaarLast4 ? `•••• •••• ${s.aadhaarLast4}` : '—'}</dd></div>
            <div><dt>{t('stu.apaar')}</dt><dd className="mono">{s.apaarId ?? '—'}</dd></div>
            <div><dt>{t('stu.admittedOn')}</dt><dd>{day(s.admissionDate)}</dd></div>
            <div><dt>{t('common.campus')}</dt><dd>{s.campus.name} ({s.campus.code})</dd></div>
            {s.address && <div className="kv-wide"><dt>{t('app.address')}</dt><dd>{s.address}</dd></div>}
            {s.applications.length > 0 && (
              <div><dt>{t('stu.application')}</dt><dd>{can(PERMISSIONS.ADM_APPLICATION_MANAGE) ? <Link href={`/admissions/applications?open=${s.applications[0].id}`}>{s.applications[0].applicationNo}</Link> : s.applications[0].applicationNo}</dd></div>
            )}
          </dl>
        )}

        {tab === 'parents' && (
          <>
            <div className="panel-head">
              <p className="muted small">{t('stu.parentsHint')}</p>
              {manage && <button type="button" className="btn btn-sm" onClick={() => open('addParent')}><Icon name="plus" size={15} /> {t('stu.addParent')}</button>}
            </div>
            {s.guardians.length === 0 ? <p className="muted">{t('stu.noParents')}</p> : (
              <div className="parent-grid">
                {s.guardians.map((g) => (
                  <article key={g.guardianId} className={`parent-card ${g.isPrimary ? 'primary' : ''}`}>
                    <header>
                      <span className="avatar avatar-sm" aria-hidden="true">{g.guardian.name.charAt(0).toUpperCase()}</span>
                      <span>
                        <strong>{g.guardian.name}</strong>
                        <span className="sub-line muted">{t(`stu.rel.${g.relation}` as MessageKey)}{g.guardian.occupation ? ` · ${g.guardian.occupation}` : ''}</span>
                      </span>
                      {g.isPrimary && <span className="role-tag">{t('stu.mainContact')}</span>}
                    </header>
                    <ul className="parent-contact">
                      {g.guardian.phone && <li><Icon name="phone" size={14} /> <a href={`tel:${g.guardian.phone}`}>{fmtPhone(g.guardian.phone)}</a></li>}
                      {g.guardian.email && <li><Icon name="mail" size={14} /> {g.guardian.email}</li>}
                      {!g.guardian.phone && !g.guardian.email && <li className="muted">{t('stu.noContact')}</li>}
                    </ul>
                    {g.siblings.length > 0 && (
                      <p className="siblings small">
                        <Icon name="users" size={14} /> {t('stu.alsoParentOf')}{' '}
                        {g.siblings.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={`/students/${x.id}`}>{studentName(x)}</Link></span>)}
                      </p>
                    )}
                    {manage && (
                      <footer>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => open({ editParent: g })}><Icon name="edit" size={14} /> {t('stu.editParent')}</button>
                        {!g.isPrimary && g.guardian.phone && (
                          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api(`/students/${s.id}/guardians/${g.guardianId}`, { method: 'PATCH', body: JSON.stringify({ isPrimary: true }) }), t('stu.madeMain', { name: g.guardian.name }))}>
                            <Icon name="star" size={14} /> {t('stu.makeMain')}
                          </button>
                        )}
                        {!g.isPrimary && <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => open({ removeParent: g })}><Icon name="x" size={14} /> {t('stu.remove')}</button>}
                      </footer>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'class' && (
          s.enrollments.length === 0 ? <p className="muted">{t('stu.noClassHistory')}</p> : (
            <ol className="timeline">
              {s.enrollments.map((e) => (
                <li key={e.id} className={e.status === 'ACTIVE' ? 'on' : ''}>
                  <span className="timeline-dot" aria-hidden />
                  <div>
                  <div className="timeline-head">
                    <strong>{e.section.level.name} – {e.section.name}</strong>
                    <StatusBadge status={e.status} label={t(`stu.enr.${e.status}` as MessageKey) !== `stu.enr.${e.status}` ? t(`stu.enr.${e.status}` as MessageKey) : undefined} />
                  </div>
                  <p className="small muted">
                    {e.section.level.program.name} · {e.academicYear.name} · {day(e.enrolledOn)} – {e.endedOn ? day(e.endedOn) : t('stu.now')}
                    {e.rollNo ? ` · ${t('stu.roll')} ${e.rollNo}` : ''}
                  </p>
                  {e.remarks && <p className="small">{e.remarks}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )
        )}

        {tab === 'history' && (
          <ol className="timeline">
            {s.statusHistory.map((h) => (
              <li key={h.id}>
                <span className="timeline-dot" aria-hidden />
                <div>
                <div className="timeline-head">
                  {h.oldStatus ? (
                    <span className="status-change"><StatusBadge status={h.oldStatus} /> <Icon name="arrowRight" size={14} /> <StatusBadge status={h.newStatus} /></span>
                  ) : <StatusBadge status={h.newStatus} />}
                  <span className="small muted">{t('stu.from', { date: day(h.effectiveDate) })}</span>
                </div>
                <p className="small">{h.reason}</p>
                <p className="small muted">{h.byName ? t('stu.recordedBy', { name: h.byName, date: day(h.createdAt) }) : day(h.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {tab === 'fees' && <StudentFees studentId={s.id} />}

        {tab === 'documents' && (
          <Documents
            campusId={s.campusId}
            canAttach={manage}
            sources={[{ entityType: 'STUDENT', entityId: s.id }, ...s.applications.map((a) => ({ entityType: 'APPLICATION' as const, entityId: a.id, label: t('stu.fromApplication', { no: a.applicationNo }) }))]}
          />
        )}
      </section>

      {dialog === 'edit' && <EditDialog s={s} current={current} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(() => api(`/students/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) }), t('stu.saved'))} />}
      {dialog === 'status' && <StatusDialog s={s} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(() => api(`/students/${s.id}/status`, { method: 'POST', body: JSON.stringify(body) }), t('stu.statusSaved'))} />}
      {dialog === 'section' && current && <SectionDialog s={s} current={current} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(() => api(`/students/${s.id}/section`, { method: 'POST', body: JSON.stringify(body) }), t('stu.sectionSaved'))} />}
      {dialog === 'tc' && (
        <TcDialog s={s} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(async () => {
          const tc = await api<{ id: string; tcNo: string }>(`/students/${s.id}/tc`, { method: 'POST', body: JSON.stringify(body) });
          router.push(`/transfer-certificates/${tc.id}`);
        }, t('stu.tc.issuedToast'))} />
      )}
      {dialog === 'addParent' && <AddParentDialog s={s} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(() => api(`/students/${s.id}/guardians`, { method: 'POST', body: JSON.stringify(body) }), t('stu.parentAdded'))} />}
      {dialog && typeof dialog === 'object' && 'editParent' in dialog && (
        <EditParentDialog link={dialog.editParent} busy={busy} error={error} errors={errors} setErrors={setErrors} onClose={close} onSave={(body) => run(() => api(`/students/${s.id}/guardians/${dialog.editParent.guardianId}`, { method: 'PATCH', body: JSON.stringify(body) }), t('stu.saved'))} />
      )}
      {dialog && typeof dialog === 'object' && 'removeParent' in dialog && (
        <Modal open onClose={close} title={t('stu.removeTitle', { name: dialog.removeParent.guardian.name })} danger submitLabel={t('stu.remove')} busy={busy} error={error}
          onSubmit={(e) => { e.preventDefault(); void run(() => api(`/students/${s.id}/guardians/${dialog.removeParent.guardianId}`, { method: 'DELETE' }), t('stu.parentRemoved')); }}>
          <p>{t('stu.removeText', { student: s.firstName })}</p>
        </Modal>
      )}
    </>
  );
}

// ───────────── dialogs ─────────────

interface DialogProps<B> { busy: boolean; error: string | null; errors: FieldErrors; setErrors: (e: FieldErrors) => void; onClose: () => void; onSave: (body: B) => void }

function EditDialog({ s, current, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { s: Student; current?: Enrolment }) {
  const { t } = useI18n();
  const [v, setV] = useState({
    firstName: s.firstName, lastName: s.lastName ?? '', nameLocal: s.nameLocal ?? '', dob: s.dob.slice(0, 10), gender: s.gender, category: s.category ?? '',
    religion: s.religion ?? '', motherTongue: s.motherTongue ?? '', bloodGroup: s.bloodGroup ?? '', aadhaarLast4: s.aadhaarLast4 ?? '', apaarId: s.apaarId ?? '',
    address: s.address ?? '', rollNo: current?.rollNo ?? '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      firstName: v.firstName.trim(), lastName: orNull(v.lastName), nameLocal: orNull(v.nameLocal), dob: v.dob, gender: v.gender, category: orNull(v.category),
      religion: orNull(v.religion), motherTongue: orNull(v.motherTongue), bloodGroup: orNull(v.bloodGroup), aadhaarLast4: orNull(v.aadhaarLast4), apaarId: orNull(v.apaarId),
      address: orNull(v.address), ...(current ? { rollNo: orNull(v.rollNo) } : {}),
    };
    const r = validate(updateStudentSchema, body);
    if (!r.ok) return setErrors(r.errors);
    onSave(body);
  }
  return (
    <Modal open wide onClose={onClose} title={t('stu.edit')} subtitle={`${studentName(s)} · ${s.admissionNo}`} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
      <div className="form-section">
        <div className="grid-2">
          <Field id="s-first" label={t('app.firstName')} error={errors.firstName}><input id="s-first" value={v.firstName} onChange={set('firstName')} /></Field>
          <Field id="s-last" label={t('app.lastName')} error={errors.lastName}><input id="s-last" value={v.lastName} onChange={set('lastName')} /></Field>
          <Field id="s-local" label={t('app.nameLocal')} error={errors.nameLocal}><input id="s-local" lang="kn" value={v.nameLocal} onChange={set('nameLocal')} /></Field>
          <Field id="s-dob" label={t('adm.dob')} error={errors.dob}><input id="s-dob" type="date" max={todayIST()} value={v.dob} onChange={set('dob')} /></Field>
        </div>
        <fieldset className="field">
          <legend className="label">{t('app.gender')}</legend>
          <div className="segmented" role="radiogroup" aria-label={t('app.gender')}>
            {GENDERS.map((g) => <button key={g} type="button" role="radio" aria-checked={v.gender === g} className={v.gender === g ? 'on' : ''} onClick={() => setV({ ...v, gender: g })}>{t(`gender.${g}` as MessageKey)}</button>)}
          </div>
        </fieldset>
        <div className="grid-2">
          <Field id="s-cat" label={t('app.category')} error={errors.category}>
            <select id="s-cat" value={v.category} onChange={set('category')}><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`category.${c}` as MessageKey)}</option>)}</select>
          </Field>
          <Field id="s-blood" label={t('stu.bloodGroup')} error={errors.bloodGroup}>
            <select id="s-blood" value={v.bloodGroup} onChange={set('bloodGroup')}><option value="">—</option>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </Field>
          <Field id="s-rel" label={t('app.religion')} error={errors.religion}><input id="s-rel" value={v.religion} onChange={set('religion')} /></Field>
          <Field id="s-mt" label={t('app.motherTongue')} error={errors.motherTongue}><input id="s-mt" value={v.motherTongue} onChange={set('motherTongue')} /></Field>
          <Field id="s-aadhaar" label={t('app.aadhaar')} hint={t('app.aadhaarHint')} error={errors.aadhaarLast4}><input id="s-aadhaar" inputMode="numeric" maxLength={14} value={v.aadhaarLast4} onChange={set('aadhaarLast4')} /></Field>
          <Field id="s-apaar" label={t('stu.apaar')} hint={t('stu.apaarHint')} error={errors.apaarId}><input id="s-apaar" inputMode="numeric" maxLength={12} value={v.apaarId} onChange={set('apaarId')} /></Field>
          {current && <Field id="s-roll" label={t('stu.rollNo')} error={errors.rollNo}><input id="s-roll" maxLength={10} value={v.rollNo} onChange={set('rollNo')} /></Field>}
        </div>
        <Field id="s-addr" label={t('app.address')} error={errors.address}><textarea id="s-addr" rows={2} value={v.address} onChange={set('address')} /></Field>
      </div>
    </Modal>
  );
}

function StatusDialog({ s, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { s: Student }) {
  const { t } = useI18n();
  const choices = MANUAL_STUDENT_STATUSES.filter((x) => x !== s.status);
  const [v, setV] = useState({ status: choices[0] as string, effectiveDate: todayIST(), reason: '', sectionId: '' });
  const rejoining = s.status === 'DROPPED' && v.status !== 'DROPPED';
  const [seats, setSeats] = useState<SeatOption[] | null>(null);
  useEffect(() => {
    if (rejoining && seats === null) api<{ sections: SeatOption[] }>(`/students/${s.id}/sections`).then((r) => setSeats(r.sections)).catch(() => setSeats([]));
  }, [rejoining, seats, s.id]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { status: v.status, effectiveDate: v.effectiveDate, reason: v.reason.trim(), sectionId: rejoining ? v.sectionId || null : null };
    const r = validate(changeStudentStatusSchema, body);
    if (!r.ok) return setErrors({ ...r.errors, ...(r.errors.reason ? { reason: t('app.reasonMin') } : {}) });
    if (rejoining && seats?.length && !v.sectionId) return setErrors({ sectionId: t('app.enrol.pickSection') });
    onSave(body);
  }
  return (
    <Modal open wide={rejoining} onClose={onClose} title={t('stu.changeStatus')} subtitle={`${studentName(s)} · ${t('stu.nowStatus')} ${t(`status.${s.status}` as MessageKey)}`} onSubmit={submit} submitLabel={t('stu.saveStatus')} busy={busy} error={error} danger={v.status === 'DROPPED'}>
      <fieldset className="field">
        <legend className="label">{t('stu.newStatus')}</legend>
        <div className="choice-list">
          {choices.map((c) => (
            <label key={c} className={`choice ${v.status === c ? 'on' : ''}`}>
              <input type="radio" name="st" checked={v.status === c} onChange={() => setV({ ...v, status: c })} />
              <span><strong>{t(`status.${c}` as MessageKey)}</strong><span className="sub-line muted">{t(`stu.statusHint.${c}` as MessageKey)}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {rejoining && (
        <div className="field">
          <span className="label">{t('stu.rejoinSection')}</span>
          {seats === null ? <SkeletonRows rows={2} /> : seats.length === 0 ? <p className="muted small">{t('app.enrol.noSections')}</p> : <SeatPicker seats={seats} value={v.sectionId} onChange={(sectionId) => setV({ ...v, sectionId })} label={t('stu.rejoinSection')} />}
          {errors.sectionId && <span className="err">{errors.sectionId}</span>}
        </div>
      )}
      <div className="grid-2">
        <Field id="st-date" label={t('stu.effectiveDate')} error={errors.effectiveDate}><input id="st-date" type="date" max={todayIST()} value={v.effectiveDate} onChange={(e) => setV({ ...v, effectiveDate: e.target.value })} /></Field>
      </div>
      <Field id="st-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="st-reason" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={t(`stu.reasonPh.${v.status}` as MessageKey)} /></Field>
    </Modal>
  );
}

function SectionDialog({ s, current, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { s: Student; current: Enrolment }) {
  const { t } = useI18n();
  const [seats, setSeats] = useState<SeatOption[] | null>(null);
  const [v, setV] = useState({ sectionId: '', effectiveDate: todayIST(), reason: '', rollNo: '' });
  useEffect(() => { api<{ sections: SeatOption[] }>(`/students/${s.id}/sections`).then((r) => setSeats(r.sections)).catch(() => setSeats([])); }, [s.id]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { sectionId: v.sectionId, effectiveDate: v.effectiveDate, reason: v.reason.trim(), rollNo: orNull(v.rollNo) };
    const r = validate(changeSectionSchema, body);
    if (!r.ok) return setErrors({ ...r.errors, ...(r.errors.sectionId ? { sectionId: t('app.enrol.pickSection') } : {}), ...(r.errors.reason ? { reason: t('app.reasonMin') } : {}) });
    onSave(body);
  }
  const others = (seats ?? []).filter((x) => x.id !== current.section.id);
  return (
    <Modal open wide onClose={onClose} title={t('stu.changeSection')} subtitle={`${studentName(s)} · ${current.section.level.name} – ${current.section.name} · ${current.academicYear.name}`} onSubmit={submit} submitLabel={t('stu.moveStudent')} busy={busy} error={error}>
      <p className="muted small">{t('stu.sectionHint')}</p>
      {seats === null ? <SkeletonRows rows={2} /> : others.length === 0 ? (
        <p className="note-info">{t('stu.noOtherSections')}</p>
      ) : (
        <SeatPicker seats={seats} value={v.sectionId} currentId={current.section.id} onChange={(sectionId) => setV({ ...v, sectionId })} label={t('stu.newSection')} />
      )}
      {errors.sectionId && <span className="err">{errors.sectionId}</span>}
      <div className="grid-2">
        <Field id="sc-date" label={t('stu.effectiveDate')} error={errors.effectiveDate}><input id="sc-date" type="date" max={todayIST()} value={v.effectiveDate} onChange={(e) => setV({ ...v, effectiveDate: e.target.value })} /></Field>
        <Field id="sc-roll" label={t('app.enrol.roll')} error={errors.rollNo}><input id="sc-roll" maxLength={10} value={v.rollNo} onChange={(e) => setV({ ...v, rollNo: e.target.value })} /></Field>
      </div>
      <Field id="sc-reason" label={t('app.reasonRequired')} error={errors.reason}><textarea id="sc-reason" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder={t('stu.sectionReasonPh')} /></Field>
    </Modal>
  );
}

function RelationPicker({ value, onChange }: { value: string; onChange: (r: string) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="field">
      <legend className="label">{t('stu.relation')}</legend>
      <div className="segmented" role="radiogroup" aria-label={t('stu.relation')}>
        {GUARDIAN_RELATIONS.map((r) => <button key={r} type="button" role="radio" aria-checked={value === r} className={value === r ? 'on' : ''} onClick={() => onChange(r)}>{t(`stu.rel.${r}` as MessageKey)}</button>)}
      </div>
    </fieldset>
  );
}

function AddParentDialog({ s, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { s: Student }) {
  const { t } = useI18n();
  const taken = new Set(s.guardians.map((g) => g.relation));
  const [v, setV] = useState({ relation: (['FATHER', 'MOTHER', 'GUARDIAN'] as const).find((r) => !taken.has(r)) ?? 'GUARDIAN', phone: '', name: '', email: '', occupation: '', isPrimary: s.guardians.length === 0 });
  const [matches, setMatches] = useState<Lookup[] | null>(null);
  const [linkId, setLinkId] = useState('');
  const linked = new Set(s.guardians.map((g) => g.guardianId));
  const phone = v.phone.replace(/\s/g, '');

  useEffect(() => {
    setMatches(null);
    setLinkId('');
    if (!/^[6-9]\d{9}$/.test(phone)) return;
    const h = setTimeout(() => {
      api<Lookup[]>(`/students/guardians/lookup?phone=${phone}`).then((m) => { setMatches(m); const free = m.find((x) => !linked.has(x.id)); if (free) setLinkId(free.id); }).catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const usable = (matches ?? []).filter((m) => !linked.has(m.id));
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = linkId
      ? { relation: v.relation, isPrimary: v.isPrimary, guardianId: linkId }
      : { relation: v.relation, isPrimary: v.isPrimary, name: v.name.trim() || undefined, phone: orNull(phone), email: orNull(v.email.toLowerCase()), occupation: orNull(v.occupation) };
    const r = validate(addGuardianSchema, body);
    if (!r.ok) return setErrors(r.errors);
    onSave(body);
  }
  return (
    <Modal open onClose={onClose} title={t('stu.addParent')} subtitle={studentName(s)} onSubmit={submit} submitLabel={linkId ? t('stu.linkParent') : t('stu.addParent')} busy={busy} error={error}>
      <RelationPicker value={v.relation} onChange={(relation) => setV({ ...v, relation: relation as typeof v.relation })} />
      <Field id="p-phone" label={t('stu.parentMobile')} hint={t('stu.parentMobileHint')} error={errors.phone}><input id="p-phone" inputMode="tel" maxLength={11} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
      {matches && matches.length > 0 && (
        <div className="field">
          <span className="label">{t('stu.foundParents')}</span>
          <div className="choice-list">
            {matches.map((m) => {
              const already = linked.has(m.id);
              return (
                <label key={m.id} className={`choice ${linkId === m.id ? 'on' : ''} ${already ? 'disabled' : ''}`}>
                  <input type="radio" name="link" disabled={already} checked={linkId === m.id} onChange={() => setLinkId(m.id)} />
                  <span>
                    <strong>{m.name}</strong>
                    <span className="sub-line muted">
                      {already ? t('stu.alreadyLinked') : m.children.length ? `${t('stu.parentOf')} ${m.children.map((c) => studentName(c)).join(', ')}` : t('stu.noChildrenShown')}
                      {m.otherChildren > 0 && ` · ${t('stu.otherCampus', { n: m.otherChildren })}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {usable.length > 0 && <p className="muted small">{t('stu.linkHint')}</p>}
        </div>
      )}
      {!linkId && (!matches || usable.length === 0) && (
        <>
          <Field id="p-name" label={t('common.name')} error={errors.name}><input id="p-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <div className="grid-2">
            <Field id="p-email" label={t('adm.emailOptional')} error={errors.email}><input id="p-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field id="p-occ" label={t('stu.occupation')} error={errors.occupation}><input id="p-occ" value={v.occupation} onChange={(e) => setV({ ...v, occupation: e.target.value })} /></Field>
          </div>
        </>
      )}
      {s.guardians.length > 0 && (
        <label className="check"><input type="checkbox" checked={v.isPrimary} onChange={(e) => setV({ ...v, isPrimary: e.target.checked })} /> {t('stu.makeMainCheck')}</label>
      )}
    </Modal>
  );
}

function EditParentDialog({ link, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { link: GuardianLink }) {
  const { t } = useI18n();
  const g = link.guardian;
  const [v, setV] = useState({ relation: link.relation, name: g.name, phone: g.phone ?? '', email: g.email ?? '', occupation: g.occupation ?? '' });
  function submit(e: FormEvent) {
    e.preventDefault();
    const details = { name: v.name.trim(), phone: orNull(v.phone.replace(/\s/g, '')), email: orNull(v.email.toLowerCase()), occupation: orNull(v.occupation) };
    const r = validate(updateGuardianSchema, details);
    if (!r.ok) return setErrors(r.errors);
    if (link.isPrimary && !details.phone) return setErrors({ phone: t('stu.mainNeedsPhone') });
    onSave({ ...details, ...(v.relation !== link.relation ? { relation: v.relation } : {}) });
  }
  return (
    <Modal open onClose={onClose} title={t('stu.editParent')} subtitle={g.name} onSubmit={submit} submitLabel={t('common.save')} busy={busy} error={error}>
      {link.siblings.length > 0 && <p className="note-info"><Icon name="info" size={15} /> {t('stu.sharedNote', { names: link.siblings.map((x) => x.firstName).join(', ') })}</p>}
      <RelationPicker value={v.relation} onChange={(relation) => setV({ ...v, relation })} />
      <Field id="ep-name" label={t('common.name')} error={errors.name}><input id="ep-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <div className="grid-2">
        <Field id="ep-phone" label={t('stu.parentMobile')} error={errors.phone}><input id="ep-phone" inputMode="tel" maxLength={11} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field id="ep-email" label={t('adm.emailOptional')} error={errors.email}><input id="ep-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      </div>
      <Field id="ep-occ" label={t('stu.occupation')} error={errors.occupation}><input id="ep-occ" value={v.occupation} onChange={(e) => setV({ ...v, occupation: e.target.value })} /></Field>
    </Modal>
  );
}


function TcDialog({ s, busy, error, errors, setErrors, onClose, onSave }: DialogProps<Record<string, unknown>> & { s: Student }) {
  const { t } = useI18n();
  const { can, hasModule } = useSession();
  const day = useDay();
  const [v, setV] = useState({ leavingDate: todayIST(), reason: '', conduct: 'GOOD' as string, remarks: '' });
  const [dues, setDues] = useState<NoDues | null | 'n/a'>(can(PERMISSIONS.FEE_READ) && hasModule('FEES') ? null : 'n/a');
  useEffect(() => {
    if (dues === null) api<NoDues>(`/fees/students/${s.id}/no-dues`).then(setDues).catch(() => setDues('n/a'));
  }, [dues, s.id]);
  const blocked = dues !== null && dues !== 'n/a' && !dues.clear;
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { leavingDate: v.leavingDate, reason: v.reason.trim(), conduct: v.conduct, remarks: orNull(v.remarks) };
    const r = validate(issueTcSchema, body);
    if (!r.ok) return setErrors(r.errors);
    if (v.leavingDate < s.admissionDate.slice(0, 10)) return setErrors({ leavingDate: t('stu.tc.beforeAdmission') });
    onSave(body);
  }
  return (
    <Modal open wide onClose={onClose} title={t('stu.tc.issueTitle')} subtitle={`${studentName(s)} · ${s.admissionNo}`} onSubmit={submit} submitLabel={t('stu.tc.issue')} busy={busy} submitDisabled={blocked || dues === null} error={error}>
      {dues === null ? <SkeletonRows rows={1} /> : dues === 'n/a' ? <p className="note-info"><Icon name="info" size={15} /> {t('stu.tc.duesChecked')}</p> : dues.clear ? (
        <p className="tc-dues ok"><Icon name="check" size={16} /> {t('stu.tc.noDues')}</p>
      ) : (
        <div className="tc-dues bad" role="alert">
          <strong><Icon name="alert" size={16} /> {dues.pendingRefunds ? t('stu.tc.refundPending') : t('stu.tc.duesPending', { v: formatINR(toPaise(dues.balance)) })}</strong>
          {dues.openBills.length > 0 && <ul>{dues.openBills.map((b) => <li key={b.invoiceNo}>{b.description} <span className="mono muted">({b.invoiceNo})</span> — {formatINR(toPaise(b.balanceAmount))}</li>)}</ul>}
          <p className="small">{t('stu.tc.clearFirst')}</p>
        </div>
      )}
      <div className="grid-2">
        <Field id="tc-date" label={t('stu.tc.f.leaving')} hint={t('stu.tc.admittedOn', { date: day(s.admissionDate) })} error={errors.leavingDate}>
          <input id="tc-date" type="date" min={s.admissionDate.slice(0, 10)} max={todayIST()} value={v.leavingDate} onChange={(e) => setV({ ...v, leavingDate: e.target.value })} />
        </Field>
        <Field id="tc-reason" label={t('stu.tc.f.reason')} error={errors.reason}>
          <input id="tc-reason" value={v.reason} maxLength={200} placeholder={t('stu.tc.reasonPh')} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
      <fieldset className="field">
        <legend className="label">{t('stu.tc.f.conduct')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('stu.tc.f.conduct')}>
          {CONDUCT_OPTIONS.map((c) => <button key={c} type="button" role="radio" aria-checked={v.conduct === c} className={v.conduct === c ? 'on' : ''} onClick={() => setV({ ...v, conduct: c })}>{t(`stu.tc.conduct.${c}` as MessageKey)}</button>)}
        </div>
      </fieldset>
      <Field id="tc-remarks" label={t('stu.tc.f.remarks')} error={errors.remarks}>
        <textarea id="tc-remarks" rows={2} maxLength={300} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
      </Field>
      <p className="note-info"><Icon name="info" size={15} /> {t('stu.tc.whatHappens')}</p>
    </Modal>
  );
}
