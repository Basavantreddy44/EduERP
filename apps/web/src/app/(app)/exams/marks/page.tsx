'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';

interface MySheet { paperId: string; exam: string; examId: string; subject: string; sectionId: string; section: string; examDate: string; maxMarks: number; status: string; mine: boolean }

/** Exams → Mark entry (M9.2): the sheets this person enters or verifies, the ones needing action first. */
export default function MarksPage() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<MySheet[] | null>(null);
  useEffect(() => { api<MySheet[]>('/exams/my-sheets').then(setRows).catch(() => setRows([])); }, []);
  const d = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const groups: [string, MySheet[]][] = rows ? [
    ['todo', rows.filter((r) => r.status === 'PENDING' && r.mine)],
    ['verify', rows.filter((r) => r.status === 'SUBMITTED' && !r.mine)],
    ['waiting', rows.filter((r) => r.status === 'SUBMITTED' && r.mine)],
    ['other', rows.filter((r) => r.status === 'PENDING' && !r.mine)],
    ['done', rows.filter((r) => r.status === 'VERIFIED')],
  ] : [];
  return (
    <>
      <PageHeader eyebrow={t('nav.exams')} title={t('ex.marks.title')} description={t('ex.marks.desc')} />
      {!rows ? <SkeletonRows rows={5} /> : !rows.length ? <EmptyState icon="edit" title={t('ex.marks.none')} text={t('ex.marks.noneHint')} /> : groups.filter(([, g]) => g.length).map(([k, g]) => (
        <section key={k} aria-labelledby={`g-${k}`}>
          <h2 id={`g-${k}`} className="section-title">{t(`ex.marks.group.${k}` as MessageKey)} · {g.length}</h2>
          <ul className="sheet-list">
            {g.map((s) => (
              <li key={`${s.paperId}-${s.sectionId}`}>
                <Link href={`/exams/marks/${s.paperId}/${s.sectionId}`} className="card sheet-row">
                  <span><strong>{s.subject}</strong> · {s.section}<span className="sub-line muted">{s.exam} · {d(s.examDate)} · {t('ex.outOf', { n: s.maxMarks })}</span></span>
                  <span className={`sheet-chip ${s.status.toLowerCase()}`}>{t(`ex.sheet.${s.status}` as MessageKey)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
