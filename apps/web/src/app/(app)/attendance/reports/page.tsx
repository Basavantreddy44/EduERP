'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PERMISSIONS } from '@eduerp/shared';
import { api, downloadFile } from '@/lib/api';
import { useSession } from '@/lib/session';
import { apiErrors } from '@/lib/form';
import { useI18n } from '@/lib/i18n';
import { Icon } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, useToast } from '@/components/ui';
import { todayIST, useDay } from '@/components/admissions';
import { useAttendanceOptions } from '@/components/attendance';

type Tab = 'register' | 'students' | 'staff';
interface Day { date: string; dow: number; kind: 'working' | 'off' | 'holiday' | 'future' | 'outside'; holiday: string | null; taken?: boolean; present?: number; absent?: number }
interface RegRow { id: string; name: string; admissionNo: string; rollNo: string | null; cells: Record<string, string>; present: number; late: number; halfDay: number; absent: number; leave: number; marked: number; pct: number | null }
interface Register { section: { name: string; programName: string; year: string }; month: string; minPercent: number; days: Day[]; students: RegRow[]; summary: { students: number; daysTaken: number; workingDays: number; pct: number | null; below: number } }
interface PctRow { id: string; name: string; admissionNo: string; className: string; present: number; late: number; halfDay: number; absent: number; leave: number; marked: number; pct: number }
interface Pct { minPercent: number; threshold: number | null; items: PctRow[]; summary: { students: number; shown: number; pct: number | null; belowMin: number } }
interface StaffRow { id: string; name: string; code: string; designation: string | null; cells: Record<string, string>; present: number; onDuty: number; halfDay: number; absent: number; leave: number; marked: number; workingDays: number; notMarked: number; pct: number | null }
interface StaffRep { days: Day[]; staff: StaffRow[]; summary: { staff: number; workingDays: number; daysMarked: number } }

const thisMonth = () => todayIST().slice(0, 7);
const monthStart = (m: string) => `${m}-01`;
const pctClass = (p: number | null, min: number) => (p === null ? '' : p < min ? 'pct-low' : p < min + 10 ? 'pct-mid' : 'pct-ok');

/** Attendance reports (M3.5): monthly register, student percentages, staff month. */
export default function AttendanceReportsPage() {
  const { can, campusId: sessionCampus } = useSession();
  const { t } = useI18n();
  const toast = useToast();
  const opts = useAttendanceOptions();
  const [tab, setTab] = useState<Tab>('register');
  const [error, setError] = useState<string | null>(null);

  async function download(path: string) {
    try { await downloadFile(path); toast(t('rep.downloaded')); } catch (e) { setError(apiErrors(e).message); }
  }
  if (!opts) return <SkeletonRows rows={6} />;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'register', label: t('rep.register') },
    { key: 'students', label: t('rep.students') },
    ...(can(PERMISSIONS.STAFF_ATT_MARK) ? [{ key: 'staff' as Tab, label: t('rep.staff') }] : []),
  ];
  return (
    <>
      <PageHeader eyebrow={t('nav.attendance')} title={t('rep.title')} description={t('rep.desc')} />
      <div className="tabs" role="tablist" aria-label={t('rep.title')}>
        {tabs.map((x) => <button key={x.key} role="tab" type="button" aria-selected={tab === x.key} className={`tab ${tab === x.key ? 'on' : ''}`} onClick={() => { setTab(x.key); setError(null); }}>{x.label}</button>)}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {tab === 'register' && <RegisterTab opts={opts} onDownload={download} />}
      {tab === 'students' && <StudentsTab opts={opts} campusId={sessionCampus || ''} onDownload={download} />}
      {tab === 'staff' && <StaffTab opts={opts} campusId={sessionCampus || ''} onDownload={download} />}
    </>
  );
}

type Opts = NonNullable<ReturnType<typeof useAttendanceOptions>>;

function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const { t } = useI18n();
  const move = (n: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7); if (d <= thisMonth()) setMonth(d); };
  return (
    <div className="att-daynav">
      <button type="button" className="btn btn-ghost icon-btn" aria-label={t('rep.prevMonth')} onClick={() => move(-1)}><Icon name="chevronRight" className="flip" /></button>
      <label className="filter"><span>{t('rep.month')}</span><input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
      <button type="button" className="btn btn-ghost icon-btn" aria-label={t('rep.nextMonth')} disabled={month >= thisMonth()} onClick={() => move(1)}><Icon name="chevronRight" /></button>
    </div>
  );
}

function Grid({ days, rows, min, first, totals }: { days: Day[]; rows: { id: string; label: string; sub: string; cells: Record<string, string>; pct: number | null; tail: (string | number)[] }[]; min: number; first: string; totals: string[] }) {
  const { t } = useI18n();
  const shown = days.filter((d) => d.kind !== 'outside');
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <div className="table-wrap reg-wrap" role="region" tabIndex={0} aria-label={first === t('stu.col.student') ? t('rep.register') : t('rep.staff')}>
      <table className="reg-table">
        <caption className="sr-only">{t('rep.register')}</caption>
        <thead>
          <tr>
            <th scope="col" className="reg-name">{first}</th>
            {shown.map((d) => <th key={d.date} scope="col" className={`reg-day k-${d.kind}`} title={d.holiday ?? undefined}><span>{Number(d.date.slice(8))}</span><small>{dow[d.dow]}</small></th>)}
            {totals.map((h) => <th key={h} scope="col" className="reg-tot">{h}</th>)}
            <th scope="col" className="reg-tot">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="reg-name"><strong>{r.label}</strong><span className="sub-line muted small">{r.sub}</span></th>
              {shown.map((d) => { const c = r.cells[d.date]; return <td key={d.date} className={`reg-cell k-${d.kind} ${c ? `c-${c.replace('/', '_')}` : ''}`}>{c ?? (d.kind === 'holiday' ? <span className="hol-mark">Hol</span> : '')}</td>; })}
              {r.tail.map((v, i) => <td key={i} className="reg-tot">{v}</td>)}
              <td className={`reg-tot reg-pct ${pctClass(r.pct, min)}`}>{r.pct ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterTab({ opts, onDownload }: { opts: Opts; onDownload: (p: string) => void }) {
  const { t } = useI18n();
  const [sectionId, setSection] = useState(opts.sections[0]?.id ?? '');
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Register | null>(null);
  useEffect(() => { if (!sectionId) return; setData(null); api<Register>(`/attendance/reports/register?sectionId=${sectionId}&month=${month}`).then(setData).catch(() => setData(null)); }, [sectionId, month]);
  const groups = [...new Set(opts.sections.map((s) => s.level.program.name))];
  if (!opts.sections.length) return <EmptyState icon="users" title={t('rep.noClasses')} />;
  return (
    <>
      <div className="card filter-bar">
        <label className="filter att-class"><span>{t('att.class')}</span>
          <select value={sectionId} onChange={(e) => setSection(e.target.value)}>
            {groups.map((g) => <optgroup key={g} label={g}>{opts.sections.filter((s) => s.level.program.name === g).map((s) => <option key={s.id} value={s.id}>{s.level.name} – {s.name}</option>)}</optgroup>)}
          </select>
        </label>
        <MonthNav month={month} setMonth={setMonth} />
        <span className="action-bar-spacer" />
        <button type="button" className="btn" onClick={() => onDownload(`/attendance/reports/register?sectionId=${sectionId}&month=${month}&format=xlsx`)}><Icon name="download" /> {t('rep.excel')}</button>
      </div>
      {!data ? <SkeletonRows rows={6} /> : data.students.length === 0 ? <EmptyState icon="users" title={t('rep.noStudents')} /> : (
        <section className="card">
          <div className="fee-tiles rep-tiles">
            <div className="fee-tile"><span>{t('rep.classPct')}</span><strong>{data.summary.pct ?? '–'}{data.summary.pct !== null && '%'}</strong></div>
            <div className="fee-tile"><span>{t('rep.daysTaken')}</span><strong>{data.summary.daysTaken} / {data.summary.workingDays}</strong></div>
            <div className={`fee-tile ${data.summary.below ? 'due has' : ''}`}><span>{t('rep.belowN', { n: data.minPercent })}</span><strong>{data.summary.below}</strong></div>
          </div>
          <Grid days={data.days} min={data.minPercent} first={t('stu.col.student')} totals={['P', 'A', 'LV']}
            rows={data.students.map((s) => ({ id: s.id, label: s.name, sub: `${s.rollNo ? `${t('stu.roll')} ${s.rollNo} · ` : ''}${s.admissionNo}`, cells: s.cells, pct: s.pct, tail: [s.present + s.late + s.halfDay, s.absent, s.leave] }))} />
          <p className="muted small rep-legend">{t('rep.legend')}</p>
        </section>
      )}
    </>
  );
}

function StudentsTab({ opts, campusId, onDownload }: { opts: Opts; campusId: string; onDownload: (p: string) => void }) {
  const { t } = useI18n();
  const day = useDay();
  const [from, setFrom] = useState(opts.year && opts.year.startDate > monthStart(thisMonth()) ? opts.year.startDate : monthStart(thisMonth()));
  const [to, setTo] = useState(todayIST());
  const [levelId, setLevel] = useState('');
  const [onlyLow, setOnlyLow] = useState(true);
  const [data, setData] = useState<Pct | null>(null);
  const levels = useMemo(() => [...new Map(opts.sections.map((s) => [s.level.id, `${s.level.program.name} · ${s.level.name}`])).entries()], [opts.sections]);
  const qs = `from=${from}&to=${to}${campusId ? `&campusId=${campusId}` : ''}${levelId ? `&programLevelId=${levelId}` : ''}${onlyLow ? '&belowMin=true' : ''}`;
  useEffect(() => { if (from && to && to >= from) { setData(null); api<Pct>(`/attendance/reports/students?${qs}`).then(setData).catch(() => setData(null)); } }, [qs, from, to]);
  return (
    <>
      <div className="card filter-bar">
        <label className="filter"><span>{t('leave.from')}</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="filter"><span>{t('leave.to')}</span><input type="date" value={to} min={from} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="filter"><span>{t('att.class')}</span>
          <select value={levelId} onChange={(e) => setLevel(e.target.value)}><option value="">{t('stu.allClasses')}</option>{levels.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        </label>
        <label className="check rep-only"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> {t('rep.onlyBelow', { n: data?.minPercent ?? 75 })}</label>
        <span className="action-bar-spacer" />
        <button type="button" className="btn" onClick={() => onDownload(`/attendance/reports/students?${qs}&format=xlsx`)}><Icon name="download" /> {t('rep.excel')}</button>
      </div>
      {!data ? <SkeletonRows rows={5} /> : (
        <section className="card">
          <div className="fee-tiles rep-tiles">
            <div className="fee-tile"><span>{t('rep.overall')}</span><strong>{data.summary.pct ?? '–'}{data.summary.pct !== null && '%'}</strong><em className="muted">{t('rep.studentsN', { n: data.summary.students })}</em></div>
            <div className={`fee-tile ${data.summary.belowMin ? 'due has' : ''}`}><span>{t('rep.belowN', { n: data.minPercent })}</span><strong>{data.summary.belowMin}</strong></div>
          </div>
          <p className="muted small">{t('rep.period', { from: day(from), to: day(to) })}{' '}{hasThreshold(data) && <Link href="/settings">{t('rep.changeMin')}</Link>}</p>
          {data.items.length === 0 ? <EmptyState icon="check" title={onlyLow ? t('rep.noneBelow') : t('rep.noMarks')} /> : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('rep.students')}</caption>
                <thead><tr><th scope="col">{t('stu.col.student')}</th><th scope="col">{t('att.class')}</th><th scope="col" className="num">{t('rep.attended')}</th><th scope="col" className="num hide-sm">{t('att.s.ABSENT')}</th><th scope="col" className="num hide-sm">{t('att.s.LEAVE')}</th><th scope="col">%</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/students/${r.id}`}><strong>{r.name}</strong></Link><span className="sub-line muted small mono">{r.admissionNo}</span></td>
                      <td>{r.className}</td>
                      <td className="num">{r.present + r.late + r.halfDay / 2} / {r.marked}</td>
                      <td className="num hide-sm">{r.absent}</td>
                      <td className="num hide-sm">{r.leave}</td>
                      <td><span className={`pct-bar ${pctClass(r.pct, data.minPercent)}`}><span style={{ width: `${r.pct}%` }} /></span><strong className={`pct-num ${pctClass(r.pct, data.minPercent)}`}>{r.pct}%</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
/** The list is limited to a percentage: offer the link to change the minimum. */
const hasThreshold = (d: Pct) => d.threshold !== null;

function StaffTab({ opts, campusId: sessionCampus, onDownload }: { opts: Opts; campusId: string; onDownload: (p: string) => void }) {
  const { t } = useI18n();
  const [campusId, setCampus] = useState(sessionCampus || opts.campuses[0]?.id || '');
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<StaffRep | null>(null);
  useEffect(() => { if (!campusId) return; setData(null); api<StaffRep>(`/attendance/reports/staff?campusId=${campusId}&month=${month}`).then(setData).catch(() => setData(null)); }, [campusId, month]);
  return (
    <>
      <div className="card filter-bar">
        {opts.campuses.length > 1 && <label className="filter"><span>{t('common.campus')}</span><select value={campusId} onChange={(e) => setCampus(e.target.value)}>{opts.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <MonthNav month={month} setMonth={setMonth} />
        <span className="action-bar-spacer" />
        <button type="button" className="btn" onClick={() => onDownload(`/attendance/reports/staff?campusId=${campusId}&month=${month}&format=xlsx`)}><Icon name="download" /> {t('rep.excel')}</button>
      </div>
      {!data ? <SkeletonRows rows={5} /> : data.staff.length === 0 ? <EmptyState icon="users" title={t('satt.noStaff')} /> : (
        <section className="card">
          <div className="fee-tiles rep-tiles">
            <div className="fee-tile"><span>{t('rep.daysTaken')}</span><strong>{data.summary.daysMarked} / {data.summary.workingDays}</strong></div>
            <div className="fee-tile"><span>{t('staff.title')}</span><strong>{data.summary.staff}</strong></div>
          </div>
          <Grid days={data.days} min={75} first={t('staff.title')} totals={['P', 'A', 'LV', t('rep.notMarked')]}
            rows={data.staff.map((s) => ({ id: s.id, label: s.name, sub: `${s.code}${s.designation ? ` · ${s.designation}` : ''}`, cells: s.cells, pct: s.pct, tail: [s.present + s.onDuty + s.halfDay, s.absent, s.leave, s.notMarked] }))} />
          <p className="muted small rep-legend">{t('rep.staffLegend')}</p>
        </section>
      )}
    </>
  );
}
