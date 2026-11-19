'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BLOOD_GROUPS, MARITAL_STATUSES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';

interface Profile {
  employee: { id: string; employeeCode: string; name: string; gender: string; dob: string | null; phone: string | null; email: string | null; employeeType: string; joiningDate: string; leftOn: string | null; status: string; campus: string; department: string | null; designationId: string | null; designation: string | null };
  details: { fatherOrSpouseName: string | null; maritalStatus: string | null; bloodGroup: string | null; permanentAddress: string | null; currentAddress: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; pan: string | null; aadhaar: string | null; uanNo: string | null; pfNo: string | null; esiNo: string | null; bankName: string | null; bankAccount: string | null; ifsc: string | null; shiftId: string | null; shift: string | null; reportingToId: string | null; reportingTo: string | null; confirmationDate: string | null; probationEndDate: string | null };
  qualifications: { id: string; qualification: string; institution: string; yearOfPassing: number; percentage: number | null }[];
  experiences: { id: string; organisation: string; designation: string; fromDate: string; toDate: string }[];
  exit: { id: string; status: string; lastWorkingDate: string } | null;
  canEdit: boolean; isSelf: boolean;
}
interface Opt { id: string; name: string }

/** HR → staff profile (M14.1): personal, statutory and bank details, qualifications, experience. */
export default function HrProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [desigs, setDesigs] = useState<Opt[]>([]);
  const [shifts, setShifts] = useState<(Opt & { campus: string })[]>([]);
  const [staff, setStaff] = useState<Opt[]>([]);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [addQ, setAddQ] = useState(false);
  const [addX, setAddX] = useState(false);
  const [sub, setSub] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Profile>(`/hr/staff/${id}`).then(setP).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const openEdit = () => {
    if (!p) return;
    const d = p.details;
    setForm({ designationId: p.employee.designationId ?? '', fatherOrSpouseName: d.fatherOrSpouseName ?? '', maritalStatus: d.maritalStatus ?? '', bloodGroup: d.bloodGroup ?? '', permanentAddress: d.permanentAddress ?? '', currentAddress: d.currentAddress ?? '', emergencyContactName: d.emergencyContactName ?? '', emergencyContactPhone: d.emergencyContactPhone ?? '', pan: '', aadhaarLast4: d.aadhaar ? d.aadhaar.slice(-4) : '', uanNo: d.uanNo ?? '', pfNo: d.pfNo ?? '', esiNo: d.esiNo ?? '', bankName: d.bankName ?? '', bankAccountNo: '', ifsc: d.ifsc ?? '', shiftId: d.shiftId ?? '', reportingToId: d.reportingToId ?? '', confirmationDate: d.confirmationDate ?? '', probationEndDate: d.probationEndDate ?? '' });
    api<(Opt & { isActive: boolean })[]>('/hr/designations').then((r) => setDesigs(r.filter((x) => x.isActive))).catch(() => setDesigs([]));
    api<(Opt & { campus: string; isActive: boolean })[]>('/hr/shifts').then((r) => setShifts(r.filter((x) => x.isActive))).catch(() => setShifts([]));
    api<Opt[]>('/hr/staff-options').then((r) => setStaff(r.filter((x) => x.id !== id))).catch(() => setStaff([]));
    setErrors({}); setError(null); setEdit(true);
  };
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
      await api(`/hr/staff/${id}`, { method: 'PUT', body: JSON.stringify(body) }); toast(t('hr.saved')); setEdit(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const addSub = async (kind: 'qualifications' | 'experiences', e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { await api(`/hr/staff/${id}/${kind}`, { method: 'POST', body: JSON.stringify(sub) }); toast(t('hr.added')); setAddQ(false); setAddX(false); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const remove = async (kind: 'qualifications' | 'experiences', sid: string) => { try { await api(`/hr/staff/${id}/${kind}/${sid}`, { method: 'DELETE' }); load(); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  const reveal = async (field: 'pan' | 'bankAccountNo') => { try { const r = await api<{ value: string | null }>(`/hr/staff/${id}/reveal`, { method: 'POST', body: JSON.stringify({ field }) }); setShown((s) => ({ ...s, [field]: r.value ?? '' })); } catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } };
  if (missing) return <EmptyState icon="users" title={t('hr.notFound')} action={<Link href="/staff" className="btn">{t('nav.staff')}</Link>} />;
  if (!p) return <SkeletonRows rows={6} />;
  const e = p.employee; const d = p.details;
  const dt = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const dash = (v: string | number | null | undefined) => (v == null || v === '' ? <span className="muted">—</span> : v);
  const canReveal = can(PERMISSIONS.HR_REVEAL);
  return (
    <>
      {!p.isSelf && <Link href={`/staff/${e.id}`} className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {e.name}</Link>}
      <PageHeader eyebrow={`${e.employeeCode} · ${e.campus}`} title={p.isSelf ? t('hr.myProfile') : e.name} description={[e.designation, e.department].filter(Boolean).join(' · ') || undefined}
        actions={p.canEdit && <button type="button" className="btn btn-primary" onClick={openEdit}><Icon name="edit" /> {t('hr.edit')}</button>} />
      {p.exit && <p className="notice"><Icon name="info" /> {p.exit.status === 'CLOSED' ? t('hr.leftOn', { d: dt(e.leftOn ?? p.exit.lastWorkingDate) }) : t('hr.exitInProgress', { d: dt(p.exit.lastWorkingDate) })} {can(PERMISSIONS.HR_EXIT) && <Link href={`/hr/exits/${p.exit.id}`}>{t('hr.openExit')}</Link>}</p>}
      <div className="hr-grid">
        <section className="card p12-block" aria-labelledby="hr-work">
          <h2 id="hr-work" className="section-title">{t('hr.work')}</h2>
          <dl className="kv">
            <div><dt>{t('hr.designation')}</dt><dd>{dash(e.designation)}</dd></div>
            <div><dt>{t('hr.joined')}</dt><dd>{dt(e.joiningDate)}</dd></div>
            <div><dt>{t('hr.confirmation')}</dt><dd>{dt(d.confirmationDate)}{d.probationEndDate && !d.confirmationDate && <span className="sub-line muted small">{t('hr.probationTill', { d: dt(d.probationEndDate) })}</span>}</dd></div>
            <div><dt>{t('hr.shift')}</dt><dd>{dash(d.shift)}</dd></div>
            <div><dt>{t('hr.reportsTo')}</dt><dd>{dash(d.reportingTo)}</dd></div>
          </dl>
        </section>
        <section className="card p12-block" aria-labelledby="hr-personal">
          <h2 id="hr-personal" className="section-title">{t('hr.personal')}</h2>
          <dl className="kv">
            <div><dt>{t('hr.fatherSpouse')}</dt><dd>{dash(d.fatherOrSpouseName)}</dd></div>
            <div><dt>{t('hr.marital')}</dt><dd>{d.maritalStatus ? t(`hr.ms.${d.maritalStatus}` as MessageKey) : dash(null)}</dd></div>
            <div><dt>{t('hr.blood')}</dt><dd>{dash(d.bloodGroup)}</dd></div>
            <div><dt>{t('hr.emergency')}</dt><dd>{d.emergencyContactName ? `${d.emergencyContactName}${d.emergencyContactPhone ? ` · ${d.emergencyContactPhone}` : ''}` : dash(null)}</dd></div>
            <div className="kv-wide"><dt>{t('hr.address')}</dt><dd>{dash(d.currentAddress ?? d.permanentAddress)}</dd></div>
          </dl>
        </section>
        <section className="card p12-block" aria-labelledby="hr-stat">
          <h2 id="hr-stat" className="section-title">{t('hr.statutory')} <span className="muted small"><Icon name="lock" size={12} /> {t('hr.protected')}</span></h2>
          <dl className="kv">
            <div><dt>PAN</dt><dd>{shown.pan ?? dash(d.pan)}{canReveal && d.pan && !shown.pan && <button type="button" className="link-btn" onClick={() => void reveal('pan')}> {t('ac2.show')}</button>}</dd></div>
            <div><dt>Aadhaar</dt><dd>{dash(d.aadhaar)}</dd></div>
            <div><dt>UAN</dt><dd>{dash(d.uanNo)}</dd></div>
            <div><dt>{t('hr.pf')}</dt><dd>{dash(d.pfNo)}</dd></div>
            <div><dt>{t('hr.esi')}</dt><dd>{dash(d.esiNo)}</dd></div>
            <div><dt>{t('hr.bank')}</dt><dd>{d.bankName ? <>{d.bankName}<span className="sub-line small">{shown.bankAccountNo ?? d.bankAccount ?? ''}{d.ifsc ? ` · ${d.ifsc}` : ''}</span>{canReveal && d.bankAccount && !shown.bankAccountNo && <button type="button" className="link-btn" onClick={() => void reveal('bankAccountNo')}> {t('ac2.show')}</button>}</> : dash(null)}</dd></div>
          </dl>
        </section>
        <section className="card p12-block" aria-labelledby="hr-quals">
          <div className="panel-head"><h2 id="hr-quals" className="section-title">{t('hr.qualifications')}</h2>{p.canEdit && <button type="button" className="btn btn-sm" onClick={() => { setSub({ qualification: '', institution: '', yearOfPassing: '', percentage: '' }); setErrors({}); setError(null); setAddQ(true); }}><Icon name="plus" size={14} /> {t('hr.add')}</button>}</div>
          {!p.qualifications.length ? <p className="muted">{t('hr.noQuals')}</p> : <ul className="p12-action-list">{p.qualifications.map((q) => <li key={q.id}><span><strong>{q.qualification}</strong><span className="sub-line muted small">{q.institution} · {q.yearOfPassing}{q.percentage != null ? ` · ${q.percentage}%` : ''}</span></span>{p.canEdit && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('hr.removeOf', { name: q.qualification })} onClick={() => void remove('qualifications', q.id)}><Icon name="trash" size={14} /></button>}</li>)}</ul>}
          <div className="panel-head"><h2 className="section-title">{t('hr.experience')}</h2>{p.canEdit && <button type="button" className="btn btn-sm" onClick={() => { setSub({ organisation: '', designation: '', fromDate: '', toDate: '' }); setErrors({}); setError(null); setAddX(true); }}><Icon name="plus" size={14} /> {t('hr.add')}</button>}</div>
          {!p.experiences.length ? <p className="muted">{t('hr.noExp')}</p> : <ul className="p12-action-list">{p.experiences.map((x) => <li key={x.id}><span><strong>{x.organisation}</strong><span className="sub-line muted small">{x.designation} · {dt(x.fromDate)} – {dt(x.toDate)}</span></span>{p.canEdit && <button type="button" className="btn btn-sm btn-ghost" aria-label={t('hr.removeOf', { name: x.organisation })} onClick={() => void remove('experiences', x.id)}><Icon name="trash" size={14} /></button>}</li>)}</ul>}
        </section>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title={t('hr.editTitle', { name: e.name })} subtitle={t('hr.editSub')} onSubmit={save} submitLabel={t('common.save')} busy={busy} error={error} wide>
        <h3 className="section-title">{t('hr.work')}</h3>
        <div className="grid-3">
          <Field id="hp-desig" label={t('hr.designation')}><select id="hp-desig" value={form.designationId} onChange={set('designationId')}><option value="">—</option>{desigs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field id="hp-shift" label={t('hr.shift')} error={errors.shiftId}><select id="hp-shift" value={form.shiftId} onChange={set('shiftId')}><option value="">—</option>{shifts.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.campus}</option>)}</select></Field>
          <Field id="hp-mgr" label={t('hr.reportsTo')} error={errors.reportingToId}><select id="hp-mgr" value={form.reportingToId} onChange={set('reportingToId')}><option value="">—</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="hp-prob" label={t('hr.probationEnd')} error={errors.probationEndDate}><input id="hp-prob" type="date" value={form.probationEndDate} onChange={set('probationEndDate')} /></Field>
          <Field id="hp-conf" label={t('hr.confirmation')} error={errors.confirmationDate}><input id="hp-conf" type="date" value={form.confirmationDate} onChange={set('confirmationDate')} /></Field>
        </div>
        <h3 className="section-title">{t('hr.personal')}</h3>
        <div className="grid-3">
          <Field id="hp-fs" label={t('hr.fatherSpouse')}><input id="hp-fs" value={form.fatherOrSpouseName} onChange={set('fatherOrSpouseName')} /></Field>
          <Field id="hp-ms" label={t('hr.marital')}><select id="hp-ms" value={form.maritalStatus} onChange={set('maritalStatus')}><option value="">—</option>{MARITAL_STATUSES.map((x) => <option key={x} value={x}>{t(`hr.ms.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="hp-bg" label={t('hr.blood')}><select id="hp-bg" value={form.bloodGroup} onChange={set('bloodGroup')}><option value="">—</option>{BLOOD_GROUPS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="hp-ecn" label={t('hr.emergencyName')}><input id="hp-ecn" value={form.emergencyContactName} onChange={set('emergencyContactName')} /></Field>
          <Field id="hp-ecp" label={t('hr.emergencyPhone')} error={errors.emergencyContactPhone}><input id="hp-ecp" inputMode="numeric" value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="hp-ca" label={t('hr.currentAddress')}><textarea id="hp-ca" rows={2} value={form.currentAddress} onChange={set('currentAddress')} /></Field>
          <Field id="hp-pa" label={t('hr.permanentAddress')}><textarea id="hp-pa" rows={2} value={form.permanentAddress} onChange={set('permanentAddress')} /></Field>
        </div>
        <h3 className="section-title">{t('hr.statutory')}</h3>
        <div className="grid-3">
          <Field id="hp-pan" label="PAN" hint={d.pan ? t('ac2.vendor.panKeep', { p: d.pan }) : t('ac2.vendor.encrypted')} error={errors.pan}><input id="hp-pan" maxLength={10} value={form.pan} onChange={set('pan')} autoComplete="off" /></Field>
          <Field id="hp-aad" label={t('hr.aadhaar4')} hint={t('hr.aadhaar4Hint')} error={errors.aadhaarLast4}><input id="hp-aad" maxLength={4} inputMode="numeric" value={form.aadhaarLast4} onChange={set('aadhaarLast4')} autoComplete="off" /></Field>
          <Field id="hp-uan" label="UAN" error={errors.uanNo}><input id="hp-uan" inputMode="numeric" maxLength={12} value={form.uanNo} onChange={set('uanNo')} /></Field>
        </div>
        <div className="grid-2">
          <Field id="hp-pf" label={t('hr.pf')} error={errors.pfNo}><input id="hp-pf" value={form.pfNo} onChange={set('pfNo')} /></Field>
          <Field id="hp-esi" label={t('hr.esi')} error={errors.esiNo}><input id="hp-esi" inputMode="numeric" value={form.esiNo} onChange={set('esiNo')} /></Field>
        </div>
        <div className="grid-3">
          <Field id="hp-bank" label={t('ac2.vendor.bankName')}><input id="hp-bank" value={form.bankName} onChange={set('bankName')} /></Field>
          <Field id="hp-acno" label={t('ac2.vendor.accountNo')} hint={d.bankAccount ? t('ac2.vendor.panKeep', { p: d.bankAccount }) : t('ac2.vendor.encrypted')} error={errors.bankAccountNo}><input id="hp-acno" inputMode="numeric" value={form.bankAccountNo} onChange={set('bankAccountNo')} autoComplete="off" /></Field>
          <Field id="hp-ifsc" label="IFSC" error={errors.ifsc}><input id="hp-ifsc" maxLength={11} value={form.ifsc} onChange={set('ifsc')} /></Field>
        </div>
      </Modal>
      <Modal open={addQ} onClose={() => setAddQ(false)} title={t('hr.addQual')} onSubmit={(ev) => void addSub('qualifications', ev)} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2"><Field id="q-q" label={t('hr.qualification')} error={errors.qualification}><input id="q-q" value={sub.qualification ?? ''} onChange={(ev) => setSub((s) => ({ ...s, qualification: ev.target.value }))} placeholder="B.Ed, M.Sc …" /></Field><Field id="q-i" label={t('hr.institution')} error={errors.institution}><input id="q-i" value={sub.institution ?? ''} onChange={(ev) => setSub((s) => ({ ...s, institution: ev.target.value }))} /></Field></div>
        <div className="grid-2"><Field id="q-y" label={t('hr.year')} error={errors.yearOfPassing}><input id="q-y" inputMode="numeric" value={sub.yearOfPassing ?? ''} onChange={(ev) => setSub((s) => ({ ...s, yearOfPassing: ev.target.value }))} /></Field><Field id="q-p" label={t('hr.percent')} error={errors.percentage}><input id="q-p" inputMode="decimal" value={sub.percentage ?? ''} onChange={(ev) => setSub((s) => ({ ...s, percentage: ev.target.value }))} /></Field></div>
      </Modal>
      <Modal open={addX} onClose={() => setAddX(false)} title={t('hr.addExp')} onSubmit={(ev) => void addSub('experiences', ev)} submitLabel={t('common.save')} busy={busy} error={error}>
        <div className="grid-2"><Field id="x-o" label={t('hr.organisation')} error={errors.organisation}><input id="x-o" value={sub.organisation ?? ''} onChange={(ev) => setSub((s) => ({ ...s, organisation: ev.target.value }))} /></Field><Field id="x-d" label={t('hr.designation')} error={errors.designation}><input id="x-d" value={sub.designation ?? ''} onChange={(ev) => setSub((s) => ({ ...s, designation: ev.target.value }))} /></Field></div>
        <div className="grid-2"><Field id="x-f" label={t('ac2.rep.from')} error={errors.fromDate}><input id="x-f" type="date" value={sub.fromDate ?? ''} onChange={(ev) => setSub((s) => ({ ...s, fromDate: ev.target.value }))} /></Field><Field id="x-t" label={t('ac2.rep.to')} error={errors.toDate}><input id="x-t" type="date" value={sub.toDate ?? ''} onChange={(ev) => setSub((s) => ({ ...s, toDate: ev.target.value }))} /></Field></div>
      </Modal>
    </>
  );
}
