'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { INCIDENT_STATUSES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { ClPill, PeoplePicker, Person, istIso, nowLocal } from '@/components/campuslife';

interface Row { id: string; studentId: string; student: string; admissionNo: string; type: string; severity: string; incidentAt: string; location: string | null; status: string; parentNotified: boolean; actions: string[]; mineAsReporter: boolean }
interface Type { id: string; name: string; severity: string; notifyParent: boolean; isActive: boolean }

/** Discipline → Incidents (M16.4): report, see what you may see, open to review. */
export default function IncidentsPage() {
  const { can } = useSession();
  const { t, locale } = useI18n();
  const toast = useToast();
  const report = can(PERMISSIONS.DISC_REPORT) || can(PERMISSIONS.DISC_MANAGE);
  const manage = can(PERMISSIONS.DISC_MANAGE);
  const [status, setStatus] = useState<string>(manage ? 'REPORTED' : '');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [types, setTypes] = useState<Type[]>([]);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Person | null>(null);
  const [f, setF] = useState({ typeId: '', incidentAt: nowLocal(), location: '', description: '', witnesses: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setRows(null); api<Row[]>(`/discipline/incidents${status ? `?status=${status}` : ''}`).then(setRows).catch(() => setRows([])); }, [status]);
  useEffect(load, [load]);
  useEffect(() => { api<Type[]>('/discipline/types').then((x) => setTypes(x.filter((y) => y.isActive))).catch(() => setTypes([])); }, []);
  const chosen = types.find((x) => x.id === f.typeId);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!who) { setErrors({ studentId: t('dc.pickStudent') }); return; }
    setBusy(true); setErrors({}); setError(null);
    try {
      const r = await api<{ parentNotified: boolean }>('/discipline/incidents', { method: 'POST', body: JSON.stringify({ studentId: who.id, typeId: f.typeId, incidentAt: istIso(f.incidentAt), location: f.location || null, description: f.description, witnesses: f.witnesses || null }) });
      toast(r.parentNotified ? t('dc.reportedTold') : t('dc.reported')); setOpen(false); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return (
    <>
      <PageHeader eyebrow={t('nav.discipline')} title={t('dc.title')} description={manage ? t('dc.descManage') : t('dc.desc')} actions={<>{manage && <Link href="/discipline/types" className="btn"><Icon name="settings" /> {t('dc.types')}</Link>}{report && <button type="button" className="btn btn-primary" onClick={() => { setWho(null); setF({ typeId: types[0]?.id ?? '', incidentAt: nowLocal(), location: '', description: '', witnesses: '' }); setErrors({}); setError(null); setOpen(true); }}><Icon name="plus" /> {t('dc.report')}</button>}</>} />
      <div className="tabs" role="tablist" aria-label={t('dc.title')}>
        {['', ...INCIDENT_STATUSES].map((x) => <button key={x || 'all'} role="tab" aria-selected={status === x} className={status === x ? 'on' : ''} onClick={() => setStatus(x)}>{x ? t(`dc.st.${x}` as MessageKey) : t('dc.all')}</button>)}
      </div>
      {!rows ? <SkeletonRows rows={4} /> : !rows.length ? <EmptyState icon="check" title={t('dc.none')} /> : (
        <ul className="p12-committees">{rows.map((r) => (
          <li key={r.id} className="card">
            <span><Link href={`/discipline/${r.id}`}><strong>{r.student}</strong></Link> <span className="muted small">· {r.admissionNo}</span>
              <span className="sub-line small">{r.type} · {when(r.incidentAt)}{r.location ? ` · ${r.location}` : ''}</span>
              {(r.actions.length > 0 || r.parentNotified) && <span className="sub-line muted small">{[r.actions.length ? t('dc.actionsCount', { n: r.actions.length }) : null, r.parentNotified ? t('dc.parentTold') : null].filter(Boolean).join(' · ')}</span>}
            </span>
            <span className="row-actions"><ClPill prefix="dc.sev" status={r.severity} /><ClPill prefix="dc.st" status={r.status} /><Link className="btn btn-sm" href={`/discipline/${r.id}`}>{t('dc.open')}</Link></span>
          </li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('dc.report')} subtitle={t('dc.reportSub')} onSubmit={save} submitLabel={t('dc.reportBtn')} busy={busy} error={error} wide>
        <Field id="di-who" label={t('dc.student')} error={errors.studentId}><PeoplePicker endpoint="/discipline/students" value={who} onPick={setWho} inputId="di-who" placeholder={t('dc.findStudent')} /></Field>
        <div className="grid-2">
          <Field id="di-type" label={t('dc.type')} error={errors.typeId}><select id="di-type" value={f.typeId} onChange={(e) => setF((x) => ({ ...x, typeId: e.target.value }))}>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field id="di-at" label={t('dc.when')} error={errors.incidentAt}><input id="di-at" type="datetime-local" value={f.incidentAt} onChange={(e) => setF((x) => ({ ...x, incidentAt: e.target.value }))} /></Field>
        </div>
        {chosen?.notifyParent && <p className="notice"><Icon name="bell" size={16} /> {t('dc.willTell')}</p>}
        <Field id="di-desc" label={t('dc.what')} error={errors.description}><textarea id="di-desc" rows={3} value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} /></Field>
        <div className="grid-2">
          <Field id="di-loc" label={t('dc.where')}><input id="di-loc" value={f.location} onChange={(e) => setF((x) => ({ ...x, location: e.target.value }))} /></Field>
          <Field id="di-wit" label={t('dc.witnesses')}><input id="di-wit" value={f.witnesses} onChange={(e) => setF((x) => ({ ...x, witnesses: e.target.value }))} /></Field>
        </div>
      </Modal>
    </>
  );
}
