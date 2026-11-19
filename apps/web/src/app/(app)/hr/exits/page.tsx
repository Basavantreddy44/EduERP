'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CLEARANCE_SECTIONS, EXIT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PersonPick, PersonSearch } from '@/components/leave';

interface Row { id: string; employeeId: string; name: string; code: string; designation: string | null; exitType: string; lastWorkingDate: string; status: string; cleared: number; sections: number; myPending: string[] }
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** HR → Exits (M14.4): staff leaving, their no-dues clearance and closing. */
export default function ExitsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const manage = can(PERMISSIONS.HR_EXIT);
  const [filter, setFilter] = useState<'INITIATED' | 'CLOSED'>('INITIATED');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<PersonPick | null>(null);
  const [handover, setHandover] = useState<PersonPick | null>(null);
  const [form, setForm] = useState({ exitType: 'RESIGNATION', resignationDate: today(), lastWorkingDate: '', reason: '' });
  const [sections, setSections] = useState<string[]>(['ACCOUNTS', 'ADMIN']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Row[]>(`/hr/exits?status=${filter}`).then(setRows).catch(() => setRows([])); }, [filter]);
  useEffect(load, [load]);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ id: string }>('/hr/exits', { method: 'POST', body: JSON.stringify({ ...form, employeeId: who?.id ?? '', handoverToId: handover?.id ?? null, sections }) });
      toast(t('hr.x.started')); setOpen(false); window.location.href = `/hr/exits/${r.id}`;
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <PageHeader eyebrow={t('nav.hr')} title={t('hr.x.title')} description={t('hr.x.desc')} actions={manage && <button type="button" className="btn btn-primary" onClick={() => { setWho(null); setHandover(null); setForm({ exitType: 'RESIGNATION', resignationDate: today(), lastWorkingDate: '', reason: '' }); setSections(['ACCOUNTS', 'ADMIN']); setErrors({}); setError(null); setOpen(true); }}><Icon name="logout" /> {t('hr.x.start')}</button>} />
      <div className="tabs" role="tablist" aria-label={t('hr.x.title')}>
        {(['INITIATED', 'CLOSED'] as const).map((x) => <button key={x} role="tab" aria-selected={filter === x} className={filter === x ? 'on' : ''} onClick={() => setFilter(x)}>{t(`hr.x.f.${x}` as MessageKey)}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="check" title={filter === 'INITIATED' ? t('hr.x.noneOpen') : t('hr.x.noneClosed')} /> : (
        <ul className="p12-committees">{rows.map((x) => (
          <li key={x.id} className="card">
            <span><Link href={`/hr/exits/${x.id}`}><strong>{x.name}</strong></Link> <span className="muted small">· {x.code}{x.designation ? ` · ${x.designation}` : ''}</span>
              <span className="sub-line small">{t(`hr.x.type.${x.exitType}` as MessageKey)} · {t('hr.x.lastDay', { d: d(x.lastWorkingDate) })}</span>
              {x.status === 'INITIATED' && <span className="sub-line muted small">{t('hr.x.clearedOf', { n: x.cleared, of: x.sections })}</span>}
            </span>
            <span className="row-actions">{x.myPending.length > 0 && <span className="pill pill-warn">{t('hr.x.yourSection', { s: x.myPending.map((s) => t(`hr.sec.${s}` as MessageKey)).join(', ') })}</span>}<Link className="btn btn-sm" href={`/hr/exits/${x.id}`}>{t('hr.x.open')}</Link></span>
          </li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('hr.x.start')} subtitle={t('hr.x.startSub')} onSubmit={save} submitLabel={t('hr.x.startBtn')} busy={busy} error={error} wide>
        <Field id="lv-who" label={t('hr.x.who')} error={errors.employeeId}><PersonSearch kind="EMPLOYEE" value={who} onPick={setWho} /></Field>
        <div className="grid-3">
          <Field id="x-type" label={t('hr.x.typeLabel')}><select id="x-type" value={form.exitType} onChange={(e) => setForm((f) => ({ ...f, exitType: e.target.value }))}>{EXIT_TYPES.map((x) => <option key={x} value={x}>{t(`hr.x.type.${x}` as MessageKey)}</option>)}</select></Field>
          <Field id="x-notice" label={t('hr.x.notice')} error={errors.resignationDate}><input id="x-notice" type="date" value={form.resignationDate} onChange={(e) => setForm((f) => ({ ...f, resignationDate: e.target.value }))} /></Field>
          <Field id="x-last" label={t('hr.x.lastLabel')} error={errors.lastWorkingDate}><input id="x-last" type="date" min={form.resignationDate} value={form.lastWorkingDate} onChange={(e) => setForm((f) => ({ ...f, lastWorkingDate: e.target.value }))} /></Field>
        </div>
        <Field id="x-reason" label={t('ac2.reason')} error={errors.reason}><input id="x-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} /></Field>
        <Field id="x-hand" label={t('hr.x.handover')} hint={t('hr.x.handoverHint')} error={errors.handoverToId}><PersonSearch kind="EMPLOYEE" value={handover} onPick={setHandover} inputId="x-hand" /></Field>
        <fieldset className="check-group"><legend>{t('hr.x.sections')}</legend>
          {CLEARANCE_SECTIONS.map((s) => <label key={s} className="check"><input type="checkbox" checked={sections.includes(s)} onChange={(e) => setSections((l) => (e.target.checked ? [...l, s] : l.filter((v) => v !== s)))} /> {t(`hr.sec.${s}` as MessageKey)}</label>)}
          {errors.sections && <span className="field-error">{errors.sections}</span>}
        </fieldset>
      </Modal>
    </>
  );
}
