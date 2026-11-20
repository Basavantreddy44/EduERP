'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { APPROVAL_ENTITY_LABELS, ApprovalEntityType } from '@eduerp/shared';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Pending {
  id: string;
  entityType: ApprovalEntityType;
  amount: number | null;
  summary: string | null;
  requesterName: string;
  currentLevel: number;
  totalLevels: number;
  createdAt: string;
}

const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);

export default function ApprovalsPage() {
  const [items, setItems] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [remarks, setRemarks] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const { t, locale } = useI18n();
  const label = (e: string) => (e in APPROVAL_ENTITY_LABELS ? t(`entity.${e as ApprovalEntityType}` satisfies MessageKey) : e);

  const load = useCallback(() => {
    api<Pending[]>('/approvals/inbox').then(setItems).catch((e) => setError(e instanceof ApiError ? e.message : t('appr.loadFailed')));
  }, []);
  useEffect(load, [load]);

  async function decide(p: Pending, action: 'APPROVE' | 'REJECT', why?: string) {
    setBusy(p.id);
    setError(null);
    try {
      await api(`/approvals/requests/${p.id}/act`, { method: 'POST', body: JSON.stringify({ action, remarks: why || undefined }) });
      dialog.current?.close();
      setRejecting(null);
      toast(action === 'APPROVE' ? t('appr.approved') : t('appr.rejected'));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('appr.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  function askReject(p: Pending) {
    setRejecting(p);
    setRemarks('');
    dialog.current?.showModal();
  }

  function submitReject(e: FormEvent) {
    e.preventDefault();
    if (rejecting && remarks.trim().length >= 3) decide(rejecting, 'REJECT', remarks.trim());
  }

  return (
    <>
      <PageHeader eyebrow={t('nav.overview')} title={t('nav.approvals')} description={t('appr.desc')} />
      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}

      {items === null ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyState icon="approvals" title={t('appr.emptyTitle')} text={t('appr.emptyText')} />
      ) : (
        <div className="approval-list">
          {items.map((p) => (
            <article key={p.id} className="card approval-card">
              <div className="approval-main">
                <div className="approval-top">
                  <span className="badge">{label(p.entityType)}</span>
                  <span className="muted">{t('appr.level', { a: p.currentLevel, b: p.totalLevels })}</span>
                </div>
                <h2>{p.summary || label(p.entityType)}</h2>
                <p className="muted">
                  {t('appr.from', { name: p.requesterName })} · {new Date(p.createdAt).toLocaleString(locale)}
                  {p.amount !== null && <> · <strong className="amount">{inr(p.amount)}</strong></>}
                </p>
              </div>
              <div className="approval-actions">
                <button className="btn" disabled={busy === p.id} onClick={() => askReject(p)}>{t('appr.reject')}</button>
                <button className="btn btn-primary" disabled={busy === p.id} onClick={() => decide(p, 'APPROVE')}>
                  {busy === p.id ? t('common.saving') : t('appr.approve')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <dialog ref={dialog} aria-labelledby="reject-title" onClose={() => setRejecting(null)}>
        <form className="card" onSubmit={submitReject}>
          <h2 id="reject-title" className="dialog-title">{t('appr.rejectTitle')}</h2>
          <p className="dialog-sub">{t('appr.rejectSub')}</p>
          <div className="field">
            <label htmlFor="remarks">{t('appr.reason')}</label>
            <textarea id="remarks" rows={3} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} autoFocus />
            {remarks.length > 0 && remarks.trim().length < 3 && <span className="err">{t('appr.reasonShort')}</span>}
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={remarks.trim().length < 3 || !!busy}>{t('appr.reject')}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
