'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { SaasInvoiceDetail, SaasInvoiceDoc } from '@/components/billing';

/** One EduERP bill of this institution, printable. */
export default function MyInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [inv, setInv] = useState<SaasInvoiceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<SaasInvoiceDetail>(`/billing/invoices/${id}`).then(setInv).catch(() => setMissing(true)); }, [id]);
  if (missing) return <EmptyState icon="receipt" title={t('bill.notFound')} />;
  if (!inv) return <SkeletonRows rows={6} />;
  return (
    <div className="receipt-page saas-page">
      <div className="receipt-tools no-print">
        <Link href="/settings/billing" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('bill.title')}</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="receipt" size={16} /> {t('bill.print')}</button>
      </div>
      <SaasInvoiceDoc inv={inv} />
    </div>
  );
}
