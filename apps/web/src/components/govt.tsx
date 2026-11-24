'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { GOV_FIELDS, GOVT_EMPLOYMENT, MEDIUMS, MINORITY_GROUPS, PERMISSIONS, RATION_CARD_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from './Icon';
import { Field, Modal } from './Modal';
import { SkeletonRows, useToast } from './ui';
import { useDay } from './admissions';

interface Card {
  profile: { satsId: string | null; penNo: string | null; rationCardType: string | null; isEws: boolean | null; minorityGroup: string | null; isCwsn: boolean; disabilityType: string | null; mediumOfInstruction: string | null; distanceKm: number | null; previousSchool: string | null };
  missing: { SATS: string[]; UDISE: string[] };
  updatedAt: string | null;
  canEdit: boolean;
}
interface Given { id: string; scheme: string; kind: string; givenOn: string; quantity: number | null; unit: string | null; amount: string | null; reference: string | null }

const dash = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : String(v));

/** Field names come from the API in English (as in the export); show them in the reader's language. */
export function useFieldName() {
  const { t } = useI18n();
  const byLabel = new Map<string, string>(GOV_FIELDS.map((f) => [f.label, f.key]));
  return (labelOrKey: string) => { const k = byLabel.get(labelOrKey) ?? labelOrKey; return GOV_FIELDS.some((f) => f.key === k) ? t(`gov.field.${k}` as MessageKey) : labelOrKey; };
}

/** Shows a field-readiness chip for one export: ready, or what is missing. */
function Ready({ code, missing }: { code: 'SATS' | 'UDISE'; missing: string[] }) {
  const { t } = useI18n();
  const fname = useFieldName();
  return (
    <div className={`gov-ready ${missing.length ? 'warn' : 'ok'}`}>
      <Icon name={missing.length ? 'alert' : 'check'} size={16} />
      <div>
        <strong>{t(`gov.exp.${code}` as MessageKey)}</strong>
        <span className="sub-line small">{missing.length ? t('gov.missing', { list: missing.map(fname).join(', ') }) : t('gov.readyAll')}</span>
      </div>
    </div>
  );
}

/** Student profile → Government data (G1, G2): SATS / UDISE+ card, readiness, welfare received. */
export function StudentGov({ studentId }: { studentId: string }) {
  const { t } = useI18n();
  const { can, hasModule } = useSession();
  const toast = useToast();
  const day = useDay();
  const [c, setC] = useState<Card | null>(null);
  const [given, setGiven] = useState<Given[] | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean> | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const welfare = hasModule('STUDENTS') && [PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.WELFARE_MANAGE].some((p) => can(p));
  const load = useCallback(() => {
    api<Card>(`/govt/students/${studentId}`).then(setC).catch(() => setC(null));
    if (welfare) api<Given[]>(`/welfare/students/${studentId}`).then(setGiven).catch(() => setGiven([]));
  }, [studentId, welfare]);
  useEffect(load, [load]);
  if (!c) return <SkeletonRows rows={4} />;
  const p = c.profile;
  const yn = (v: boolean | null) => (v == null ? '—' : v ? t('gov.yes') : t('gov.no'));
  const open = () => {
    setErrors({}); setError(null);
    setForm({ satsId: p.satsId ?? '', penNo: p.penNo ?? '', rationCardType: p.rationCardType ?? '', isEws: p.isEws == null ? '' : p.isEws ? 'yes' : 'no', minorityGroup: p.minorityGroup ?? '', isCwsn: p.isCwsn, disabilityType: p.disabilityType ?? '', mediumOfInstruction: p.mediumOfInstruction ?? '', distanceKm: p.distanceKm == null ? '' : String(p.distanceKm), previousSchool: p.previousSchool ?? '' });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try {
      await api(`/govt/students/${studentId}`, { method: 'PUT', body: JSON.stringify({ ...form, isEws: form.isEws === '' ? null : form.isEws === 'yes', disabilityType: form.isCwsn ? form.disabilityType : '' }) });
      toast(t('gov.cardSaved')); setForm(null); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const set = (k: string, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return (
    <div className="gov-tab">
      <div className="panel-head">
        <div><h2 className="section-title">{t('gov.cardTitle')}</h2><p className="muted small">{t('gov.cardHint')}</p></div>
        {c.canEdit && <button type="button" className="btn btn-sm" onClick={open}><Icon name="edit" size={14} /> {t('gov.edit')}</button>}
      </div>
      <div className="gov-ready-row">
        <Ready code="SATS" missing={c.missing.SATS} />
        <Ready code="UDISE" missing={c.missing.UDISE} />
      </div>
      <dl className="kv">
        <div><dt>{t('gov.f.satsId')}</dt><dd>{dash(p.satsId)}</dd></div>
        <div><dt>{t('gov.f.penNo')}</dt><dd>{dash(p.penNo)}</dd></div>
        <div><dt>{t('gov.f.medium')}</dt><dd>{p.mediumOfInstruction ? t(`gov.medium.${p.mediumOfInstruction}` as MessageKey) : '—'}</dd></div>
        <div><dt>{t('gov.f.ration')}</dt><dd>{p.rationCardType ? t(`gov.ration.${p.rationCardType}` as MessageKey) : '—'}</dd></div>
        <div><dt>{t('gov.f.ews')}</dt><dd>{yn(p.isEws)}</dd></div>
        <div><dt>{t('gov.f.minority')}</dt><dd>{p.minorityGroup ? t(`gov.minority.${p.minorityGroup}` as MessageKey) : '—'}</dd></div>
        <div><dt>{t('gov.f.cwsn')}</dt><dd>{p.isCwsn ? `${t('gov.yes')} — ${p.disabilityType}` : t('gov.no')}</dd></div>
        <div><dt>{t('gov.f.distance')}</dt><dd>{p.distanceKm == null ? '—' : t('gov.km', { n: p.distanceKm })}</dd></div>
        <div className="kv-wide"><dt>{t('gov.f.previousSchool')}</dt><dd>{dash(p.previousSchool)}</dd></div>
      </dl>
      <p className="muted small">{t('gov.cardFromProfile')}</p>

      {welfare && (
        <>
          <h2 className="section-title gov-gap">{t('gov.wf.received')}</h2>
          {!given ? <SkeletonRows rows={2} /> : !given.length ? <p className="muted">{t('gov.wf.noneYet')}</p> : (
            <ul className="p12-action-list">{given.map((g) => (
              <li key={g.id}>
                <span><strong>{g.scheme}</strong><span className="sub-line muted small">{day(g.givenOn)}{g.reference ? ` · ${t('gov.wf.ref')} ${g.reference}` : ''}</span></span>
                <span className="num">{g.kind === 'CASH' ? `₹${Number(g.amount).toLocaleString('en-IN')}` : `${g.quantity} ${g.unit ?? ''}`}</span>
              </li>
            ))}</ul>
          )}
        </>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={t('gov.cardTitle')} subtitle={t('gov.cardHint')} onSubmit={save} busy={busy} error={error}>
        {form && (
          <>
            <div className="grid-2">
              <Field id="g-sats" label={t('gov.f.satsId')} error={errors.satsId}><input id="g-sats" value={String(form.satsId)} onChange={(e) => set('satsId', e.target.value)} inputMode="numeric" autoFocus /></Field>
              <Field id="g-pen" label={t('gov.f.penNo')} error={errors.penNo}><input id="g-pen" value={String(form.penNo)} onChange={(e) => set('penNo', e.target.value)} /></Field>
              <Field id="g-med" label={t('gov.f.medium')} error={errors.mediumOfInstruction}>
                <select id="g-med" value={String(form.mediumOfInstruction)} onChange={(e) => set('mediumOfInstruction', e.target.value)}><option value="">—</option>{MEDIUMS.map((m) => <option key={m} value={m}>{t(`gov.medium.${m}` as MessageKey)}</option>)}</select>
              </Field>
              <Field id="g-ration" label={t('gov.f.ration')} error={errors.rationCardType}>
                <select id="g-ration" value={String(form.rationCardType)} onChange={(e) => set('rationCardType', e.target.value)}><option value="">—</option>{RATION_CARD_TYPES.map((m) => <option key={m} value={m}>{t(`gov.ration.${m}` as MessageKey)}</option>)}</select>
              </Field>
              <Field id="g-ews" label={t('gov.f.ews')} error={errors.isEws}>
                <select id="g-ews" value={String(form.isEws)} onChange={(e) => set('isEws', e.target.value)}><option value="">—</option><option value="yes">{t('gov.yes')}</option><option value="no">{t('gov.no')}</option></select>
              </Field>
              <Field id="g-min" label={t('gov.f.minority')} error={errors.minorityGroup}>
                <select id="g-min" value={String(form.minorityGroup)} onChange={(e) => set('minorityGroup', e.target.value)}><option value="">—</option>{MINORITY_GROUPS.map((m) => <option key={m} value={m}>{t(`gov.minority.${m}` as MessageKey)}</option>)}</select>
              </Field>
              <Field id="g-dist" label={t('gov.f.distance')} error={errors.distanceKm}><input id="g-dist" value={String(form.distanceKm)} onChange={(e) => set('distanceKm', e.target.value)} inputMode="decimal" /></Field>
              <Field id="g-prev" label={t('gov.f.previousSchool')} error={errors.previousSchool}><input id="g-prev" value={String(form.previousSchool)} onChange={(e) => set('previousSchool', e.target.value)} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={!!form.isCwsn} onChange={(e) => set('isCwsn', e.target.checked)} /> {t('gov.f.cwsnLong')}</label>
            {form.isCwsn && <Field id="g-dis" label={t('gov.f.disability')} error={errors.disabilityType}><input id="g-dis" value={String(form.disabilityType)} onChange={(e) => set('disabilityType', e.target.value)} placeholder={t('gov.f.disabilityHint')} /></Field>}
          </>
        )}
      </Modal>
    </div>
  );
}

interface Staff { govtEmployment: string | null; kgidNo: string | null; hrmsId: string | null; pranNo: string | null; gpfNo: string | null; payScale: string | null; govtServiceDate: string | null; ddoCode: string | null; canEdit: boolean }

/** HR staff profile → Government service (G4): KGID, HRMS, PRAN / GPF, pay scale, DDO code of the school. */
export function StaffGov({ employeeId }: { employeeId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const day = useDay();
  const [s, setS] = useState<Staff | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Staff>(`/govt/staff/${employeeId}`).then(setS).catch(() => setS(null)); }, [employeeId]);
  useEffect(load, [load]);
  if (!s) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErrors({}); setError(null);
    try { await api(`/govt/staff/${employeeId}`, { method: 'PUT', body: JSON.stringify(form) }); toast(t('gov.staffSaved')); setForm(null); load(); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return (
    <section className="card p12-block" aria-labelledby="hr-govt">
      <div className="panel-head">
        <h2 id="hr-govt" className="section-title">{t('gov.staffTitle')}</h2>
        {s.canEdit && <button type="button" className="btn btn-sm" onClick={() => { setErrors({}); setError(null); setForm({ govtEmployment: s.govtEmployment ?? '', kgidNo: s.kgidNo ?? '', hrmsId: s.hrmsId ?? '', pranNo: s.pranNo ?? '', gpfNo: s.gpfNo ?? '', payScale: s.payScale ?? '', govtServiceDate: s.govtServiceDate ?? '' }); }}><Icon name="edit" size={14} /> {t('gov.edit')}</button>}
      </div>
      <dl className="kv">
        <div><dt>{t('gov.f.employment')}</dt><dd>{s.govtEmployment ? t(`gov.emp.${s.govtEmployment}` as MessageKey) : '—'}</dd></div>
        <div><dt>{t('gov.f.kgid')}</dt><dd>{dash(s.kgidNo)}</dd></div>
        <div><dt>{t('gov.f.hrms')}</dt><dd>{dash(s.hrmsId)}</dd></div>
        <div><dt>{t('gov.f.pran')}</dt><dd>{dash(s.pranNo)}</dd></div>
        <div><dt>{t('gov.f.gpf')}</dt><dd>{dash(s.gpfNo)}</dd></div>
        <div><dt>{t('gov.f.payScale')}</dt><dd>{dash(s.payScale)}</dd></div>
        <div><dt>{t('gov.f.serviceFrom')}</dt><dd>{s.govtServiceDate ? day(s.govtServiceDate) : '—'}</dd></div>
        <div><dt>{t('gov.f.ddo')}</dt><dd>{dash(s.ddoCode)}</dd></div>
      </dl>
      <Modal open={!!form} onClose={() => setForm(null)} title={t('gov.staffTitle')} subtitle={t('gov.staffHint')} onSubmit={save} busy={busy} error={error}>
        {form && (
          <div className="grid-2">
            <Field id="gs-emp" label={t('gov.f.employment')} error={errors.govtEmployment}>
              <select id="gs-emp" value={form.govtEmployment} onChange={(e) => set('govtEmployment', e.target.value)} autoFocus><option value="">—</option>{GOVT_EMPLOYMENT.map((m) => <option key={m} value={m}>{t(`gov.emp.${m}` as MessageKey)}</option>)}</select>
            </Field>
            <Field id="gs-kgid" label={t('gov.f.kgid')} error={errors.kgidNo}><input id="gs-kgid" value={form.kgidNo} onChange={(e) => set('kgidNo', e.target.value)} /></Field>
            <Field id="gs-hrms" label={t('gov.f.hrms')} error={errors.hrmsId}><input id="gs-hrms" value={form.hrmsId} onChange={(e) => set('hrmsId', e.target.value)} /></Field>
            <Field id="gs-pran" label={t('gov.f.pran')} hint={t('gov.f.pranHint')} error={errors.pranNo}><input id="gs-pran" value={form.pranNo} onChange={(e) => set('pranNo', e.target.value)} inputMode="numeric" /></Field>
            <Field id="gs-gpf" label={t('gov.f.gpf')} error={errors.gpfNo}><input id="gs-gpf" value={form.gpfNo} onChange={(e) => set('gpfNo', e.target.value)} /></Field>
            <Field id="gs-pay" label={t('gov.f.payScale')} hint={t('gov.f.payScaleHint')} error={errors.payScale}><input id="gs-pay" value={form.payScale} onChange={(e) => set('payScale', e.target.value)} /></Field>
            <Field id="gs-from" label={t('gov.f.serviceFrom')} error={errors.govtServiceDate}><input id="gs-from" type="date" value={form.govtServiceDate} onChange={(e) => set('govtServiceDate', e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </section>
  );
}
