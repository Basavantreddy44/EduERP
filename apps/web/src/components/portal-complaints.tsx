'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { REQUEST_PRIORITIES } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors, FieldErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { COMPLAINT_TONE, ComplaintCloseBox, ComplaintThread, ComplaintView, Pill, priorityKey, useWhen } from '@/components/engagement2';

interface Mine { id: string; complaintNo: string; subject: string; category: string; status: string; studentId: string | null; createdAt: string; dueAt: string }

/** Parent app → child → Complaints: raise one about this child, follow the school’s replies, confirm or reopen. */
export function ChildComplaints({ id }: { id: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const w = useWhen();
  const [rows, setRows] = useState<Mine[] | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string; slaHours: number }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<ComplaintView | null>(null);
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState({ categoryId: '', subject: '', description: '', priority: 'MEDIUM' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Mine[]>('/portal/complaints').then((r) => setRows(r.filter((c) => c.studentId === id))).catch(() => setRows([])); }, [id]);
  useEffect(load, [load]);
  useEffect(() => { api<typeof cats>('/portal/complaints/categories').then(setCats).catch(() => setCats([])); }, []);
  const show = useCallback((cid: string) => { setOpenId(cid); setView(null); api<ComplaintView>(`/portal/complaints/${cid}`).then(setView).catch(() => setOpenId(null)); }, []);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErrors({}); setError(null);
    try { const r = await api<{ id: string; complaintNo: string }>('/portal/complaints', { method: 'POST', body: JSON.stringify({ ...form, studentId: id }) }); toast(t('pt.cp.sent', { no: r.complaintNo })); setRaising(false); load(); show(r.id); }
    catch (x) { const a = apiErrors(x); setErrors(a.fields); setError(a.message); } finally { setBusy(false); }
  };
  const cat = cats.find((c) => c.id === form.categoryId);
  if (!rows) return <SkeletonRows rows={3} />;
  return (
    <>
      <div className="panel-head">
        <p className="muted">{t('pt.cp.hint')}</p>
        <button type="button" className="btn btn-primary" disabled={!cats.length} onClick={() => { setForm({ categoryId: cats[0]?.id ?? '', subject: '', description: '', priority: 'MEDIUM' }); setErrors({}); setError(null); setRaising(true); }}><Icon name="plus" /> {t('pt.cp.new')}</button>
      </div>
      {!rows.length ? <EmptyState icon="shield" title={t('pt.cp.none')} text={cats.length ? t('pt.cp.noneHint') : t('pt.cp.notSetUp')} /> : (
        <ul className="p12-portal-list">
          {rows.map((c) => (
            <li key={c.id} className="card">
              <button type="button" className="p12-portal-row" aria-expanded={openId === c.id} onClick={() => (openId === c.id ? setOpenId(null) : show(c.id))}>
                <span><strong>{c.subject}</strong><span className="sub-line muted small">{c.complaintNo} · {c.category} · {w.dt(c.createdAt)}</span></span>
                <Pill tone={COMPLAINT_TONE[c.status]}>{t(`cp.status.${c.status}` as MessageKey)}</Pill>
              </button>
              {openId === c.id && (!view ? <SkeletonRows rows={2} /> : (
                <div className="p12-portal-body">
                  <ComplaintThread v={view} />
                  {view.complaint.status !== 'CLOSED' && view.complaint.status !== 'RESOLVED' && <p className="muted small"><Icon name="clock" size={14} /> {t('pt.cp.replyBy', { when: w.dt(view.complaint.dueAt) })}</p>}
                  {view.canClose && (
                    <ComplaintCloseBox onSend={async (body) => {
                      try { await api(`/portal/complaints/${c.id}/close`, { method: 'POST', body: JSON.stringify(body) }); toast(body.close ? t('cp.closedToast') : t('cp.reopenedToast')); load(); show(c.id); return null; }
                      catch (x) { return apiErrors(x).message ?? t('en.failed'); }
                    }} />
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      <Modal open={raising} onClose={() => setRaising(false)} title={t('pt.cp.new')} subtitle={t('pt.cp.newSub')} onSubmit={save} submitLabel={t('cp.send')} busy={busy} error={error}>
        <div className="grid-2">
          <Field id="pc-cat" label={t('cp.category')} error={errors.categoryId}><select id="pc-cat" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="pc-pr" label={t('cp.priority')}><select id="pc-pr" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>{REQUEST_PRIORITIES.map((p) => <option key={p} value={p}>{t(priorityKey(p))}</option>)}</select></Field>
        </div>
        <Field id="pc-sub" label={t('cp.subject')} error={errors.subject}><input id="pc-sub" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder={t('cp.subjectPh')} /></Field>
        <Field id="pc-desc" label={t('cp.details')} error={errors.description}><textarea id="pc-desc" rows={5} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t('cp.detailsPh')} /></Field>
        {cat && <p className="muted small">{t('pt.cp.sla', { h: cat.slaHours })}</p>}
      </Modal>
    </>
  );
}
