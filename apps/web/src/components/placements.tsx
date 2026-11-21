'use client';

import { useEffect, useState } from 'react';
import { JOB_TYPES, SCORE_TYPES, formatINR, toPaise } from '@eduerp/shared';
import type { FieldErrors } from '@/lib/form';
import { Field } from '@/components/Modal';
import { SkeletonRows } from '@/components/ui';
import { todayIST } from '@/components/accounts';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** Phase 19: placements and reports — shared bits. */

export interface PlcOpts { campuses: { id: string; name: string }[]; programs: { id: string; name: string; campusId: string }[]; companies: { id: string; name: string }[]; years: number[]; can: { manage: boolean } }
export function usePlcOptions(reload = 0) {
  const [o, setO] = useState<PlcOpts | null>(null);
  useEffect(() => { api<PlcOpts>('/placements/options').then(setO).catch(() => setO({ campuses: [], programs: [], companies: [], years: [], can: { manage: false } })); }, [reload]);
  return o;
}

const TONE: Record<string, string> = {
  DRAFT: 'pill-muted', OPEN: 'pill-ok', CLOSED: 'pill-info', COMPLETED: 'pill-muted', CANCELLED: 'pill-muted',
  APPLIED: 'pill-info', SHORTLISTED: 'pill-warn', IN_PROCESS: 'pill-warn', SELECTED: 'pill-ok', REJECTED: 'pill-bad', WITHDRAWN: 'pill-muted',
  OFFERED: 'pill-warn', ACCEPTED: 'pill-ok', DECLINED: 'pill-muted', REVOKED: 'pill-bad',
  ACTIVE: 'pill-ok', BLACKLISTED: 'pill-bad',
  QUEUED: 'pill-muted', RUNNING: 'pill-info', DONE: 'pill-ok', FAILED: 'pill-bad',
};
export function PlcPill({ prefix, status }: { prefix: string; status: string }) {
  const { t } = useI18n();
  return <span className={`pill ${TONE[status] ?? 'pill-muted'}`}><span className="pill-dot" />{t(`${prefix}.${status}` as MessageKey)}</span>;
}

/** CTC in lakhs a year (Indian campus convention), e.g. ₹4.2 L. */
export const lakh = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : `₹${(Number(v) / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`);
export const ctcRange = (min: string | null, max: string | null) => (min && max ? `${lakh(min)} – ${lakh(max)}` : min ? `${lakh(min)}+` : max ? `≤ ${lakh(max)}` : '—');
export const inrFull = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : formatINR(toPaise(String(v))));
export const score = (s: string | null, type: string | null) => (s == null ? '—' : type === 'PERCENT' ? `${Number(s)}%` : `${Number(s).toFixed(2)} CGPA`);

export const blankDrive = () => ({ campusId: '', companyId: '', title: '', jobType: 'FULL_TIME', ctcMin: '', ctcMax: '', eligibleProgramIds: [] as string[], passingYear: String(new Date().getFullYear() + 1), scoreType: 'CGPA', minScore: '', maxBacklogs: '', allowPlaced: false, lastDateToApply: todayIST(), driveDate: '', rounds: 'Aptitude, Technical, HR', description: '' });

export function driveBody(f: ReturnType<typeof blankDrive>) {
  return {
    ...f, ctcMin: f.ctcMin || null, ctcMax: f.ctcMax || null, passingYear: Number(f.passingYear), minScore: f.minScore || null, maxBacklogs: f.maxBacklogs === '' ? null : Number(f.maxBacklogs),
    driveDate: f.driveDate || null, rounds: f.rounds.split(',').map((r) => r.trim()).filter(Boolean), description: f.description || null,
  };
}

/** Drive form fields (new and edit). */
export function DriveFields({ form, setForm, errors }: { form: ReturnType<typeof blankDrive>; setForm: (f: ReturnType<typeof blankDrive>) => void; errors: FieldErrors }) {
  const { t } = useI18n();
  const opts = usePlcOptions();
  if (!opts) return <SkeletonRows rows={3} />;
  const progs = opts.programs.filter((p) => p.campusId === form.campusId);
  return (
    <>
      <div className="grid-3">
        <Field id="dr-co" label={t('plc.company')} error={errors.companyId}><select id="dr-co" value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}><option value="">{t('act.choose')}</option>{opts.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field id="dr-title" label={t('plc.d.role')} error={errors.title}><input id="dr-title" value={form.title} placeholder={t('plc.d.rolePh')} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field id="dr-type" label={t('plc.d.type')} error={errors.jobType}><select id="dr-type" value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })}>{JOB_TYPES.map((j) => <option key={j} value={j}>{t(`plc.job.${j}` as MessageKey)}</option>)}</select></Field>
      </div>
      <div className="grid-3">
        {opts.campuses.length > 1 && <Field id="dr-campus" label={t('act.campus')} error={errors.campusId}><select id="dr-campus" value={form.campusId} onChange={(e) => setForm({ ...form, campusId: e.target.value, eligibleProgramIds: [] })}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field id="dr-min" label={t('plc.d.ctcMin')} hint={t('plc.d.ctcHint')} error={errors.ctcMin}><input id="dr-min" inputMode="decimal" value={form.ctcMin} onChange={(e) => setForm({ ...form, ctcMin: e.target.value })} /></Field>
        <Field id="dr-max" label={t('plc.d.ctcMax')} error={errors.ctcMax}><input id="dr-max" inputMode="decimal" value={form.ctcMax} onChange={(e) => setForm({ ...form, ctcMax: e.target.value })} /></Field>
      </div>
      <fieldset className="plc-fieldset">
        <legend>{t('plc.d.eligibility')}</legend>
        <div className="grid-3">
          <Field id="dr-year" label={t('plc.passingYear')} error={errors.passingYear}><select id="dr-year" value={form.passingYear} onChange={(e) => setForm({ ...form, passingYear: e.target.value })}>{opts.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
          <Field id="dr-st" label={t('plc.scoreType')} error={errors.scoreType}><select id="dr-st" value={form.scoreType} onChange={(e) => setForm({ ...form, scoreType: e.target.value })}>{SCORE_TYPES.map((s) => <option key={s} value={s}>{t(`plc.scoreT.${s}` as MessageKey)}</option>)}</select></Field>
          <Field id="dr-ms" label={t('plc.d.minScore')} hint={t('act.optional')} error={errors.minScore}><input id="dr-ms" inputMode="decimal" value={form.minScore} onChange={(e) => setForm({ ...form, minScore: e.target.value })} /></Field>
        </div>
        <div className="grid-3">
          <Field id="dr-bl" label={t('plc.d.maxBacklogs')} hint={t('act.optional')} error={errors.maxBacklogs}><input id="dr-bl" inputMode="numeric" value={form.maxBacklogs} onChange={(e) => setForm({ ...form, maxBacklogs: e.target.value })} /></Field>
          <Field id="dr-last" label={t('plc.d.lastDate')} error={errors.lastDateToApply}><input id="dr-last" type="date" value={form.lastDateToApply} onChange={(e) => setForm({ ...form, lastDateToApply: e.target.value })} /></Field>
          <Field id="dr-date" label={t('plc.d.driveDate')} hint={t('act.optional')} error={errors.driveDate}><input id="dr-date" type="date" min={form.lastDateToApply} value={form.driveDate} onChange={(e) => setForm({ ...form, driveDate: e.target.value })} /></Field>
        </div>
        <div className="plc-progs" role="group" aria-label={t('plc.d.programmes')}>
          <span className="small strong">{t('plc.d.programmes')}</span>
          {progs.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={form.eligibleProgramIds.includes(p.id)} onChange={(e) => setForm({ ...form, eligibleProgramIds: e.target.checked ? [...form.eligibleProgramIds, p.id] : form.eligibleProgramIds.filter((x) => x !== p.id) })} /> {p.name}</label>)}
          <span className="muted small">{t('plc.d.programmesHint')}</span>
        </div>
        <label className="check"><input type="checkbox" checked={form.allowPlaced} onChange={(e) => setForm({ ...form, allowPlaced: e.target.checked })} /> {t('plc.d.allowPlaced')}</label>
      </fieldset>
      <Field id="dr-rounds" label={t('plc.d.rounds')} hint={t('plc.d.roundsHint')} error={errors.rounds}><input id="dr-rounds" value={form.rounds} onChange={(e) => setForm({ ...form, rounds: e.target.value })} /></Field>
      <Field id="dr-desc" label={t('act.description')} hint={t('act.optional')} error={errors.description}><textarea id="dr-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </>
  );
}
