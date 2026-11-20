'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERMISSIONS, VISIT_OUTCOMES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { ClPill, PeoplePicker, Person, istIso, nowLocal } from '@/components/campuslife';

interface Visit { id: string; patientType: string; studentId: string | null; name: string; visitAt: string; complaint: string; temperature: number | null; treatment: string | null; medicine: string | null; outcome: string; parentInformed: boolean }
interface Due { studentId: string; name: string; admissionNo: string; vaccineName: string; nextDose: number; dueDate: string; overdue: boolean }

/** Health → Infirmary (M16.3): visits, recording a visit, vaccinations due, a student's health record. */
export default function InfirmaryPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const manage = can(PERMISSIONS.HEALTH_MANAGE);
  const [tab, setTab] = useState<'visits' | 'due'>('visits');
  const [from, setFrom] = useState(new Date(Date.parse(`${todayIST()}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10));
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [due, setDue] = useState<Due[] | null>(null);
  const [find, setFind] = useState<Person | null>(null);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  const [v, setV] = useState({ visitAt: nowLocal(), complaint: '', temperature: '', treatment: '', medicine: '', outcome: 'RETURNED_TO_CLASS' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Visit[]>(`/health/visits?from=${from}`).then(setVisits).catch(() => setVisits([]));
    api<Due[]>('/health/vaccinations/due?days=30').then(setDue).catch(() => setDue([]));
  }, [from]);
  useEffect(load, [load]);
  useEffect(() => { api<{ id: string; name: string }[]>('/campuses').then(setCampuses).catch(() => setCampuses([])); }, []);
  useEffect(() => { if (find?.type === 'STUDENT') router.push(`/health/students/${find.id}`); }, [find, router]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!who) { setErrors({ memberId: t('hl.pickPatient') }); return; }
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ parentInformed: boolean }>('/health/visits', { method: 'POST', body: JSON.stringify({ memberType: who.type, memberId: who.id, campusId: who.campusId, visitAt: istIso(v.visitAt), complaint: v.complaint, temperature: v.temperature || null, treatment: v.treatment || null, medicine: v.medicine || null, outcome: v.outcome }) });
      toast(r.parentInformed ? t('hl.savedTold') : t('hl.saved')); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  void campuses;
  return (
    <>
      <PageHeader eyebrow={t('nav.health')} title={t('hl.title')} description={t('hl.desc')} actions={manage && <button type="button" className="btn btn-primary" onClick={() => { setWho(null); setV({ visitAt: nowLocal(), complaint: '', temperature: '', treatment: '', medicine: '', outcome: 'RETURNED_TO_CLASS' }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" /> {t('hl.record')}</button>} />
      <section className="card p12-block" aria-labelledby="hl-find">
        <h2 id="hl-find" className="section-title">{t('hl.findTitle')}</h2>
        <Field id="hl-find-in" label={t('hl.findLabel')}><PeoplePicker endpoint="/health/people" value={find} onPick={setFind} inputId="hl-find-in" placeholder={t('hl.findPh')} /></Field>
      </section>
      <div className="tabs" role="tablist" aria-label={t('hl.title')}>
        <button role="tab" aria-selected={tab === 'visits'} className={tab === 'visits' ? 'on' : ''} onClick={() => setTab('visits')}>{t('hl.visits')}</button>
        <button role="tab" aria-selected={tab === 'due'} className={tab === 'due' ? 'on' : ''} onClick={() => setTab('due')}>{t('hl.due')} {due && due.length > 0 && <span className="count">{due.length}</span>}</button>
      </div>
      {tab === 'visits' && (
        <>
          <div className="filter-bar"><label htmlFor="hl-from">{t('hl.since')}</label><input id="hl-from" type="date" value={from} max={todayIST()} onChange={(e) => setFrom(e.target.value)} /></div>
          {!visits ? <SkeletonRows rows={4} /> : !visits.length ? <EmptyState icon="check" title={t('hl.noVisits')} /> : (
            <div className="table-wrap card" role="region" aria-label={t('hl.visits')} tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">{t('hl.when')}</th><th scope="col">{t('hl.patient')}</th><th scope="col">{t('hl.complaint')}</th><th scope="col">{t('hl.outcome')}</th></tr></thead>
                <tbody>{visits.map((x) => (
                  <tr key={x.id}>
                    <td>{when(x.visitAt)}</td>
                    <td>{x.studentId ? <Link href={`/health/students/${x.studentId}`}>{x.name}</Link> : x.name}<span className="sub-line muted small">{x.patientType === 'EMPLOYEE' ? t('cl.staff') : t('cl.student')}</span></td>
                    <td>{x.complaint}{x.temperature != null && <span className="sub-line muted small">{t('hl.temp', { t: x.temperature })}</span>}{x.treatment && <span className="sub-line muted small">{x.treatment}{x.medicine ? ` · ${x.medicine}` : ''}</span>}</td>
                    <td><ClPill prefix="hl.out" status={x.outcome} />{x.parentInformed && <span className="sub-line muted small">{t('hl.parentTold')}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {tab === 'due' && (!due ? <SkeletonRows rows={3} /> : !due.length ? <EmptyState icon="check" title={t('hl.noDue')} /> : (
        <ul className="p12-action-list card p12-block">{due.map((x) => (
          <li key={`${x.studentId}-${x.vaccineName}`}><span><Link href={`/health/students/${x.studentId}`}><strong>{x.name}</strong></Link> <span className="muted small">· {x.admissionNo}</span><span className="sub-line small">{t('hl.doseLine', { v: x.vaccineName, n: x.nextDose })}</span></span>
            <span className={`pill ${x.overdue ? 'pill-bad' : 'pill-warn'}`}>{x.overdue ? t('hl.overdueOn', { d: d(x.dueDate) }) : t('hl.dueOn', { d: d(x.dueDate) })}</span></li>
        ))}</ul>
      ))}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hl.record')} subtitle={t('hl.recordSub')} onSubmit={save} submitLabel={t('hl.saveVisit')} busy={busy} error={error} wide>
        <Field id="hv-who" label={t('hl.patient')} error={errors.memberId}><PeoplePicker endpoint="/health/people" value={who} onPick={setWho} inputId="hv-who" placeholder={t('hl.findPh')} /></Field>
        <div className="grid-2">
          <Field id="hv-at" label={t('hl.when')} error={errors.visitAt}><input id="hv-at" type="datetime-local" value={v.visitAt} onChange={(e) => setV((x) => ({ ...x, visitAt: e.target.value }))} /></Field>
          <Field id="hv-temp" label={t('hl.tempLabel')} hint={t('hl.tempHint')} error={errors.temperature}><input id="hv-temp" inputMode="decimal" value={v.temperature} onChange={(e) => setV((x) => ({ ...x, temperature: e.target.value }))} /></Field>
        </div>
        <Field id="hv-comp" label={t('hl.complaint')} error={errors.complaint}><input id="hv-comp" value={v.complaint} onChange={(e) => setV((x) => ({ ...x, complaint: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="hv-treat" label={t('hl.treatment')}><input id="hv-treat" value={v.treatment} onChange={(e) => setV((x) => ({ ...x, treatment: e.target.value }))} /></Field>
          <Field id="hv-med" label={t('hl.medicine')}><input id="hv-med" value={v.medicine} onChange={(e) => setV((x) => ({ ...x, medicine: e.target.value }))} /></Field>
        </div>
        <fieldset className="check-group"><legend>{t('hl.outcome')}</legend>
          {VISIT_OUTCOMES.map((o) => <label key={o} className="check"><input type="radio" name="hv-out" checked={v.outcome === o} onChange={() => setV((x) => ({ ...x, outcome: o }))} /> {t(`hl.out.${o}` as MessageKey)}</label>)}
        </fieldset>
        {['SENT_HOME', 'HOSPITAL_REFERRED'].includes(v.outcome) && who?.type === 'STUDENT' && <p className="notice"><Icon name="bell" size={16} /> {t('hl.willTell')}</p>}
      </Modal>
    </>
  );
}
