'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { Card, ReportCard } from '@/components/exams';

/** A printable report card (M9.3). */
export default function ReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [c, setC] = useState<Card | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { api<Card>(`/exams/results/${id}/card`).then(setC).catch(() => setMissing(true)); }, [id]);
  if (missing) return <EmptyState icon="file" title={t('ex.card.notFound')} action={<Link href="/exams/results" className="btn">{t('nav.results')}</Link>} />;
  if (!c) return <SkeletonRows rows={8} />;
  return (
    <>
      <div className="row-actions no-print rc-bar">
        <Link href="/exams/results" className="back-link"><Icon name="chevronRight" size={16} className="flip" /> {t('nav.results')}</Link>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="download" /> {t('ex.card.print')}</button>
      </div>
      <ReportCard c={c} />
    </>
  );
}
