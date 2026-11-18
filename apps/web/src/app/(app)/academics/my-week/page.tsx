'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { todayIST } from '@/components/admissions';
import { Lesson, LessonChip, Period, Sub, WeekGrid, hm, shownDays, weekdayOf } from '@/components/academics';

interface Mine { teacher: { id: string; name: string }; periods: Period[]; entries: Lesson[]; substitutions: Sub[] }

/** Academics → My timetable (M8.2): the signed-in teacher's week and lessons they cover. */
export default function MyWeekPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Mine | null>(null);
  const [noStaff, setNoStaff] = useState(false);
  useEffect(() => {
    api<Mine>('/academics/me/timetable').then(setData).catch((e) => { if (e instanceof ApiError && e.status === 404) setNoStaff(true); setData(null); });
  }, []);
  const today = weekdayOf(todayIST());
  const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  if (noStaff) return (<><PageHeader eyebrow={t('nav.academics')} title={t('ac.my.title')} /><EmptyState icon="users" title={t('ac.my.noStaff')} text={t('ac.my.noStaffHint')} /></>);
  if (!data) return (<><PageHeader eyebrow={t('nav.academics')} title={t('ac.my.title')} /><SkeletonRows rows={6} /></>);
  const todays = data.entries.filter((e) => e.dayOfWeek === today).sort((a, b) => data.periods.findIndex((p) => p.id === a.periodId) - data.periods.findIndex((p) => p.id === b.periodId));
  const covering = data.substitutions.filter((s) => s.date === todayIST());

  return (
    <>
      <PageHeader eyebrow={t('nav.academics')} title={t('ac.my.title')} description={t('ac.my.desc', { name: data.teacher.name, n: data.entries.length })}
        actions={<Link href="/academics/homework" className="btn"><Icon name="book" /> {t('nav.homework')}</Link>} />
      <h2 className="section-title first">{t('ac.my.today')}</h2>
      {!todays.length && !covering.length ? <p className="muted">{t('ac.my.nothingToday')}</p> : (
        <ul className="ac-today">
          {todays.map((l) => {
            const p = data.periods.find((x) => x.id === l.periodId);
            return <li key={l.id} className="card"><span className="ac-today-time"><strong>{p?.name}</strong><span className="muted small">{hm(p?.startTime)}–{hm(p?.endTime)}</span></span><span><strong>{l.subject}</strong><span className="sub-line">{l.section}{l.room ? ` · ${l.room}` : ''}</span></span></li>;
          })}
          {covering.map((s) => (
            <li key={s.id} className="card ac-today-sub"><span className="ac-today-time"><strong>{s.period}</strong><span className="muted small">{hm(s.startTime)}</span></span><span><strong>{s.subject}</strong><span className="sub-line">{s.section} · {t('ac.my.coverFor', { name: s.absent })}</span></span><span className="pill pill-info">{t('ac.my.cover')}</span></li>
          ))}
        </ul>
      )}
      <h2 className="section-title">{t('ac.my.week')}</h2>
      {!data.entries.length ? <EmptyState icon="grid" title={t('ac.my.none')} text={t('ac.my.noneHint')} /> : (
        <WeekGrid periods={data.periods} days={shownDays(data.entries)} label={t('ac.my.week')}
          cell={(d, p) => { const l = data.entries.find((x) => x.dayOfWeek === d && x.periodId === p.id); return l ? <LessonChip l={l} show="section" /> : <span className="tt-free">{t('ac.free')}</span>; }} />
      )}
      {data.substitutions.length > 0 && (
        <>
          <h2 className="section-title">{t('ac.my.coming')}</h2>
          <div className="table-wrap card">
            <table className="table">
              <thead><tr><th scope="col">{t('ac.sub.date')}</th><th scope="col">{t('ac.period')}</th><th scope="col">{t('ac.section')}</th><th scope="col">{t('ac.subject')}</th><th scope="col">{t('ac.sub.absent')}</th></tr></thead>
              <tbody>{data.substitutions.map((s) => <tr key={s.id}><td>{date(s.date)}</td><td>{s.period} <span className="muted small">{hm(s.startTime)}</span></td><td>{s.section}</td><td>{s.subject}</td><td>{s.absent}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
