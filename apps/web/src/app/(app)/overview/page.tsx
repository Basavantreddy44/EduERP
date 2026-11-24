'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatTile } from '@/components/ui';
import { useDay } from '@/components/admissions';

type Pct = { present: number; marked: number; percent: number } | null;
interface Row {
  campusId: string; code: string; name: string; district: string | null; udiseCode: string | null;
  students: number; boys: number; girls: number; staff: number;
  attendanceToday: Pct; hostelToday: Pct; fedYesterday: number | null;
  diet: { flagged: number; items: number } | null;
  welfare: { due: number; given: number; percent: number | null } | null;
  readiness: { SATS: number | null; UDISE: number | null };
  results: { passed: number; total: number; percent: number } | null;
}
interface District { district: string | null; schools: number; students: number; boys: number; girls: number; staff: number; attendancePercent: number | null; hostelPercent: number | null; fedYesterday: number; dietFlagged: number; welfarePercent: number | null; resultsPercent: number | null }
interface Overview { date: string; mealsDate: string; monthStart: string; rows: Row[]; districts: District[]; allDistricts: string[]; modules: { attendance: boolean; hostel: boolean; exams: boolean; diet: boolean } }

const n = (v: number) => v.toLocaleString('en-IN');
/** A percentage cell: green from 90, amber from 75, red below; dash when nothing is recorded. */
function P({ v, low = 75, high = 90, hint }: { v: number | null | undefined; low?: number; high?: number; hint?: string }) {
  if (v == null) return <span className="muted">—</span>;
  const tone = v >= high ? 'ok' : v >= low ? 'warn' : 'bad';
  return <span className={`ov-pct ${tone}`}>{v}%{hint && <span className="sub-line muted small">{hint}</span>}</span>;
}

/** Overview → Schools (G5): every school (campus) compared, grouped by district with totals. */
export default function OverviewPage() {
  const { t } = useI18n();
  const day = useDay();
  const [district, setDistrict] = useState('');
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => { setO(null); api<Overview>(`/govt/overview${district ? `?district=${encodeURIComponent(district)}` : ''}`).then(setO).catch(() => setO(null)); }, [district]);
  if (!o) return <><PageHeader eyebrow={t('nav.overview')} title={t('ov.title')} description={t('ov.desc')} /><SkeletonRows rows={6} /></>;
  const tot = o.districts.reduce((s, d) => ({ schools: s.schools + d.schools, students: s.students + d.students, girls: s.girls + d.girls, staff: s.staff + d.staff, fed: s.fed + d.fedYesterday, flagged: s.flagged + d.dietFlagged }), { schools: 0, students: 0, girls: 0, staff: 0, fed: 0, flagged: 0 });
  const grouped = o.districts.map((d) => ({ d, rows: o.rows.filter((r) => (r.district ?? null) === d.district) }));
  const m = o.modules;
  return (
    <>
      <PageHeader eyebrow={t('nav.overview')} title={t('ov.title')} description={t('ov.desc')} />
      <div className="filter-bar card">
        {o.allDistricts.length > 1 && <label className="inv-f">{t('ov.district')}<select value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">{t('ov.allDistricts')}</option>{o.allDistricts.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
        <span className="muted small ov-asof">{t('ov.asOf', { d: day(o.date), m: day(o.mealsDate) })}</span>
      </div>
      {!o.rows.length ? <EmptyState icon="building" title={t('ov.none')} /> : (
        <>
          <div className="stats pay-stats">
            <StatTile icon="building" label={t('ov.schools')} value={n(tot.schools)} hint={o.districts.length > 1 ? t('ov.inDistricts', { n: o.districts.length }) : undefined} />
            <StatTile icon="cap" label={t('ov.students')} value={n(tot.students)} hint={t('ov.girlsOf', { n: n(tot.girls) })} />
            <StatTile icon="users" label={t('ov.staff')} value={n(tot.staff)} />
            {m.hostel && <StatTile icon="clipboard" label={t('ov.fed')} value={n(tot.fed)} hint={day(o.mealsDate)} />}
            {m.diet && <StatTile icon="alert" label={t('ov.dietFlags')} value={n(tot.flagged)} hint={t('ov.thisMonth')} />}
          </div>

          {o.districts.length > 1 && (
            <section className="card gov-block" aria-labelledby="ov-dist">
              <h2 id="ov-dist" className="section-title">{t('ov.byDistrict')}</h2>
              <div className="table-wrap" role="region" aria-label={t('ov.byDistrict')} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">{t('ov.district')}</th><th scope="col" className="num">{t('ov.schools')}</th><th scope="col" className="num">{t('ov.students')}</th>{m.attendance && <th scope="col" className="num">{t('ov.attendance')}</th>}{m.hostel && <th scope="col" className="num">{t('ov.hostel')}</th>}<th scope="col" className="num">{t('ov.welfare')}</th>{m.exams && <th scope="col" className="num">{t('ov.results')}</th>}</tr></thead>
                  <tbody>{o.districts.map((d) => (
                    <tr key={d.district ?? '-'}>
                      <th scope="row">{d.district ?? t('ov.noDistrict')}</th>
                      <td className="num">{d.schools}</td><td className="num">{n(d.students)}</td>
                      {m.attendance && <td className="num"><P v={d.attendancePercent} /></td>}
                      {m.hostel && <td className="num"><P v={d.hostelPercent} /></td>}
                      <td className="num"><P v={d.welfarePercent} low={50} high={90} /></td>
                      {m.exams && <td className="num"><P v={d.resultsPercent} low={60} high={85} /></td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}

          {grouped.map(({ d, rows }) => (
            <section key={d.district ?? '-'} className="card gov-block" aria-labelledby={`ov-${d.district ?? 'none'}`}>
              <div className="panel-head">
                <h2 id={`ov-${d.district ?? 'none'}`} className="section-title">{d.district ?? t('ov.noDistrict')} <span className="muted small">· {t('ov.nSchools', { n: d.schools })}</span></h2>
              </div>
              <div className="table-wrap" role="region" aria-label={d.district ?? t('ov.noDistrict')} tabIndex={0}>
                <table className="table ov-table">
                  <thead><tr>
                    <th scope="col">{t('ov.school')}</th><th scope="col" className="num">{t('ov.students')}</th><th scope="col" className="num">{t('ov.staff')}</th>
                    {m.attendance && <th scope="col" className="num">{t('ov.attendance')}</th>}
                    {m.hostel && <th scope="col" className="num">{t('ov.hostel')}</th>}
                    {m.hostel && <th scope="col" className="num">{t('ov.fedShort')}</th>}
                    {m.diet && <th scope="col">{t('ov.diet')}</th>}
                    <th scope="col" className="num">{t('ov.welfare')}</th>
                    <th scope="col">{t('ov.govData')}</th>
                    {m.exams && <th scope="col" className="num">{t('ov.results')}</th>}
                  </tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.campusId}>
                      <th scope="row"><strong>{r.name}</strong><span className="sub-line muted small">{r.code}{r.udiseCode ? ` · UDISE ${r.udiseCode}` : ''}</span></th>
                      <td className="num">{n(r.students)}<span className="sub-line muted small">{t('ov.bg', { b: r.boys, g: r.girls })}</span></td>
                      <td className="num">{r.staff}</td>
                      {m.attendance && <td className="num"><P v={r.attendanceToday?.percent} hint={r.attendanceToday ? `${r.attendanceToday.present}/${r.attendanceToday.marked}` : t('ov.notTaken')} /></td>}
                      {m.hostel && <td className="num"><P v={r.hostelToday?.percent} hint={r.hostelToday ? `${r.hostelToday.present}/${r.hostelToday.marked}` : t('ov.notTaken')} /></td>}
                      {m.hostel && <td className="num">{r.fedYesterday == null ? <span className="muted small">{t('ov.notRecorded')}</span> : n(r.fedYesterday)}</td>}
                      {m.diet && <td>{!r.diet ? <span className="muted small">{t('ov.notRecorded')}</span> : r.diet.flagged ? <span className="badge warn"><Icon name="alert" size={12} /> {t('ov.itemsOff', { n: r.diet.flagged })}</span> : <span className="badge ok">{t('ov.dietOk')}</span>}</td>}
                      <td className="num">{r.welfare ? <P v={r.welfare.percent} low={50} high={90} hint={`${r.welfare.given}/${r.welfare.due}`} /> : <span className="muted">—</span>}</td>
                      <td><span className="small">SATS <P v={r.readiness.SATS} /> · UDISE+ <P v={r.readiness.UDISE} /></span></td>
                      {m.exams && <td className="num"><P v={r.results?.percent} low={60} high={85} hint={r.results ? `${r.results.passed}/${r.results.total}` : undefined} /></td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="muted small ov-legend">{t('ov.legend')} <Link href="/students/govt">{t('ov.openGov')}</Link> · <Link href="/hostel/diet">{t('ov.openDiet')}</Link> · <Link href="/welfare">{t('ov.openWelfare')}</Link></p>
        </>
      )}
    </>
  );
}
