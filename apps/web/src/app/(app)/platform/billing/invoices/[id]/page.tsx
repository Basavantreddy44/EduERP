'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { SaasInvoiceDetail, SaasInvoiceDoc } from '@/components/billing';

/** A bill to an institution, printable, in the platform console. */
export default function PlatformInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<SaasInvoiceDetail | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<SaasInvoiceDetail>(`/platform/billing/invoices/${id}`).then(setInv).catch(() => setMissing(true)); }, [id]);
  if (missing) return <EmptyState icon="receipt" title="Bill not found" />;
  if (!inv) return <SkeletonRows rows={6} />;
  return (
    <div className="receipt-page saas-page">
      <div className="receipt-tools no-print">
        <Link href={`/platform/billing/${inv.tenantId}`} className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {inv.tenantName}</Link>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="receipt" size={16} /> Print</button>
      </div>
      <SaasInvoiceDoc inv={inv} />
    </div>
  );
}
