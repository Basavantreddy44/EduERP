'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { COMPLAINT_TONE, ComplaintCloseBox, ComplaintThread, ComplaintView, PRIORITY_TONE, Pill, priorityKey, useDue, useStaffOpts, useWhen } from '@/components/engagement2';

/** One complaint: details, the thread (with internal notes for staff), updates, reassignment, closing. */
export default function ComplaintPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const due = useDue();
  const manage = can(PERMISSIONS.GRIEVANCE_MANAGE);
  const staff = useStaffOpts(manage ? '/complaints/staff' : null);
  const [v, setV] = useState<ComplaintView | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ message: '', isInternal: false, status: '', assignToEmployeeId: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<ComplaintView>(`/complaints/${id}`).then((x) => { setV(x); setForm((f) => ({ ...f, assignToEmployeeId: x.complaint.assignedEmployeeId ?? '' })); }).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({});
    try {
      await api(`/complaints/${id}/updates`, { method: 'POST', body: JSON.stringify({ message: form.message, isInternal: form.isInternal, status: form.status || null, assignToEmployeeId: form.assignToEmployeeId && form.assignToEmployeeId !== v?.complaint.assignedEmployeeId ? form.assignToEmployeeId : null }) });
      toast(form.isInternal ? t('cp.noteSaved') : t('cp.replySent')); setForm({ message: '', isInternal: false, status: '', assignToEmployeeId: '' }); load();
    } catch (x) { const a = apiErrors(x); setErrors(a.fields); toast(a.message ?? t('en.failed')); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="shield" title={t('cp.notFound')} action={<Link href="/complaints" className="btn">{t('cp.title')}</Link>} />;
  if (!v) return <SkeletonRows rows={6} />;
  const c = v.complaint;
  const d = due(c.dueAt, c.status === 'RESOLVED' || c.status === 'CLOSED');
  return (
    <>
      <Link href="/complaints" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('cp.title')}</Link>
      <PageHeader eyebrow={`${c.complaintNo} · ${c.category}`} title={c.subject} actions={<Pill tone={COMPLAINT_TONE[c.status]}>{t(`cp.status.${c.status}` as MessageKey)}</Pill>} />
      <dl className="kv">
        <div><dt>{t('cp.from')}</dt><dd>{c.raisedBy} <span className="muted small">({t(`cp.by.${c.raisedByType}` as MessageKey)})</span></dd></div>
        {c.student && <div><dt>{t('cp.student')}</dt><dd>{c.student.name} <span className="muted small">{c.student.admissionNo}</span></dd></div>}
        <div><dt>{t('cp.priority')}</dt><dd><Pill tone={PRIORITY_TONE[c.priority]}>{t(priorityKey(c.priority))}</Pill></dd></div>
        <div><dt>{t('cp.handler')}</dt><dd>{c.handler ?? <span className="muted">{t('cp.unassigned')}</span>}</dd></div>
        <div><dt>{t('cp.due')}</dt><dd>{d ? <span className={d.late ? 'text-bad' : undefined}>{d.text}</span> : c.closedAt ? w.dt(c.closedAt) : c.resolvedAt ? w.dt(c.resolvedAt) : '—'}{c.escalated && <> <Pill tone="pill-bad">{t('cp.escalated')}</Pill></>}</dd></div>
        {c.rating && <div><dt>{t('cp.rating')}</dt><dd>{'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}</dd></div>}
      </dl>
      <section aria-labelledby="cp-th" className="card p12-block">
        <h2 id="cp-th" className="section-title">{t('cp.thread')}</h2>
        <ComplaintThread v={v} />
      </section>
      {v.canWork && c.status !== 'CLOSED' && (
        <form className="card p12-block p12-reply" onSubmit={send}>
          <h2 className="section-title">{t('cp.respond')}</h2>
          <label className="sr-only" htmlFor="cp-msg">{t('cp.message')}</label>
          <textarea id="cp-msg" className="input" rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder={form.isInternal ? t('cp.notePh') : t('cp.replyPh')} aria-invalid={!!errors.message} />
          {errors.message && <span className="field-error">{errors.message}</span>}
          <div className="p12-reply-row">
            <label className="check"><input type="checkbox" checked={form.isInternal} onChange={(e) => setForm((f) => ({ ...f, isInternal: e.target.checked }))} /> <Icon name="lock" size={14} /> {t('cp.internalOnly')}</label>
            <label className="p12-inline">{t('cp.setStatus')}
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="">{t('cp.keepStatus')}</option>
                {c.status !== 'IN_PROGRESS' && <option value="IN_PROGRESS">{t('cp.status.IN_PROGRESS')}</option>}
                {c.status !== 'RESOLVED' && <option value="RESOLVED">{t('cp.status.RESOLVED')}</option>}
              </select>
            </label>
            {manage && staff && (
              <label className="p12-inline">{t('cp.handler')}
                <select value={form.assignToEmployeeId} onChange={(e) => setForm((f) => ({ ...f, assignToEmployeeId: e.target.value }))}>
                  {!c.assignedEmployeeId && <option value="">{t('cp.unassigned')}</option>}
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {form.status === 'RESOLVED' && !form.isInternal && <p className="muted small">{t('cp.resolveHint')}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || form.message.trim().length < 2}>{form.isInternal ? t('cp.saveNote') : t('cp.sendReply')}</button>
        </form>
      )}
      {v.canClose && (
        <ComplaintCloseBox onSend={async (body) => {
          try { await api(`/complaints/${id}/close`, { method: 'POST', body: JSON.stringify(body) }); toast(body.close ? t('cp.closedToast') : t('cp.reopenedToast')); load(); return null; }
          catch (x) { return apiErrors(x).message ?? t('en.failed'); }
        }} />
      )}
    </>
  );
}
