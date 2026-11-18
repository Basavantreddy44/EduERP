'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { Field, Modal } from '@/components/Modal';
import { EmptyState, SkeletonRows, useToast } from '@/components/ui';
import { CertView, CertificateSheet } from '@/components/certificate';

/** One certificate: print, or cancel with a reason (M10.3). */
export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const [c, setC] = useState<CertView | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<CertView>(`/certificates/${id}`).then(setC).catch(() => setMissing(true)); }, [id]);
  useEffect(load, [load]);
  const cancel = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { await api(`/certificates/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); toast(t('ct.cancelled')); setOpen(false); load(); }
    catch (x) { setError(apiErrors(x).message ?? Object.values(apiErrors(x).fields)[0] ?? null); } finally { setBusy(false); }
  };
  if (missing) return <EmptyState icon="file" title={t('ct.notFound')} action={<Link href="/certificates" className="btn">{t('ct.title')}</Link>} />;
  if (!c) return <SkeletonRows rows={8} />;
  return (
    <>
      <div className="row-actions no-print rc-bar">
        <Link href="/certificates" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('ct.title')}</Link>
        <span className="spacer" />
        {c.status === 'ISSUED' && can(PERMISSIONS.CERT_ISSUE) && <button type="button" className="btn" onClick={() => { setReason(''); setError(null); setOpen(true); }}>{t('ct.cancel')}</button>}
        {c.status === 'ISSUED' && <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="download" /> {t('ex.card.print')}</button>}
      </div>
      <CertificateSheet c={c} />
      <Modal open={open} onClose={() => setOpen(false)} title={t('ct.cancelTitle')} subtitle={`${c.certificateNo} · ${c.student}`} onSubmit={cancel} submitLabel={t('ct.cancel')} busy={busy} error={error} danger>
        <p className="muted small">{t('ct.cancelHint')}</p>
        <Field id="cc-reason" label={t('ex.sheet.reason')}><textarea id="cc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
