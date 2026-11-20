'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ACTION_TYPES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { rupees, todayIST } from '@/components/accounts';
import { ClPill } from '@/components/campuslife';

interface View {
  id: string; status: string; incidentAt: string; location: string | null; description: string; witnesses: string | null; parentNotified: boolean;
  type: { name: string; severity: string; notifyParent: boolean };
  student: { id: string; name: string; admissionNo: string; className: string | null; otherIncidents: number };
  reportedBy: string | null; closedBy: string | null; closedAt: string | null; closingNote: string | null;
  actions: { id: string; actionType: string; description: string; fromDate: string | null; toDate: string | null; fineAmount: string | null; fineStatus: string; by: string | null; at: string }[];
  can: { manage: boolean; counsel: boolean };
}

/** One incident: what happened, actions taken, review and closing. */
export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [act, setAct] = useState(false);
  const [a, setA] = useState({ actionType: 'WARNING', description: '', fromDate: todayIST(), toDate: todayIST(), fineAmount: '' });
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/discipline/incidents/${id}`).then(setV).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const call = async (path: string, body: unknown, done: string, close: () => void) => {
    setBusy(true); setErrors({}); setError(null);
    try { const r = await api<{ fineStatus?: string }>(`/discipline/incidents/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); toast(r?.fineStatus === 'PENDING_APPROVAL' ? t('dc.fineWaiting') : done); close(); load(); }
    catch (x) { const e = apiErrors(x); setErrors(e.fields); setError(e.message); if (!e.message && !Object.keys(e.fields).length) toast(t('en.failed'), 'bad'); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="alert" title={t('dc.notFound')} action={<Link href="/discipline" className="btn">{t('dc.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={5} />;
  const when = (s: string) => new Date(s).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const d = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const open = v.status !== 'CLOSED';
  return (
    <>
      <Link href="/discipline" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('dc.title')}</Link>
      <PageHeader eyebrow={`${v.student.admissionNo}${v.student.className ? ` · ${v.student.className}` : ''}`} title={`${v.student.name} — ${v.type.name}`}
        actions={<>
          <ClPill prefix="dc.sev" status={v.type.severity} /><ClPill prefix="dc.st" status={v.status} />
          {v.can.manage && open && v.status === 'REPORTED' && <button type="button" className="btn" disabled={busy} onClick={() => void call('review', {}, t('dc.reviewing'), () => undefined)}>{t('dc.startReview')}</button>}
          {v.can.manage && open && <button type="button" className="btn" onClick={() => { setA({ actionType: 'WARNING', description: '', fromDate: todayIST(), toDate: todayIST(), fineAmount: '' }); setErrors({}); setError(null); setAct(true); }}><Icon name="plus" /> {t('dc.addAction')}</button>}
          {v.can.manage && open && <button type="button" className="btn btn-primary" onClick={() => { setNote(''); setError(null); setClosing(true); }}><Icon name="check" /> {t('dc.close')}</button>}
        </>} />
      <dl className="kv">
        <div><dt>{t('dc.when')}</dt><dd>{when(v.incidentAt)}</dd></div>
        <div><dt>{t('dc.where')}</dt><dd>{v.location ?? '—'}</dd></div>
        <div><dt>{t('dc.reportedBy')}</dt><dd>{v.reportedBy ?? '—'}</dd></div>
        <div><dt>{t('dc.parents')}</dt><dd>{v.parentNotified ? t('dc.parentTold') : v.type.notifyParent ? t('dc.parentNotReached') : t('dc.parentNotNeeded')}</dd></div>
        <div><dt>{t('dc.history')}</dt><dd>{v.student.otherIncidents ? t('dc.otherIncidents', { n: v.student.otherIncidents }) : t('dc.firstIncident')}</dd></div>
        {v.witnesses && <div><dt>{t('dc.witnesses')}</dt><dd>{v.witnesses}</dd></div>}
        <div className="kv-wide"><dt>{t('dc.what')}</dt><dd className="pre-wrap">{v.description}</dd></div>
        {v.status === 'CLOSED' && <div className="kv-wide"><dt>{t('dc.closedLabel')}</dt><dd>{t('dc.closedLine', { name: v.closedBy ?? '', d: v.closedAt ? when(v.closedAt) : '' })}{v.closingNote ? ` — ${v.closingNote}` : ''}</dd></div>}
      </dl>
      <section className="card p12-block" aria-labelledby="dc-actions">
        <h2 id="dc-actions" className="section-title">{t('dc.actions')}</h2>
        {!v.actions.length ? <p className="muted">{t('dc.noActions')}</p> : (
          <ul className="p12-action-list">{v.actions.map((x) => (
            <li key={x.id}><span><strong>{t(`dc.act.${x.actionType}` as MessageKey)}</strong><span className="sub-line small">{x.description}</span>
              <span className="sub-line muted small">{[x.fromDate && t('dc.fromTo', { from: d(x.fromDate), to: d(x.toDate) }), x.by, when(x.at)].filter(Boolean).join(' · ')}</span></span>
              {x.fineAmount && <span className="row-actions"><strong className="num">{rupees(x.fineAmount, { paise: true })}</strong><ClPill prefix="dc.fine" status={x.fineStatus} /></span>}</li>
          ))}</ul>
        )}
        {v.can.counsel && <p className="muted small"><Link href={`/discipline/counselling?student=${v.student.id}&incident=${v.id}`}>{t('dc.toCounselling')}</Link></p>}
      </section>
      <Modal open={act} onClose={() => setAct(false)} title={t('dc.addAction')} subtitle={t('dc.addActionSub')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call('actions', { actionType: a.actionType, description: a.description, fromDate: a.actionType === 'SUSPENSION' ? a.fromDate : null, toDate: a.actionType === 'SUSPENSION' ? a.toDate : null, fineAmount: a.actionType === 'FINE' ? a.fineAmount : null }, t('dc.actionSaved'), () => setAct(false)); }} submitLabel={t('dc.saveAction')} busy={busy} error={error}>
        <Field id="da-type" label={t('dc.actionType')}><select id="da-type" value={a.actionType} onChange={(e) => setA((x) => ({ ...x, actionType: e.target.value }))}>{ACTION_TYPES.map((k) => <option key={k} value={k}>{t(`dc.act.${k}` as MessageKey)}</option>)}</select></Field>
        <Field id="da-desc" label={t('dc.actionWhat')} error={errors.description}><input id="da-desc" value={a.description} onChange={(e) => setA((x) => ({ ...x, description: e.target.value }))} /></Field>
        {a.actionType === 'SUSPENSION' && <div className="grid-2">
          <Field id="da-from" label={t('dc.from')} error={errors.fromDate}><input id="da-from" type="date" value={a.fromDate} onChange={(e) => setA((x) => ({ ...x, fromDate: e.target.value }))} /></Field>
          <Field id="da-to" label={t('dc.to')} error={errors.toDate}><input id="da-to" type="date" value={a.toDate} onChange={(e) => setA((x) => ({ ...x, toDate: e.target.value }))} /></Field>
        </div>}
        {a.actionType === 'FINE' && <><Field id="da-fine" label={t('dc.fineAmount')} error={errors.fineAmount}><input id="da-fine" inputMode="decimal" value={a.fineAmount} onChange={(e) => setA((x) => ({ ...x, fineAmount: e.target.value }))} /></Field><p className="muted small">{t('dc.fineNote')}</p></>}
      </Modal>
      <Modal open={closing} onClose={() => setClosing(false)} title={t('dc.closeTitle')} onSubmit={(e: FormEvent) => { e.preventDefault(); void call('close', { closingNote: note || null }, t('dc.closed'), () => setClosing(false)); }} submitLabel={t('dc.close')} busy={busy} error={error}>
        <Field id="dc-note" label={t('dc.closingNote')} hint={t('dc.closingHint')}><input id="dc-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
