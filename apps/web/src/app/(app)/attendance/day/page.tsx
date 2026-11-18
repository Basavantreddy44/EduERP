'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows } from '@/components/ui';
import { useDay } from '@/components/admissions';
import { useAttendanceOptions } from '@/components/attendance';

interface Row { sectionId: string; sectionName: string; className: string; programName: string; campusId: string; students: number; status: string | null; present: number; absent: number; late: number; leave: number; halfDay: number }
interface Day { date: string; sections: Row[]; closed: Record<string, string>; totals: { sections: number; submitted: number; draft: number; notTaken: number; students: number; present: number; absent: number; leave: number } }

/** Today's attendance at a glance (M3.2): which classes are done, and the absentee count. */
function DayOverview() {
  const { campusId } = useSession();
  const { t } = useI18n();
  const day = useDay();
  const params = useSearchParams();
  const opts = useAttendanceOptions();
  const [date, setDate] = useState(params.get('date') ?? '');
  const [periodId, setPeriod] = useState('');
  const [data, setData] = useState<Day | null>(null);
  useEffect(() => { if (opts && !date) setDate(opts.today); }, [opts, date]);
  const periodCampus = opts?.campuses.find((c) => c.mode === 'PERIOD' && (!campusId || c.id === campusId));
  useEffect(() => {
    if (!date) return;
    setData(null);
    const q = new URLSearchParams({ date, ...(campusId ? { campusId } : {}), ...(periodId ? { periodId } : {}) });
    api<Day>(`/attendance/day?${q.toString()}`).then(setData).catch(() => setData({ date, sections: [], closed: {}, totals: { sections: 0, submitted: 0, draft: 0, notTaken: 0, students: 0, present: 0, absent: 0, leave: 0 } }));
  }, [date, campusId, periodId]);

  if (!opts) return <SkeletonRows rows={6} />;
  const shift = (n: number) => { const d = new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10); if (d <= opts.today) setDate(d); };
  const rows = (data?.sections ?? []).filter((r) => r.students > 0);
  const closedAll = data && Object.keys(data.closed).length > 0 && rows.every((r) => data.closed[r.campusId]);
  const pct = data && data.totals.present + data.totals.absent > 0 ? Math.round((data.totals.present / (data.totals.present + data.totals.absent)) * 1000) / 10 : null;

  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('att.dayTitle')} description={t('att.dayDesc')}
        actions={<Link className="btn btn-primary" href="/attendance"><Icon name="check" /> {t('att.title')}</Link>} />

      <div className="card filter-bar">
        <div className="att-daynav">
          <button type="button" className="btn btn-ghost icon-btn" aria-label={t('att.prevDay')} onClick={() => shift(-1)}><Icon name="chevronRight" className="flip" /></button>
          <label className="filter"><span>{t('common.date')}</span><input type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></label>
          <button type="button" className="btn btn-ghost icon-btn" aria-label={t('att.nextDay')} disabled={date >= opts.today} onClick={() => shift(1)}><Icon name="chevronRight" /></button>
        </div>
        {periodCampus && (
          <label className="filter">
            <span>{t('att.period')} ({periodCampus.code})</span>
            <select value={periodId} onChange={(e) => setPeriod(e.target.value)}>
              <option value="">{t('att.dailySheets')}</option>
              {periodCampus.periods.filter((p) => !p.isBreak).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.startTime}</option>)}
            </select>
          </label>
        )}
      </div>

      {!data ? <SkeletonRows rows={5} /> : rows.length === 0 ? (
        <EmptyState icon="users" title={t('att.dayEmpty')} />
      ) : (
        <>
          {closedAll && <p className="note-info"><Icon name="calendar" size={16} /> {Object.values(data.closed)[0]}</p>}
          <div className="fee-tiles att-tiles">
            <div className="fee-tile"><span>{t('att.tDone')}</span><strong>{data.totals.submitted} / {data.totals.sections}</strong>{data.totals.draft > 0 && <em className="muted">{t('att.tDrafts', { n: data.totals.draft })}</em>}</div>
            <div className={`fee-tile ${data.totals.notTaken ? 'due has' : ''}`}><span>{t('att.tPending')}</span><strong>{data.totals.notTaken}</strong></div>
            <div className="fee-tile"><span>{t('att.tPresent')}</span><strong>{data.totals.present}</strong>{pct !== null && <em className="muted">{pct}%</em>}</div>
            <div className="fee-tile"><span>{t('att.tAbsent')}</span><strong>{data.totals.absent}</strong>{data.totals.leave > 0 && <em className="muted">{t('att.tLeave', { n: data.totals.leave })}</em>}</div>
          </div>
          <ul className="att-grid">
            {rows.map((r) => {
              const done = r.status === 'SUBMITTED' || r.status === 'LOCKED';
              const href = `/attendance?section=${r.sectionId}&date=${date}${periodId ? `&period=${periodId}` : ''}`;
              return (
                <li key={r.sectionId} className={`att-card ${done ? 'done' : r.status ? 'draft' : data.closed[r.campusId] ? 'closed' : 'pending'}`}>
                  <Link href={href} className="att-card-link">
                    <span className="att-card-top">
                      <strong>{r.className} – {r.sectionName}</strong>
                      <span className="att-card-state">{done ? t('att.stateSubmitted') : r.status ? t('att.stateDraft') : data.closed[r.campusId] ? t('att.closed') : t('att.stateNew')}</span>
                    </span>
                    <span className="muted small">{r.programName} · {t('att.nStudents', { n: r.students })}</span>
                    {done || r.status ? (
                      <span className="att-card-counts small">
                        <span><b>{r.present + r.late + r.halfDay}</b> {t('att.s.PRESENT')}</span>
                        <span className={r.absent ? 'abs' : ''}><b>{r.absent}</b> {t('att.s.ABSENT')}</span>
                        {r.leave > 0 && <span><b>{r.leave}</b> {t('att.s.LEAVE')}</span>}
                      </span>
                    ) : <span className="att-card-counts small muted">{t('att.notYet')}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="muted small">{t('att.dayFoot', { date: day(date) })}</p>
        </>
      )}
    </>
  );
}

export default function AttendanceDayPage() {
  return <Suspense fallback={<SkeletonRows rows={6} />}><DayOverview /></Suspense>;
}
