'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  APPLICATION_EDITABLE, ApplicationStatus, CATEGORIES, GENDERS, PERMISSIONS, createApplicationSchema, decideApplicationSchema, enrolSchema, updateApplicationSchema,
} from '@eduerp/shared';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors, FieldErrors, validate } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { DataTable } from '@/components/DataTable';
import { Documents } from '@/components/Documents';
import { EmptyState, PageHeader, SkeletonRows, StatusBadge, useToast } from '@/components/ui';
import { ClassSelect, todayIST, useAdmissionOptions, useDay } from '@/components/admissions';

interface Row {
  id: string; applicationNo: string; firstName: string; lastName: string | null; dob: string; gender: string; parentPhone: string; status: string; createdAt: string;
  level: { name: string; program: { name: string } }; campus: { code: string }; student: { id: string; admissionNo: string } | null;
}
interface Detail {
  id: string; applicationNo: string; status: ApplicationStatus; campusId: string; academicYearId: string; programLevelId: string; createdAt: string;
  firstName: string; lastName: string | null; nameLocal: string | null; dob: string; gender: string; category: string | null; religion: string | null; motherTongue: string | null; aadhaarLast4: string | null;
  fatherName: string | null; motherName: string | null; guardianName: string | null; parentPhone: string; parentEmail: string | null; address: string | null;
  previousInstitution: string | null; previousMarksPercent: string | null; duplicateReason: string | null; decisionRemarks: string | null; decidedAt: string | null;
  level: { id: string; name: string; program: { name: string } }; campus: { code: string; name: string }; academicYear: { name: string };
  enquiry: { id: string; enquiryNo: string } | null; student: { id: string; admissionNo: string } | null;
}
interface Match { kind: 'APPLICATION' | 'STUDENT'; id: string; number: string; name: string; dob: string; status: string; reason: string }
interface Seat { id: string; name: string; capacity: number; filled: number; available: number; room: string | null }

type Filter = 'ALL' | 'SUBMITTED' | 'APPROVED' | 'WAITLISTED' | 'ENROLLED' | 'REJECTED' | 'CANCELLED';
const FILTERS: Filter[] = ['ALL', 'SUBMITTED', 'APPROVED', 'WAITLISTED', 'ENROLLED', 'REJECTED', 'CANCELLED'];

const blankForm = {
  levelId: '', academicYearId: '', enquiryId: '', firstName: '', lastName: '', nameLocal: '', dob: '', gender: '', category: '', religion: '', motherTongue: '', aadhaarLast4: '',
  fatherName: '', motherName: '', guardianName: '', parentPhone: '', parentEmail: '', address: '', previousInstitution: '', previousMarksPercent: '', duplicateReason: '',
};
type FormState = typeof blankForm;
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function ApplicationsInner() {
  const { can, campusId } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const router = useRouter();
  const params = useSearchParams();
  const { opts, currentYear, campusOfLevel } = useAdmissionOptions();
  const canDecide = can(PERMISSIONS.ADM_APPLICATION_DECIDE);
  const canEnrol = can(PERMISSIONS.ADM_ENROL);

  const [data, setData] = useState<{ rows: Row[]; summary: { byStatus: Record<string, number> } } | null>(null);
  const [filter, setFilter] = useState<Filter>(() => {
    const s = params.get('status') as Filter | null; // from the dashboard
    return s && FILTERS.includes(s) ? s : 'ALL';
  });
  const [query, setQuery] = useState('');
  const load = useCallback(() => {
    api<typeof data>(`/admissions/applications${campusId ? `?campusId=${campusId}` : ''}`).then(setData).catch(() => setData({ rows: [], summary: { byStatus: {} } }));
  }, [campusId]);
  useEffect(load, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (filter === 'SUBMITTED' ? !['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) : filter !== 'ALL' && r.status !== filter) return false;
      return !q || [`${r.firstName} ${r.lastName ?? ''}`, r.applicationNo, r.parentPhone, r.student?.admissionNo ?? ''].some((v) => v.toLowerCase().includes(q));
    });
  }, [data, filter, query]);
  const count = (f: Filter) =>
    f === 'ALL' ? data?.rows.length ?? 0 : f === 'SUBMITTED' ? (data?.summary.byStatus.SUBMITTED ?? 0) + (data?.summary.byStatus.UNDER_REVIEW ?? 0) : data?.summary.byStatus[f] ?? 0;

  // ───────── application form (new / edit) ─────────
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Detail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [matches, setMatches] = useState<Match[]>([]);
  const [fromEnquiry, setFromEnquiry] = useState<string | null>(null);
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function openCreate(prefill: Partial<FormState> = {}, enquiryParent: string | null = null) {
    setEditing(null);
    setForm({ ...blankForm, academicYearId: currentYear, ...prefill });
    setErrors({});
    setFormError(null);
    setMatches([]);
    setFromEnquiry(enquiryParent);
    setIdemKey(newIdempotencyKey());
    setFormOpen(true);
  }

  function openEdit(d: Detail) {
    setDetail(null);
    setEditing(d);
    const s = (v: string | null) => v ?? '';
    setForm({
      ...blankForm, levelId: d.programLevelId, academicYearId: d.academicYearId, firstName: d.firstName, lastName: s(d.lastName), nameLocal: s(d.nameLocal), dob: d.dob.slice(0, 10),
      gender: d.gender, category: s(d.category), religion: s(d.religion), motherTongue: s(d.motherTongue), aadhaarLast4: s(d.aadhaarLast4), fatherName: s(d.fatherName),
      motherName: s(d.motherName), guardianName: s(d.guardianName), parentPhone: d.parentPhone, parentEmail: s(d.parentEmail), address: s(d.address),
      previousInstitution: s(d.previousInstitution), previousMarksPercent: d.previousMarksPercent ? String(Number(d.previousMarksPercent)) : '',
    });
    setErrors({});
    setFormError(null);
    setMatches([]);
    setFromEnquiry(null);
    setFormOpen(true);
  }

  // From an enquiry (?enquiry=) or a link to one application (?open=).
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !opts) return;
    const enquiryId = params.get('enquiry');
    const openId = params.get('open');
    if (!enquiryId && !openId) return;
    handled.current = true;
    router.replace('/admissions/applications');
    if (openId) void openDetail(openId);
    if (enquiryId) {
      api<{ id: string; studentName: string; dob: string | null; parentName: string; phone: string; email: string | null; programLevelId: string; academicYearId: string }>(`/admissions/enquiries/${enquiryId}`)
        .then((e) => {
          const [firstName, ...rest] = e.studentName.trim().split(/\s+/);
          openCreate({ enquiryId: e.id, levelId: e.programLevelId, academicYearId: e.academicYearId, firstName, lastName: rest.join(' '), dob: e.dob?.slice(0, 10) ?? '', parentPhone: e.phone, parentEmail: e.email ?? '' }, e.parentName);
        })
        .catch(() => toast(t('app.enquiryMissing'), 'bad'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, params]);

  // Live duplicate check once phone + first name (+ date of birth) are filled in.
  useEffect(() => {
    if (!formOpen || editing || !/^[6-9]\d{9}$/.test(form.parentPhone) || !form.firstName.trim()) return setMatches([]);
    const timer = setTimeout(() => {
      api<Match[]>('/admissions/duplicate-check', { method: 'POST', body: JSON.stringify({ parentPhone: form.parentPhone, firstName: form.firstName, lastName: orNull(form.lastName), dob: form.dob || null }) })
        .then(setMatches)
        .catch(() => undefined);
    }, 450);
    return () => clearTimeout(timer);
  }, [formOpen, editing, form.parentPhone, form.firstName, form.lastName, form.dob]);

  async function saveForm() {
    const common = {
      programLevelId: form.levelId, firstName: form.firstName, lastName: orNull(form.lastName), nameLocal: orNull(form.nameLocal), dob: form.dob, gender: form.gender,
      category: orNull(form.category), religion: orNull(form.religion), motherTongue: orNull(form.motherTongue), aadhaarLast4: orNull(form.aadhaarLast4),
      fatherName: orNull(form.fatherName), motherName: orNull(form.motherName), guardianName: orNull(form.guardianName), parentPhone: form.parentPhone,
      parentEmail: orNull(form.parentEmail), address: orNull(form.address), previousInstitution: orNull(form.previousInstitution),
      previousMarksPercent: form.previousMarksPercent === '' ? null : Number(form.previousMarksPercent),
    };
    const v = editing
      ? validate(updateApplicationSchema, common)
      : validate(createApplicationSchema, { ...common, campusId: campusOfLevel.get(form.levelId) ?? '', academicYearId: form.academicYearId, enquiryId: form.enquiryId || null, duplicateReason: matches.length ? orNull(form.duplicateReason) : null });
    if (!v.ok) return setErrors({ ...v.errors, levelId: v.errors.programLevelId ?? v.errors.campusId });
    if (!editing && matches.length && !orNull(form.duplicateReason)) return setErrors({ duplicateReason: t('app.dup.reasonNeeded') });
    setBusy(true);
    try {
      const saved = editing
        ? await api<{ id: string; applicationNo: string }>(`/admissions/applications/${editing.id}`, { method: 'PATCH', body: JSON.stringify(v.data) })
        : await api<{ id: string; applicationNo: string }>('/admissions/applications', { method: 'POST', headers: { 'Idempotency-Key': idemKey }, body: JSON.stringify(v.data) });
      setFormOpen(false);
      toast(editing ? t('app.updated') : t('app.created', { no: saved.applicationNo }));
      load();
      void openDetail(saved.id);
    } catch (e) {
      if (e instanceof ApiError && e.type === 'possible-duplicate') {
        setMatches((e.errors ?? []) as unknown as Match[]);
        setErrors({ duplicateReason: t('app.dup.reasonNeeded') });
      } else {
        const { fields, message } = apiErrors(e);
        setErrors(fields);
        setFormError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  // ───────── detail, decisions, enrolment ─────────
  type Mode = 'view' | 'APPROVE' | 'WAITLIST' | 'REJECT' | 'enrol' | 'cancel';
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [remarks, setRemarks] = useState('');
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [enrol, setEnrol] = useState({ sectionId: '', admissionDate: '', rollNo: '' });
  const [actError, setActError] = useState<string | null>(null);

  async function openDetail(id: string) {
    setMode('view');
    setRemarks('');
    setActError(null);
    try {
      setDetail(await api<Detail>(`/admissions/applications/${id}`));
    } catch (e) {
      toast(apiErrors(e).message ?? 'Error', 'bad');
    }
  }

  async function startEnrol() {
    if (!detail) return;
    setMode('enrol');
    setActError(null);
    setSeats(null);
    setEnrol({ sectionId: '', admissionDate: todayIST(), rollNo: '' });
    try {
      const s = await api<Seat[]>(`/admissions/applications/${detail.id}/sections`);
      setSeats(s);
      setEnrol((x) => ({ ...x, sectionId: s.find((z) => z.available > 0)?.id ?? '' }));
    } catch (e) {
      setSeats([]);
      setActError(apiErrors(e).message);
    }
  }

  async function act() {
    if (!detail) return;
    if (mode === 'view') return setDetail(null);
    setActError(null);
    setBusy(true);
    try {
      if (mode === 'APPROVE' || mode === 'WAITLIST' || mode === 'REJECT') {
        const v = validate(decideApplicationSchema, { decision: mode, remarks: orNull(remarks) });
        if (!v.ok) return setActError(Object.values(v.errors)[0] ?? null);
        await api(`/admissions/applications/${detail.id}/decision`, { method: 'POST', body: JSON.stringify(v.data) });
        toast(t(`app.decided.${mode}` as MessageKey, { name: detail.firstName }));
      } else if (mode === 'cancel') {
        if (remarks.trim().length < 5) return setActError(t('app.reasonMin'));
        await api(`/admissions/applications/${detail.id}/cancel`, { method: 'POST', body: JSON.stringify({ remarks: remarks.trim() }) });
        toast(t('app.cancelled'));
      } else if (mode === 'enrol') {
        const v = validate(enrolSchema, { sectionId: enrol.sectionId, admissionDate: enrol.admissionDate || null, rollNo: orNull(enrol.rollNo) });
        if (!v.ok) return setActError(t('app.enrol.pickSection'));
        const r = await api<{ admissionNo: string }>(`/admissions/applications/${detail.id}/enrol`, { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }, body: JSON.stringify(v.data) });
        toast(t('app.enrolled', { name: detail.firstName, no: r.admissionNo }));
      }
      load();
      await openDetail(detail.id);
    } catch (e) {
      setActError(apiErrors(e).message ?? (e instanceof ApiError ? e.message : 'Error'));
    } finally {
      setBusy(false);
    }
  }


  const fullName = (r: { firstName: string; lastName: string | null }) => `${r.firstName} ${r.lastName ?? ''}`.trim();
  const decidable = detail && ['SUBMITTED', 'UNDER_REVIEW', 'WAITLISTED'].includes(detail.status);
  const editable = detail && APPLICATION_EDITABLE.includes(detail.status);
  const cancellable = detail && !['ENROLLED', 'REJECTED', 'CANCELLED'].includes(detail.status);
  const submitLabel: Record<Mode, string> = {
    view: t('common.close'), APPROVE: t('app.act.APPROVE'), WAITLIST: t('app.act.WAITLIST'), REJECT: t('app.act.REJECT'), enrol: t('app.act.enrol'), cancel: t('app.act.cancel'),
  };

  return (
    <>
      <PageHeader
        eyebrow={t('nav.admissions')}
        title={t('app.title')}
        description={t('app.desc')}
        actions={<button className="btn btn-primary" onClick={() => openCreate()} disabled={!opts}><Icon name="plus" /> {t('app.new')}</button>}
      />

      <div className="review-bar first">
        <div className="tabs scroll" role="tablist" aria-label={t('common.status')}>
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {t(`app.filter.${f}` as MessageKey)} <span className="tab-count">{count(f)}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input placeholder={t('app.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('app.search')} />
        </label>
      </div>

      {data === null ? (
        <SkeletonRows />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="file" title={t('app.emptyTitle')} text={t('app.emptyText')} action={<button className="btn btn-primary" onClick={() => openCreate()} disabled={!opts}><Icon name="plus" /> {t('app.new')}</button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon="search" title={t('common.noMatches')} />
      ) : (
        <DataTable
          caption={t('app.title')}
          rows={rows}
          rowKey={(r) => r.id}
          rowClass={(r) => (['REJECTED', 'CANCELLED'].includes(r.status) ? 'row-dim' : undefined)}
          columns={[
            { key: 'no', header: t('app.col.no'), sort: (r) => r.applicationNo, cell: (r) => <><span className="code">{r.applicationNo}</span><span className="sub-line muted">{day(r.createdAt)}</span></> },
            { key: 'child', header: t('app.col.child'), sort: (r) => fullName(r), cell: (r) => <><strong>{fullName(r)}</strong><span className="sub-line muted">{day(r.dob)} · {t(`gender.${r.gender}` as MessageKey)}</span></> },
            { key: 'class', header: t('enq.col.class'), sort: (r) => r.level.name, cell: (r) => <>{r.level.name}<span className="sub-line muted">{r.level.program.name}</span></> },
            { key: 'phone', header: t('adm.phone'), cell: (r) => r.parentPhone },
            { key: 'status', header: t('common.status'), sort: (r) => r.status, cell: (r) => <><StatusBadge status={r.status} />{r.student && <span className="sub-line muted">{r.student.admissionNo}</span>}</> },
            { key: 'open', header: <span className="sr-only">{t('common.open')}</span>, align: 'right', cell: (r) => <button className="btn btn-sm" onClick={() => openDetail(r.id)}>{t('common.open')} <Icon name="chevronRight" size={14} /></button> },
          ]}
        />
      )}

      {/* ───── new / edit application ───── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        wide
        title={editing ? t('app.edit', { no: editing.applicationNo }) : t('app.new')}
        subtitle={fromEnquiry ? t('app.fromEnquiry', { parent: fromEnquiry }) : t('app.newSub')}
        onSubmit={saveForm}
        submitLabel={editing ? t('common.save') : t('app.submit')}
        busy={busy}
        error={formError}
      >
        <h3 className="form-section"><Icon name="layers" size={16} /> {t('app.sec.admission')}</h3>
        <div className="grid-2">
          <Field id="a-class" label={t('adm.class')} error={errors.levelId}>
            <ClassSelect id="a-class" value={form.levelId} onChange={set('levelId')} programs={(opts?.programs ?? []).filter((p) => !editing || p.campusId === editing.campusId)} invalid={!!errors.levelId} />
          </Field>
          <Field id="a-year" label={t('adm.year')} error={errors.academicYearId}>
            <select id="a-year" value={form.academicYearId} disabled={!!editing} onChange={(e) => set('academicYearId')(e.target.value)}>
              {(opts?.years ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              {editing && !opts?.years.some((y) => y.id === editing.academicYearId) && <option value={editing.academicYearId}>{editing.academicYear.name}</option>}
            </select>
          </Field>
        </div>

        <h3 className="form-section"><Icon name="cap" size={16} /> {t('app.sec.child')}</h3>
        <div className="grid-3">
          <Field id="a-first" label={t('app.firstName')} error={errors.firstName}>
            <input id="a-first" value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} autoFocus={!editing} />
          </Field>
          <Field id="a-last" label={t('app.lastName')} error={errors.lastName}>
            <input id="a-last" value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} />
          </Field>
          <Field id="a-local" label={t('app.nameLocal')} error={errors.nameLocal}>
            <input id="a-local" lang="kn" value={form.nameLocal} onChange={(e) => set('nameLocal')(e.target.value)} />
          </Field>
          <Field id="a-dob" label={t('adm.dob')} error={errors.dob}>
            <input id="a-dob" type="date" max={todayIST()} value={form.dob} onChange={(e) => set('dob')(e.target.value)} />
          </Field>
          <Field id="a-gender" label={t('app.gender')} error={errors.gender}>
            <div className="segmented" role="radiogroup" aria-label={t('app.gender')}>
              {GENDERS.map((g) => <button key={g} type="button" role="radio" aria-checked={form.gender === g} className={form.gender === g ? 'on' : ''} onClick={() => set('gender')(g)}>{t(`gender.${g}` as MessageKey)}</button>)}
            </div>
          </Field>
          <Field id="a-cat" label={t('app.category')} error={errors.category}>
            <select id="a-cat" value={form.category} onChange={(e) => set('category')(e.target.value)}>
              <option value="">{t('common.notSet')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`category.${c}` as MessageKey)}</option>)}
            </select>
          </Field>
          <Field id="a-rel" label={t('app.religion')} error={errors.religion}>
            <input id="a-rel" value={form.religion} onChange={(e) => set('religion')(e.target.value)} />
          </Field>
          <Field id="a-mt" label={t('app.motherTongue')} error={errors.motherTongue}>
            <input id="a-mt" value={form.motherTongue} placeholder={t('app.motherTongueHint')} onChange={(e) => set('motherTongue')(e.target.value)} />
          </Field>
          <Field id="a-aadhaar" label={t('app.aadhaar')} hint={t('app.aadhaarHint')} error={errors.aadhaarLast4}>
            <input id="a-aadhaar" inputMode="numeric" maxLength={14} placeholder="1234" value={form.aadhaarLast4} onChange={(e) => set('aadhaarLast4')(e.target.value)} autoComplete="off" />
          </Field>
        </div>

        <h3 className="form-section"><Icon name="users" size={16} /> {t('app.sec.parents')}</h3>
        {errors.fatherName && !form.fatherName && !form.motherName && !form.guardianName && <p className="err">{t('app.parentNeeded')}</p>}
        <div className="grid-3">
          <Field id="a-father" label={t('app.father')}>
            <input id="a-father" value={form.fatherName} onChange={(e) => set('fatherName')(e.target.value)} />
          </Field>
          <Field id="a-mother" label={t('app.mother')} error={errors.motherName}>
            <input id="a-mother" value={form.motherName} onChange={(e) => set('motherName')(e.target.value)} />
          </Field>
          <Field id="a-guardian" label={t('app.guardian')} error={errors.guardianName}>
            <input id="a-guardian" value={form.guardianName} onChange={(e) => set('guardianName')(e.target.value)} />
          </Field>
          <Field id="a-phone" label={t('adm.phone')} hint={t('app.phoneHint')} error={errors.parentPhone}>
            <input id="a-phone" inputMode="numeric" maxLength={10} placeholder="98xxxxxxxx" value={form.parentPhone} onChange={(e) => set('parentPhone')(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field id="a-email" label={t('adm.emailOptional')} error={errors.parentEmail}>
            <input id="a-email" type="email" value={form.parentEmail} onChange={(e) => set('parentEmail')(e.target.value)} />
          </Field>
          <Field id="a-addr" label={t('app.address')} error={errors.address}>
            <input id="a-addr" value={form.address} onChange={(e) => set('address')(e.target.value)} />
          </Field>
        </div>

        <h3 className="form-section"><Icon name="building" size={16} /> {t('app.sec.previous')}</h3>
        <div className="grid-2">
          <Field id="a-prev" label={t('app.prevSchool')} error={errors.previousInstitution}>
            <input id="a-prev" value={form.previousInstitution} onChange={(e) => set('previousInstitution')(e.target.value)} />
          </Field>
          <Field id="a-marks" label={t('app.prevMarks')} error={errors.previousMarksPercent}>
            <input id="a-marks" type="number" min={0} max={100} step="0.01" value={form.previousMarksPercent} onChange={(e) => set('previousMarksPercent')(e.target.value)} />
          </Field>
        </div>

        {matches.length > 0 && (
          <div className="dup-panel" role="alert">
            <p className="dup-title"><Icon name="alert" size={17} /> {t('app.dup.title', { n: matches.length })}</p>
            <ul>
              {matches.map((m) => (
                <li key={m.kind + m.id}>
                  <span className="code">{m.number}</span> <strong>{m.name}</strong> · {day(m.dob)} · {t(`app.dup.kind.${m.kind}` as MessageKey)} <StatusBadge status={m.status} />
                  <span className="sub-line">{t(`app.dup.reason.${m.reason}` as MessageKey)}</span>
                </li>
              ))}
            </ul>
            <Field id="a-dupreason" label={t('app.dup.reason')} hint={t('app.dup.reasonHint')} error={errors.duplicateReason}>
              <input id="a-dupreason" value={form.duplicateReason} onChange={(e) => set('duplicateReason')(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ───── application detail ───── */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        wide
        title={detail ? fullName(detail) : ''}
        subtitle={detail ? `${detail.applicationNo} · ${detail.level.name}, ${detail.level.program.name} · ${detail.campus.name} · ${detail.academicYear.name}` : ''}
        onSubmit={act}
        submitLabel={submitLabel[mode]}
        danger={mode === 'REJECT' || mode === 'cancel'}
        hideCancel={mode === 'view'}
        busy={busy}
        error={actError}
      >
        {detail && (
          <>
            <div className="detail-head">
              <StatusBadge status={detail.status} />
              {detail.student && (can(PERMISSIONS.STU_STUDENT_READ)
                ? <Link className="role-tag" href={`/students/${detail.student.id}`} title={t('stu.openStudent')}>{t('app.admissionNo')}: {detail.student.admissionNo}</Link>
                : <span className="role-tag">{t('app.admissionNo')}: {detail.student.admissionNo}</span>)}
              {detail.enquiry && <span className="muted small">{t('app.fromEnquiryNo', { no: detail.enquiry.enquiryNo })}</span>}
              <span className="spacer" />
              {mode === 'view' && editable && <button type="button" className="btn btn-sm" onClick={() => openEdit(detail)}><Icon name="edit" size={15} /> {t('app.editDetails')}</button>}
            </div>

            {detail.duplicateReason && (
              <p className="note-warn"><Icon name="info" size={15} /> {t('app.dup.recorded')}: {detail.duplicateReason}</p>
            )}
            {detail.decisionRemarks && (
              <p className={detail.status === 'REJECTED' || detail.status === 'CANCELLED' ? 'note-bad' : 'note-info'}><Icon name="info" size={15} /> {t('app.remarks')}: {detail.decisionRemarks}{detail.decidedAt ? ` · ${day(detail.decidedAt)}` : ''}</p>
            )}

            {mode === 'view' && (
              <>
                <dl className="kv">
                  <div><dt>{t('adm.dob')}</dt><dd>{day(detail.dob)}</dd></div>
                  <div><dt>{t('app.gender')}</dt><dd>{t(`gender.${detail.gender}` as MessageKey)}</dd></div>
                  <div><dt>{t('app.category')}</dt><dd>{detail.category ? t(`category.${detail.category}` as MessageKey) : '—'}</dd></div>
                  {detail.nameLocal && <div><dt>{t('app.nameLocal')}</dt><dd lang="kn">{detail.nameLocal}</dd></div>}
                  {detail.motherTongue && <div><dt>{t('app.motherTongue')}</dt><dd>{detail.motherTongue}</dd></div>}
                  {detail.religion && <div><dt>{t('app.religion')}</dt><dd>{detail.religion}</dd></div>}
                  <div><dt>{t('app.aadhaar')}</dt><dd>{detail.aadhaarLast4 ? `XXXX XXXX ${detail.aadhaarLast4}` : '—'}</dd></div>
                  {detail.fatherName && <div><dt>{t('app.father')}</dt><dd>{detail.fatherName}</dd></div>}
                  {detail.motherName && <div><dt>{t('app.mother')}</dt><dd>{detail.motherName}</dd></div>}
                  {detail.guardianName && <div><dt>{t('app.guardian')}</dt><dd>{detail.guardianName}</dd></div>}
                  <div><dt>{t('adm.phone')}</dt><dd><a href={`tel:${detail.parentPhone}`}>{detail.parentPhone}</a></dd></div>
                  {detail.parentEmail && <div><dt>{t('adm.email')}</dt><dd>{detail.parentEmail}</dd></div>}
                  {detail.address && <div className="kv-wide"><dt>{t('app.address')}</dt><dd>{detail.address}</dd></div>}
                  {detail.previousInstitution && <div><dt>{t('app.prevSchool')}</dt><dd>{detail.previousInstitution}</dd></div>}
                  {detail.previousMarksPercent && <div><dt>{t('app.prevMarks')}</dt><dd>{Number(detail.previousMarksPercent)}%</dd></div>}
                </dl>

                <Documents sources={[{ entityType: 'APPLICATION', entityId: detail.id }]} campusId={detail.campusId} canAttach={!['REJECTED', 'CANCELLED'].includes(detail.status)} />

                {((decidable && canDecide) || (detail.status === 'APPROVED' && canEnrol) || cancellable) && (
                <div className="action-row">
                  {decidable && canDecide && (
                    <>
                      <button type="button" className="btn btn-primary" onClick={() => { setMode('APPROVE'); setRemarks(''); setActError(null); }}><Icon name="check" size={16} /> {t('app.act.APPROVE')}</button>
                      {detail.status !== 'WAITLISTED' && <button type="button" className="btn" onClick={() => { setMode('WAITLIST'); setRemarks(''); setActError(null); }}><Icon name="clock" size={16} /> {t('app.act.WAITLIST')}</button>}
                      <button type="button" className="btn btn-danger" onClick={() => { setMode('REJECT'); setRemarks(''); setActError(null); }}><Icon name="x" size={16} /> {t('app.act.REJECT')}</button>
                    </>
                  )}
                  {detail.status === 'APPROVED' && canEnrol && <button type="button" className="btn btn-gold" onClick={startEnrol}><Icon name="cap" size={16} /> {t('app.act.enrol')}</button>}
                  {cancellable && <button type="button" className="btn btn-ghost" onClick={() => { setMode('cancel'); setRemarks(''); setActError(null); }}>{t('app.act.cancel')}</button>}
                </div>
                )}
              </>
            )}

            {(mode === 'APPROVE' || mode === 'WAITLIST' || mode === 'REJECT' || mode === 'cancel') && (
              <fieldset className="subform">
                <legend>{mode === 'cancel' ? t('app.act.cancel') : t(`app.act.${mode}` as MessageKey)}</legend>
                <p className="muted small">{t(`app.confirm.${mode}` as MessageKey, { name: fullName(detail) })}</p>
                <Field id="d-remarks" label={mode === 'REJECT' || mode === 'cancel' ? t('app.reasonRequired') : t('app.remarksOptional')}>
                  <textarea id="d-remarks" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} autoFocus />
                </Field>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>{t('app.back')}</button>
              </fieldset>
            )}

            {mode === 'enrol' && (
              <fieldset className="subform">
                <legend>{t('app.enrol.title')}</legend>
                <p className="muted small">{t('app.enrol.desc', { cls: detail.level.name })}</p>
                {seats === null ? (
                  <SkeletonRows rows={2} />
                ) : seats.length === 0 ? (
                  <p className="note-warn"><Icon name="info" size={15} /> {t('app.enrol.noSections', { cls: detail.level.name })}</p>
                ) : (
                  <div className="seat-grid" role="radiogroup" aria-label={t('app.enrol.section')}>
                    {seats.map((s) => {
                      const full = s.available === 0;
                      const on = enrol.sectionId === s.id;
                      return (
                        <button key={s.id} type="button" role="radio" aria-checked={on} disabled={full} className={`seat-card ${on ? 'on' : ''} ${full ? 'full' : ''}`} onClick={() => setEnrol({ ...enrol, sectionId: s.id })}>
                          <span className="seat-name">{detail.level.name} – {s.name}</span>
                          <span className="seat-meter" aria-hidden><span style={{ width: `${Math.min(100, (s.filled / s.capacity) * 100)}%` }} /></span>
                          <span className="small">{full ? t('app.enrol.full') : t('app.enrol.seatsLeft', { n: s.available, cap: s.capacity })}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="grid-2">
                  <Field id="n-date" label={t('app.enrol.date')}>
                    <input id="n-date" type="date" value={enrol.admissionDate} onChange={(e) => setEnrol({ ...enrol, admissionDate: e.target.value })} />
                  </Field>
                  <Field id="n-roll" label={t('app.enrol.roll')}>
                    <input id="n-roll" maxLength={10} value={enrol.rollNo} onChange={(e) => setEnrol({ ...enrol, rollNo: e.target.value })} />
                  </Field>
                </div>
                <p className="muted small"><Icon name="info" size={14} /> {t('app.enrol.what')}</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('view')}>{t('app.back')}</button>
              </fieldset>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<SkeletonRows />}>
      <ApplicationsInner />
    </Suspense>
  );
}
