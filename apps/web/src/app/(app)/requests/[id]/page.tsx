'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { PRIORITY_TONE, Pill, REQUEST_TONE, priorityKey, useDue, useWhen } from '@/components/engagement2';

interface View {
  id: string; requestNo: string; title: string; description: string; category: string; priority: string; status: string;
  fromDepartment: string; toDepartment: string; requestedBy: string; neededBy: string | null; dueAt: string; createdAt: string; completedAt: string | null;
  assignedEmployeeId: string | null; assignedTo: string | null;
  updates: { id: string; by: string; message: string | null; oldStatus: string | null; newStatus: string | null; at: string }[];
  team: { id: string; name: string }[];
  can: { work: boolean; close: boolean };
}

/** One department request: details, history, work by the handling department, closing by the requester. */
export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const due = useDue();
  const [v, setV] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ message: '', status: '', assignToEmployeeId: '' });
  const [reply, setReply] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<View>(`/dept-requests/${id}`).then((x) => { setV(x); setForm({ message: '', status: '', assignToEmployeeId: x.assignedEmployeeId ?? '' }); }).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const work = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({});
    try {
      await api(`/dept-requests/${id}/updates`, { method: 'POST', body: JSON.stringify({ message: form.message, status: form.status || null, assignToEmployeeId: form.assignToEmployeeId && form.assignToEmployeeId !== v?.assignedEmployeeId ? form.assignToEmployeeId : null }) });
      toast(form.status === 'COMPLETED' ? t('rq.completedToast') : t('rq.updatedToast')); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); toast(a.message ?? t('en.failed')); } finally { setBusy(false); }
  };
  const close = async (accept: boolean) => {
    setBusy(true);
    try { await api(`/dept-requests/${id}/close`, { method: 'POST', body: JSON.stringify({ accept, message: reply || null }) }); toast(accept ? t('rq.closedToast') : t('rq.backToast')); setReply(''); load(); }
    catch (x) { toast(apiErrors(x).message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="layers" title={t('rq.notFound')} action={<Link href="/requests" className="btn">{t('rq.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const d = due(v.dueAt, !['OPEN', 'IN_PROGRESS'].includes(v.status));
  return (
    <>
      <Link href="/requests" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('rq.title')}</Link>
      <PageHeader eyebrow={`${v.requestNo} · ${v.category}`} title={v.title} actions={<Pill tone={REQUEST_TONE[v.status]}>{t(`rq.status.${v.status}` as MessageKey)}</Pill>} />
      <dl className="kv">
        <div><dt>{t('rq.fromTo')}</dt><dd>{v.fromDepartment} → {v.toDepartment}</dd></div>
        <div><dt>{t('rq.raisedBy')}</dt><dd>{v.requestedBy} <span className="muted small">{w.dt(v.createdAt)}</span></dd></div>
        <div><dt>{t('cp.priority')}</dt><dd><Pill tone={PRIORITY_TONE[v.priority]}>{t(priorityKey(v.priority))}</Pill></dd></div>
        <div><dt>{t('rq.assigned')}</dt><dd>{v.assignedTo ?? <span className="muted">—</span>}</dd></div>
        <div><dt>{t('rq.due')}</dt><dd>{d ? <span className={d.late ? 'text-bad' : undefined}>{d.text}</span> : v.completedAt ? t('rq.doneOn', { d: w.dt(v.completedAt) }) : '—'}{v.neededBy && <span className="sub-line muted small">{t('rq.neededBy', { d: w.date(v.neededBy) })}</span>}</dd></div>
        <div className="kv-wide"><dt>{t('rq.details')}</dt><dd className="p12-msg">{v.description}</dd></div>
      </dl>
      {v.status === 'PENDING_APPROVAL' && <p className="notice"><Icon name="clock" /> {t('rq.waitingApproval')}</p>}
      <section aria-labelledby="rq-h" className="card p12-block">
        <h2 id="rq-h" className="section-title">{t('rq.history')}</h2>
        <ol className="timeline p12-thread">
          {v.updates.map((u) => (
            <li key={u.id}>
              <span className="timeline-dot" />
              <div>
                <strong>{u.by || t('rq.system')}</strong> <span className="muted small">· {w.dt(u.at)}</span>
                {u.newStatus && <> <Pill tone={REQUEST_TONE[u.newStatus] ?? 'pill-info'}>{t(`rq.status.${u.newStatus}` as MessageKey)}</Pill></>}
                {u.message && <p className="p12-msg">{u.message}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {v.can.work && (
        <form className="card p12-block p12-reply" onSubmit={work}>
          <h2 className="section-title">{t('rq.work')}</h2>
          <label className="sr-only" htmlFor="rq-msg">{t('cp.message')}</label>
          <textarea id="rq-msg" className="input" rows={3} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder={t('rq.workPh')} aria-invalid={!!errors.message} />
          <div className="p12-reply-row">
            <label className="p12-inline">{t('rq.assigned')}
              <select value={form.assignToEmployeeId} onChange={(e) => setForm((f) => ({ ...f, assignToEmployeeId: e.target.value }))}>
                {!v.assignedEmployeeId && <option value="">—</option>}
                {v.team.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="p12-inline">{t('cp.setStatus')}
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="">{t('cp.keepStatus')}</option>
                {v.status !== 'IN_PROGRESS' && <option value="IN_PROGRESS">{t('rq.status.IN_PROGRESS')}</option>}
                <option value="COMPLETED">{t('rq.status.COMPLETED')}</option>
              </select>
            </label>
          </div>
          {errors.assignToEmployeeId && <span className="field-error">{errors.assignToEmployeeId}</span>}
          <button type="submit" className="btn btn-primary" disabled={busy || form.message.trim().length < 2}>{t('rq.postUpdate')}</button>
        </form>
      )}
      {v.can.close && (
        <div className="card p12-block p12-close">
          <h2 className="section-title">{t('rq.closeAsk')}</h2>
          <label className="sr-only" htmlFor="rq-reply">{t('rq.closeNote')}</label>
          <textarea id="rq-reply" className="input" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('rq.closeNote')} />
          <div className="row-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void close(true)}><Icon name="check" /> {t('rq.closeYes')}</button>
            <button type="button" className="btn" disabled={busy || reply.trim().length < 2} onClick={() => void close(false)}>{t('rq.closeNo')}</button>
          </div>
        </div>
      )}
    </>
  );
}
