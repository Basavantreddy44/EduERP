'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { EmptyState, PageHeader, SkeletonRows, StatTile } from '@/components/ui';
import { lakh, usePlcOptions } from '@/components/placements';

interface Stats { optedIn: number; placed: number; placedPercent: number; offers: number; drives: number; applications: number; highestCtc: string | null; averageCtc: string | null; medianCtc: string | null; byProgram: { program: string; opted: number; placed: number }[]; byCompany: { company: string; offers: number; accepted: number; highestCtc: string }[] }

/** Placements → Statistics (M19.3): placed %, CTC figures, by programme and by company for a batch. */
export default function PlacementStatsPage() {
  const { t } = useI18n();
  const opts = usePlcOptions();
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [campusId, setCampusId] = useState('');
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { setS(null); api<Stats>(`/placements/stats?passingYear=${year}${campusId ? `&campusId=${campusId}` : ''}`).then(setS).catch(() => setS(null)); }, [year, campusId]);
  return (
    <>
      <PageHeader eyebrow={t('nav.placements')} title={t('plc.s.title')} description={t('plc.s.desc')} />
      <div className="filter-bar card">
        <label className="inv-f">{t('plc.batch')}<select value={year} onChange={(e) => setYear(e.target.value)}>{opts?.years.map((y) => <option key={y} value={y}>{t('plc.batchOf', { y })}</option>)}</select></label>
        {opts && opts.campuses.length > 1 && <label className="inv-f">{t('act.campus')}<select value={campusId} onChange={(e) => setCampusId(e.target.value)}><option value="">{t('inv.allCampuses')}</option>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      {!s ? <SkeletonRows rows={5} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="users" label={t('plc.st.opted')} value={s.optedIn} />
            <StatTile icon="check" label={t('plc.st.placed')} value={`${s.placed} (${s.placedPercent}%)`} />
            <StatTile icon="star" label={t('plc.st.highest')} value={lakh(s.highestCtc)} />
            <StatTile icon="rupee" label={t('plc.s.average')} value={lakh(s.averageCtc)} hint={s.medianCtc ? t('plc.st.median', { v: lakh(s.medianCtc) }) : undefined} />
          </div>
          <p className="muted small">{t('plc.s.note', { d: s.drives, a: s.applications, o: s.offers })}</p>
          {!s.byProgram.length && !s.byCompany.length ? <EmptyState icon="users" title={t('plc.s.none')} /> : (
            <div className="lib-desk">
              <section className="card p12-block" aria-labelledby="ps-prog">
                <h2 id="ps-prog" className="section-title">{t('plc.s.byProgramme')}</h2>
                <div className="table-wrap" role="region" aria-label={t('plc.s.byProgramme')} tabIndex={0}>
                  <table className="table">
                    <thead><tr><th scope="col">{t('plc.programme')}</th><th scope="col" className="num">{t('plc.st.opted')}</th><th scope="col" className="num">{t('plc.st.placed')}</th><th scope="col" className="num">%</th></tr></thead>
                    <tbody>{s.byProgram.map((p) => <tr key={p.program}><td>{p.program}</td><td className="num">{p.opted}</td><td className="num"><strong>{p.placed}</strong></td><td className="num">{p.opted ? Math.round((p.placed * 1000) / p.opted) / 10 : 0}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section className="card p12-block" aria-labelledby="ps-co">
                <h2 id="ps-co" className="section-title">{t('plc.s.byCompany')}</h2>
                <div className="table-wrap" role="region" aria-label={t('plc.s.byCompany')} tabIndex={0}>
                  <table className="table">
                    <thead><tr><th scope="col">{t('plc.company')}</th><th scope="col" className="num">{t('plc.st.offers')}</th><th scope="col" className="num">{t('plc.s.accepted')}</th><th scope="col" className="num">{t('plc.st.highest')}</th></tr></thead>
                    <tbody>{s.byCompany.map((c) => <tr key={c.company}><td>{c.company}</td><td className="num">{c.offers}</td><td className="num">{c.accepted}</td><td className="num">{lakh(c.highestCtc)}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
