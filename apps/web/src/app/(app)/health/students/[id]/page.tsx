'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CHECKUP_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { ClPill } from '@/components/campuslife';

interface Record_ {
  student: { id: string; name: string; admissionNo: string; bloodGroup: string | null; dob: string | null; gender: string; className: string | null };
  canManage: boolean;
  profile: { heightCm: number | null; weightKg: number | null; allergies: string | null; conditions: string | null; medications: string | null; disability: string | null; doctorName: string | null; doctorPhone: string | null; updatedAt: string; updatedBy: string | null } | null;
  visits: { id: string; visitAt: string; complaint: string; temperature: number | null; treatment: string | null; medicine: string | null; outcome: string; parentInformed: boolean; attendedBy: string | null }[];
  checkups: { id: string; checkupDate: string; checkupType: string; heightCm: number | null; weightKg: number | null; findings: string; recommendation: string | null; doctorName: string | null }[];
  vaccinations: { id: string; vaccineName: string; doseNo: number; vaccinationDate: string; nextDueDate: string | null; remarks: string | null }[];
}
const blankProfile = { heightCm: '', weightKg: '', allergies: '', conditions: '', medications: '', disability: '', doctorName: '', doctorPhone: '' };

/** A student's health record: profile, infirmary visits, check-ups and vaccinations. */
export default function HealthRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<Record_ | null>(null);
  const [missing, setMissing] = useState(false);
  const [edit, setEdit] = useState(false);
  const [p, setP] = useState(blankProfile);
  const [ck, setCk] = useState(false);
  const [c, setC] = useState({ checkupDate: todayIST(), checkupType: 'GENERAL', heightCm: '', weightKg: '', findings: '', recommendation: '', doctorName: '' });
  const [vc, setVc] = useState(false);
  const [x, setX] = useState({ vaccineName: '', doseNo: '1', vaccinationDate: todayIST(), nextDueDate: '', remarks: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Record_>(`/health/students/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const call = async (path: string, method: string, body: unknown, done: string, close: () => void) => {
    setBusy(true); setErrors({}); setError(null);
    try { await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); toast(done); close(); load(); }
    catch (e) { const a = apiErrors(e); setErrors(a.fields); setError(a.message); if (!a.message && !Object.keys(a.fields).length) toast(t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="shield" title={t('hl.rec.notFound')} action={<Link href="/health" className="btn">{t('hl.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const pr = v.profile;
  const bmi = pr?.heightCm && pr.weightKg ? (pr.weightKg / (pr.heightCm / 100) ** 2).toFixed(1) : null;
  const nul = (s: string) => (s.trim() === '' ? null : s);
  return (
    <>
      <Link href="/health" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('hl.title')}</Link>
      <PageHeader eyebrow={`${v.student.admissionNo}${v.student.className ? ` · ${v.student.className}` : ''}`} title={v.student.name}
        actions={v.canManage && <>
          <button type="button" className="btn" onClick={() => { setErrors({}); setError(null); setCk(true); }}><Icon name="clipboard" /> {t('hl.rec.addCheckup')}</button>
          <button type="button" className="btn" onClick={() => { setErrors({}); setError(null); setVc(true); }}><Icon name="shield" /> {t('hl.rec.addVacc')}</button>
          <button type="button" className="btn btn-primary" onClick={() => { setP(pr ? { heightCm: pr.heightCm?.toString() ?? '', weightKg: pr.weightKg?.toString() ?? '', allergies: pr.allergies ?? '', conditions: pr.conditions ?? '', medications: pr.medications ?? '', disability: pr.disability ?? '', doctorName: pr.doctorName ?? '', doctorPhone: pr.doctorPhone ?? '' } : blankProfile); setErrors({}); setError(null); setEdit(true); }}><Icon name="edit" /> {t('hl.rec.editProfile')}</button>
        </>} />
      {pr?.allergies && <div className="notice notice-warn" role="note"><Icon name="alert" size={16} /> <span><strong>{t('hl.rec.allergies')}:</strong> {pr.allergies}</span></div>}
      <section className="card p12-block" aria-labelledby="hr-prof">
        <h2 id="hr-prof" className="section-title">{t('hl.rec.profile')}</h2>
        <dl className="kv">
          <div><dt>{t('hl.rec.blood')}</dt><dd>{v.student.bloodGroup ?? '—'}</dd></div>
          <div><dt>{t('hl.rec.height')}</dt><dd>{pr?.heightCm ? `${pr.heightCm} cm` : '—'}</dd></div>
          <div><dt>{t('hl.rec.weight')}</dt><dd>{pr?.weightKg ? `${pr.weightKg} kg` : '—'}{bmi && <span className="sub-line muted small">BMI {bmi}</span>}</dd></div>
          <div><dt>{t('hl.rec.conditions')}</dt><dd>{pr?.conditions ?? '—'}</dd></div>
          <div><dt>{t('hl.rec.medications')}</dt><dd>{pr?.medications ?? '—'}</dd></div>
          <div><dt>{t('hl.rec.disability')}</dt><dd>{pr?.disability ?? '—'}</dd></div>
          <div><dt>{t('hl.rec.doctor')}</dt><dd>{pr?.doctorName ?? '—'}{pr?.doctorPhone && <span className="sub-line muted small">{pr.doctorPhone}</span>}</dd></div>
        </dl>
        {!pr && <p className="muted small">{t('hl.rec.noProfile')}</p>}
      </section>
      <section className="card p12-block" aria-labelledby="hr-visits">
        <h2 id="hr-visits" className="section-title">{t('hl.visits')}</h2>
        {!v.visits.length ? <p className="muted">{t('hl.rec.noVisits')}</p> : (
          <ul className="p12-action-list">{v.visits.map((x2) => (
            <li key={x2.id}><span><strong>{x2.complaint}</strong><span className="sub-line muted small">{when(x2.visitAt)}{x2.temperature != null ? ` · ${t('hl.temp', { t: x2.temperature })}` : ''}{x2.treatment ? ` · ${x2.treatment}` : ''}{x2.attendedBy ? ` · ${x2.attendedBy}` : ''}</span></span>
              <span className="row-actions"><ClPill prefix="hl.out" status={x2.outcome} /></span></li>
          ))}</ul>
        )}
      </section>
      <div className="hr-grid">
        <section className="card p12-block" aria-labelledby="hr-vacc">
          <h2 id="hr-vacc" className="section-title">{t('hl.rec.vaccinations')}</h2>
          {!v.vaccinations.length ? <p className="muted">{t('hl.rec.noVacc')}</p> : (
            <ul className="p12-action-list">{v.vaccinations.map((x2) => (
              <li key={x2.id}><span><strong>{x2.vaccineName}</strong> <span className="muted small">· {t('hl.rec.dose', { n: x2.doseNo })}</span><span className="sub-line muted small">{d(x2.vaccinationDate)}{x2.nextDueDate ? ` · ${t('hl.rec.nextDue', { d: d(x2.nextDueDate) })}` : ''}</span></span>
                {v.canManage && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} aria-label={t('hl.rec.removeNamed', { name: x2.vaccineName })} onClick={() => void call(`/health/students/${id}/vaccinations/${x2.id}`, 'DELETE', undefined, t('hl.rec.removed'), () => undefined)}><Icon name="trash" size={16} /></button>}</li>
            ))}</ul>
          )}
        </section>
        <section className="card p12-block" aria-labelledby="hr-ck">
          <h2 id="hr-ck" className="section-title">{t('hl.rec.checkups')}</h2>
          {!v.checkups.length ? <p className="muted">{t('hl.rec.noCheckups')}</p> : (
            <ul className="p12-action-list">{v.checkups.map((x2) => (
              <li key={x2.id}><span><strong>{t(`hl.ck.${x2.checkupType}` as MessageKey)}</strong> <span className="muted small">· {d(x2.checkupDate)}</span><span className="sub-line small">{x2.findings}</span>{x2.recommendation && <span className="sub-line muted small">{x2.recommendation}</span>}</span>
                {v.canManage && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} aria-label={t('hl.rec.removeNamed', { name: t(`hl.ck.${x2.checkupType}` as MessageKey) })} onClick={() => void call(`/health/students/${id}/checkups/${x2.id}`, 'DELETE', undefined, t('hl.rec.removed'), () => undefined)}><Icon name="trash" size={16} /></button>}</li>
            ))}</ul>
          )}
        </section>
      </div>
      <Modal open={edit} onClose={() => setEdit(false)} title={t('hl.rec.editProfile')} subtitle={t('hl.rec.privacy')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`/health/students/${id}/profile`, 'PUT', { heightCm: nul(p.heightCm), weightKg: nul(p.weightKg), allergies: nul(p.allergies), conditions: nul(p.conditions), medications: nul(p.medications), disability: nul(p.disability), doctorName: nul(p.doctorName), doctorPhone: nul(p.doctorPhone) }, t('hl.rec.profileSaved'), () => setEdit(false)); }} submitLabel={t('hl.rec.save')} busy={busy} error={error} wide>
        <div className="grid-2">
          <Field id="hp-h" label={t('hl.rec.heightCm')} error={errors.heightCm}><input id="hp-h" inputMode="decimal" value={p.heightCm} onChange={(e) => setP((s) => ({ ...s, heightCm: e.target.value }))} /></Field>
          <Field id="hp-w" label={t('hl.rec.weightKg')} error={errors.weightKg}><input id="hp-w" inputMode="decimal" value={p.weightKg} onChange={(e) => setP((s) => ({ ...s, weightKg: e.target.value }))} /></Field>
        </div>
        <Field id="hp-al" label={t('hl.rec.allergies')} hint={t('hl.rec.allergiesHint')}><input id="hp-al" value={p.allergies} onChange={(e) => setP((s) => ({ ...s, allergies: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="hp-co" label={t('hl.rec.conditions')}><input id="hp-co" value={p.conditions} onChange={(e) => setP((s) => ({ ...s, conditions: e.target.value }))} /></Field>
          <Field id="hp-me" label={t('hl.rec.medications')}><input id="hp-me" value={p.medications} onChange={(e) => setP((s) => ({ ...s, medications: e.target.value }))} /></Field>
        </div>
        <Field id="hp-di" label={t('hl.rec.disability')}><input id="hp-di" value={p.disability} onChange={(e) => setP((s) => ({ ...s, disability: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="hp-dn" label={t('hl.rec.doctorName')}><input id="hp-dn" value={p.doctorName} onChange={(e) => setP((s) => ({ ...s, doctorName: e.target.value }))} /></Field>
          <Field id="hp-dp" label={t('hl.rec.doctorPhone')} error={errors.doctorPhone}><input id="hp-dp" inputMode="tel" value={p.doctorPhone} onChange={(e) => setP((s) => ({ ...s, doctorPhone: e.target.value }))} /></Field>
        </div>
      </Modal>
      <Modal open={ck} onClose={() => setCk(false)} title={t('hl.rec.addCheckup')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`/health/students/${id}/checkups`, 'POST', { ...c, heightCm: nul(c.heightCm), weightKg: nul(c.weightKg), recommendation: nul(c.recommendation), doctorName: nul(c.doctorName) }, t('hl.rec.checkupSaved'), () => setCk(false)); }} submitLabel={t('hl.rec.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="hc-d" label={t('hl.rec.date')} error={errors.checkupDate}><input id="hc-d" type="date" max={todayIST()} value={c.checkupDate} onChange={(e) => setC((s) => ({ ...s, checkupDate: e.target.value }))} /></Field>
          <Field id="hc-t" label={t('hl.rec.type')}><select id="hc-t" value={c.checkupType} onChange={(e) => setC((s) => ({ ...s, checkupType: e.target.value }))}>{CHECKUP_TYPES.map((k) => <option key={k} value={k}>{t(`hl.ck.${k}` as MessageKey)}</option>)}</select></Field>
        </div>
        <div className="grid-2">
          <Field id="hc-h" label={t('hl.rec.heightCm')} error={errors.heightCm}><input id="hc-h" inputMode="decimal" value={c.heightCm} onChange={(e) => setC((s) => ({ ...s, heightCm: e.target.value }))} /></Field>
          <Field id="hc-w" label={t('hl.rec.weightKg')} error={errors.weightKg}><input id="hc-w" inputMode="decimal" value={c.weightKg} onChange={(e) => setC((s) => ({ ...s, weightKg: e.target.value }))} /></Field>
        </div>
        <Field id="hc-f" label={t('hl.rec.findings')} error={errors.findings}><input id="hc-f" value={c.findings} onChange={(e) => setC((s) => ({ ...s, findings: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="hc-r" label={t('hl.rec.recommendation')}><input id="hc-r" value={c.recommendation} onChange={(e) => setC((s) => ({ ...s, recommendation: e.target.value }))} /></Field>
          <Field id="hc-doc" label={t('hl.rec.doctorName')}><input id="hc-doc" value={c.doctorName} onChange={(e) => setC((s) => ({ ...s, doctorName: e.target.value }))} /></Field>
        </div>
      </Modal>
      <Modal open={vc} onClose={() => setVc(false)} title={t('hl.rec.addVacc')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call(`/health/students/${id}/vaccinations`, 'POST', { vaccineName: x.vaccineName, doseNo: Number(x.doseNo || 1), vaccinationDate: x.vaccinationDate, nextDueDate: nul(x.nextDueDate), remarks: nul(x.remarks) }, t('hl.rec.vaccSaved'), () => setVc(false)); }} submitLabel={t('hl.rec.save')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="hx-n" label={t('hl.rec.vaccine')} error={errors.vaccineName}><input id="hx-n" value={x.vaccineName} onChange={(e) => setX((s) => ({ ...s, vaccineName: e.target.value }))} /></Field>
          <Field id="hx-dose" label={t('hl.rec.doseLabel')} error={errors.doseNo}><input id="hx-dose" inputMode="numeric" value={x.doseNo} onChange={(e) => setX((s) => ({ ...s, doseNo: e.target.value }))} /></Field>
        </div>
        <div className="grid-2">
          <Field id="hx-d" label={t('hl.rec.givenOn')} error={errors.vaccinationDate}><input id="hx-d" type="date" max={todayIST()} value={x.vaccinationDate} onChange={(e) => setX((s) => ({ ...s, vaccinationDate: e.target.value }))} /></Field>
          <Field id="hx-next" label={t('hl.rec.nextDueLabel')} hint={t('hl.rec.nextDueHint')} error={errors.nextDueDate}><input id="hx-next" type="date" value={x.nextDueDate} onChange={(e) => setX((s) => ({ ...s, nextDueDate: e.target.value }))} /></Field>
        </div>
        <Field id="hx-r" label={t('ac2.notes')}><input id="hx-r" value={x.remarks} onChange={(e) => setX((s) => ({ ...s, remarks: e.target.value }))} /></Field>
      </Modal>
    </>
  );
}
