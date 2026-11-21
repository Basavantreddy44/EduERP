'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { SCORE_TYPES } from '@eduerp/shared';
import { api, uploadFile } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { score, usePlcOptions } from '@/components/placements';

interface Row {
  id: string; name: string; admissionNo: string; campusId: string; programId: string | null; program: string | null; className: string | null; hasLogin: boolean;
  profile: { isOptedIn: boolean; isPlaced: boolean; passingYear: number | null; scoreType: string | null; score: string | null; backlogs: number | null; skills: string | null; preferredLocations: string | null; resumeFileId: string | null; verifiedAt: string | null } | null;
}
type Form = { s: Row; isOptedIn: boolean; passingYear: string; scoreType: string; score: string; backlogs: string; skills: string; preferredLocations: string };

/** Placements → Students (M19.1): the placement cell records each student's score and backlogs (verified). */
export default function PlacementStudentsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const opts = usePlcOptions();
  const [campusId, setCampusId] = useState('');
  const [programId, setProgramId] = useState('');
  const [year, setYear] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setRows(null);
    const p = new URLSearchParams();
    if (campusId) p.set('campusId', campusId);
    if (programId) p.set('programId', programId);
    if (year) p.set('passingYear', year);
    if (q.trim().length >= 2) p.set('q', q.trim());
    api<Row[]>(`/placements/students?${p}`).then(setRows).catch(() => setRows([]));
  }, [campusId, programId, year, q]);
  useEffect(() => { const h = window.setTimeout(load, 250); return () => window.clearTimeout(h); }, [load]);
  const edit = (s: Row) => { setErrors({}); setError(null); setForm({ s, isOptedIn: s.profile?.isOptedIn ?? true, passingYear: String(s.profile?.passingYear ?? new Date().getFullYear() + 1), scoreType: s.profile?.scoreType ?? 'CGPA', score: s.profile?.score ?? '', backlogs: s.profile?.backlogs == null ? '' : String(s.profile.backlogs), skills: s.profile?.skills ?? '', preferredLocations: s.profile?.preferredLocations ?? '' }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(`/placements/students/${form.s.id}/profile`, { method: 'PUT', body: JSON.stringify({ isOptedIn: form.isOptedIn, passingYear: Number(form.passingYear), scoreType: form.score ? form.scoreType : null, score: form.score || null, backlogs: form.backlogs === '' ? null : Number(form.backlogs), skills: form.skills || null, preferredLocations: form.preferredLocations || null }) });
      toast(t('plc.p.saved')); setForm(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const resume = async (file: File | undefined) => {
    if (!file || !form) return;
    try { await uploadFile(`/placements/students/${form.s.id}/resume`, file); toast(t('plc.p.resumeSaved')); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed'), 'bad'); }
  };
  const manage = !!opts?.can.manage;
  const progs = (opts?.programs ?? []).filter((p) => !campusId || p.campusId === campusId);
  return (
    <>
      <PageHeader eyebrow={t('nav.placements')} title={t('plc.p.title')} description={t('plc.p.desc')} />
      <div className="filter-bar card">
        {opts && opts.campuses.length > 1 && <label className="inv-f">{t('act.campus')}<select value={campusId} onChange={(e) => { setCampusId(e.target.value); setProgramId(''); }}><option value="">{t('inv.allCampuses')}</option>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="inv-f">{t('plc.programme')}<select value={programId} onChange={(e) => setProgramId(e.target.value)}><option value="">{t('plc.allProgrammes')}</option>{progs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="inv-f">{t('plc.passingYear')}<select value={year} onChange={(e) => setYear(e.target.value)}><option value="">{t('act.all')}</option>{opts?.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <label className="inv-f">{t('inv.search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('act.findStudent')} /></label>
      </div>
      <p className="muted small"><Icon name="info" size={14} /> {t('plc.p.scoreNote')}</p>
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="users" title={t('plc.p.none')} /> : (
        <div className="table-wrap card" role="region" aria-label={t('plc.p.title')} tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">{t('act.student')}</th><th scope="col">{t('plc.passingYear')}</th><th scope="col">{t('plc.score')}</th><th scope="col" className="num">{t('plc.backlogs')}</th><th scope="col">{t('act.status')}</th>{manage && <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>}</tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong><span className="sub-line muted small">{[s.admissionNo, s.program, s.className].filter(Boolean).join(' · ')}</span></td>
                <td>{s.profile?.passingYear ?? '—'}</td>
                <td>{score(s.profile?.score ?? null, s.profile?.scoreType ?? null)}{s.profile?.verifiedAt && <span className="sub-line muted small">{t('plc.p.verifiedOn', { d: new Date(s.profile.verifiedAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}</td>
                <td className="num">{s.profile?.backlogs ?? '—'}</td>
                <td>{!s.profile ? <span className="muted small">{t('plc.p.noProfile')}</span> : s.profile.isPlaced ? <span className="pill pill-ok"><span className="pill-dot" />{t('plc.p.placed')}</span> : s.profile.isOptedIn ? <span className="pill pill-info"><span className="pill-dot" />{t('plc.p.optedIn')}</span> : <span className="pill pill-muted"><span className="pill-dot" />{t('plc.p.optedOut')}</span>}
                  {s.profile?.resumeFileId && <span className="sub-line muted small">{t('plc.p.hasResume')}</span>}{!s.hasLogin && <span className="sub-line muted small">{t('plc.p.noLogin')}</span>}</td>
                {manage && <td><button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={t('act.editNamed', { n: s.name })} onClick={() => edit(s)}><Icon name="edit" size={14} /></button></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.s.name ?? ''} subtitle={t('plc.p.sub')} onSubmit={save} busy={busy} error={error} wide>
        {form && <>
          <label className="check"><input type="checkbox" checked={form.isOptedIn} onChange={(e) => setForm({ ...form, isOptedIn: e.target.checked })} /> {t('plc.p.optInLabel')}</label>
          <div className="grid-3">
            <Field id="pp-year" label={t('plc.passingYear')} error={errors.passingYear}><select id="pp-year" value={form.passingYear} onChange={(e) => setForm({ ...form, passingYear: e.target.value })}>{opts?.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
            <Field id="pp-st" label={t('plc.scoreType')} error={errors.scoreType}><select id="pp-st" value={form.scoreType} onChange={(e) => setForm({ ...form, scoreType: e.target.value })}>{SCORE_TYPES.map((s) => <option key={s} value={s}>{t(`plc.scoreT.${s}` as MessageKey)}</option>)}</select></Field>
            <Field id="pp-score" label={t('plc.score')} hint={form.scoreType === 'CGPA' ? '0–10' : '0–100'} error={errors.score}><input id="pp-score" inputMode="decimal" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} /></Field>
          </div>
          <div className="grid-3">
            <Field id="pp-bl" label={t('plc.backlogs')} hint={t('plc.p.backlogsHint')} error={errors.backlogs}><input id="pp-bl" inputMode="numeric" value={form.backlogs} onChange={(e) => setForm({ ...form, backlogs: e.target.value })} /></Field>
            <Field id="pp-sk" label={t('plc.p.skills')} error={errors.skills}><input id="pp-sk" value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Field>
            <Field id="pp-loc" label={t('plc.p.locations')} error={errors.preferredLocations}><input id="pp-loc" value={form.preferredLocations} onChange={(e) => setForm({ ...form, preferredLocations: e.target.value })} /></Field>
          </div>
          <div className="plc-resume">
            <span className="small strong">{t('plc.p.resume')}</span>
            <label className="btn btn-sm">{form.s.profile?.resumeFileId ? t('plc.p.replaceResume') : t('plc.p.uploadResume')}<input type="file" accept="application/pdf" className="sr-only" aria-label={t('plc.p.resume')} onChange={(e) => void resume(e.target.files?.[0])} /></label>
            <span className="muted small">{t('plc.p.resumeHint')}</span>
          </div>
          <p className="muted small"><Icon name="check" size={14} /> {t('plc.p.verifyNote')}</p>
        </>}
      </Modal>
    </>
  );
}
