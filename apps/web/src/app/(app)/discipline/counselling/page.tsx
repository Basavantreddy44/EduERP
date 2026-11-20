'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { REFERRAL_SOURCES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PeoplePicker, Person, istIso, nowLocal } from '@/components/campuslife';

interface Row { id: string; studentId: string; student: string; admissionNo: string; sessionAt: string; referralSource: string; incidentId: string | null; followUpDate: string | null; counsellor: string | null; mine: boolean; hasNotes: boolean; isConfidential: boolean }
interface Session { id: string; studentId: string; student: string; admissionNo: string; sessionAt: string; referralSource: string; incidentId: string | null; followUpDate: string | null; counsellor: string | null; mine: boolean; isConfidential: boolean; notes: string | null; notesHidden: boolean }

/** Discipline → Counselling (M16.4): sessions with notes readable only by the counsellor who wrote them. */
function CounsellingInner() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const params = useSearchParams();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<Session | null>(null);
  const [edit, setEdit] = useState<Session | 'new' | null>(null);
  const [who, setWho] = useState<Person | null>(null);
  const [f, setF] = useState({ sessionAt: nowLocal(), referralSource: 'SELF', incidentId: '', notes: '', followUpDate: '', isConfidential: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Row[]>('/discipline/counselling').then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const s = params.get('student');
    if (!s) return;
    setWho({ type: 'STUDENT', id: s, name: t('co.fromIncident'), code: '', campusId: '', detail: null });
    setF((x) => ({ ...x, referralSource: 'DISCIPLINE', incidentId: params.get('incident') ?? '' }));
    setEdit('new');
  }, [params, t]);
  const open = async (id: string) => { try { setView(await api<Session>(`/discipline/counselling/${id}`)); } catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); } };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!who) { setErrors({ studentId: t('dc.pickStudent') }); return; }
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(edit === 'new' ? '/discipline/counselling' : `/discipline/counselling/${(edit as Session).id}`, { method: edit === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ studentId: who.id, sessionAt: istIso(f.sessionAt), referralSource: f.referralSource, incidentId: f.incidentId || null, notes: f.notes || null, followUpDate: f.followUpDate || null, isConfidential: f.isConfidential }) });
      toast(t('co.saved')); setEdit(null); setView(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  return (
    <>
      <PageHeader eyebrow={t('nav.discipline')} title={t('co.title')} description={t('co.desc')} actions={<button type="button" className="btn btn-primary" onClick={() => { setWho(null); setF({ sessionAt: nowLocal(), referralSource: 'SELF', incidentId: '', notes: '', followUpDate: '', isConfidential: true }); setErrors({}); setError(null); setEdit('new'); }}><Icon name="plus" /> {t('co.new')}</button>} />
      <p className="notice"><Icon name="lock" size={16} /> {t('co.privacy')}</p>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="users" title={t('co.none')} /> : (
        <ul className="p12-committees">{rows.map((r) => (
          <li key={r.id} className="card">
            <span><strong>{r.student}</strong> <span className="muted small">· {r.admissionNo}</span>
              <span className="sub-line small">{when(r.sessionAt)} · {t(`co.ref.${r.referralSource}` as MessageKey)}{r.counsellor ? ` · ${r.counsellor}` : ''}</span>
              {r.followUpDate && <span className="sub-line muted small">{t('co.followUp', { d: d(r.followUpDate) })}</span>}</span>
            <span className="row-actions">{r.isConfidential && <span className="pill pill-muted"><Icon name="lock" size={12} /> {t('co.confidential')}</span>}{r.incidentId && <Link className="btn btn-sm btn-ghost" href={`/discipline/${r.incidentId}`}>{t('co.incident')}</Link>}<button type="button" className="btn btn-sm" onClick={() => void open(r.id)}>{t('dc.open')}</button></span>
          </li>
        ))}</ul>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.student} · ${when(view.sessionAt)}` : ''} subtitle={view ? `${t(`co.ref.${view.referralSource}` as MessageKey)}${view.counsellor ? ` · ${view.counsellor}` : ''}` : ''} onSubmit={(e: FormEvent) => { e.preventDefault(); if (view?.mine) { setWho({ type: 'STUDENT', id: view.studentId, name: view.student, code: view.admissionNo, campusId: '', detail: null }); setF({ sessionAt: new Date(new Date(view.sessionAt).getTime() + 330 * 60_000).toISOString().slice(0, 16), referralSource: view.referralSource, incidentId: view.incidentId ?? '', notes: view.notes ?? '', followUpDate: view.followUpDate ?? '', isConfidential: view.isConfidential }); setErrors({}); setError(null); setEdit(view); setView(null); } else setView(null); }} submitLabel={view?.mine ? t('co.edit') : t('co.done')} busy={busy}>
        {view?.notesHidden ? <p className="notice"><Icon name="lock" size={16} /> {t('co.hidden')}</p> : view?.notes ? <p className="pre-wrap co-notes">{view.notes}</p> : <p className="muted">{t('co.noNotes')}</p>}
        {view?.followUpDate && <p className="muted small">{t('co.followUp', { d: d(view.followUpDate) })}</p>}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('co.new') : t('co.edit')} subtitle={t('co.formSub')} onSubmit={save} submitLabel={t('co.save')} busy={busy} error={error} wide>
        <Field id="co-who" label={t('dc.student')} error={errors.studentId}><PeoplePicker endpoint="/discipline/students" value={who} onPick={setWho} inputId="co-who" placeholder={t('dc.findStudent')} /></Field>
        <div className="grid-3">
          <Field id="co-at" label={t('co.when')} error={errors.sessionAt}><input id="co-at" type="datetime-local" value={f.sessionAt} onChange={(e) => setF((x) => ({ ...x, sessionAt: e.target.value }))} /></Field>
          <Field id="co-ref" label={t('co.referral')}><select id="co-ref" value={f.referralSource} onChange={(e) => setF((x) => ({ ...x, referralSource: e.target.value }))}>{REFERRAL_SOURCES.map((r) => <option key={r} value={r}>{t(`co.ref.${r}` as MessageKey)}</option>)}</select></Field>
          <Field id="co-fu" label={t('co.followUpLabel')} error={errors.followUpDate}><input id="co-fu" type="date" value={f.followUpDate} onChange={(e) => setF((x) => ({ ...x, followUpDate: e.target.value }))} /></Field>
        </div>
        <Field id="co-notes" label={t('co.notes')} hint={t('co.notesHint')} error={errors.notes}><textarea id="co-notes" rows={6} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></Field>
        <label className="check"><input type="checkbox" checked={f.isConfidential} onChange={(e) => setF((x) => ({ ...x, isConfidential: e.target.checked }))} /> {t('co.confidentialLabel')}</label>
      </Modal>
    </>
  );
}

export default function CounsellingPage() {
  return <Suspense fallback={<SkeletonRows rows={4} />}><CounsellingInner /></Suspense>;
}
