'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DashboardSummary, DashboardTrends, MODULES, PERMISSIONS, formatINR, toPaise } from '@eduerp/shared';
import { ApiError, api } from '@/lib/api';
import { apiErrors } from '@/lib/form';
import { useSession } from '@/lib/session';
import { Icon, IconName } from '@/components/Icon';
import { EmptyState, PageHeader, SkeletonRows, StatTile, StatusBadge } from '@/components/ui';
import { ChartPoint, TrendChart, inrShort, niceMax } from '@/components/charts';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

interface Step { key: string; icon: IconName; title: string; text: string; href: string; done: boolean }
interface Todo { key: string; icon: IconName; tone: 'bad' | 'warn' | 'info'; title: string; text: string; href: string }

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'dash.morning' : h < 17 ? 'dash.afternoon' : 'dash.evening';
};
const inr = (s: string) => formatINR(toPaise(s));
const SHOW_SHEETS = 6;
const STAGES = ['SUBMITTED', 'APPROVED', 'WAITLISTED', 'ENROLLED', 'REJECTED'] as const;

export default function Dashboard() {
  const { session, can, plan, modules, campusId } = useSession();
  const { t, locale } = useI18n();
  const [d, setD] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ campuses: number; year: boolean; departments: number; holidays: number; users: number } | null>(null);
  const isAdmin = can(PERMISSIONS.ORG_CAMPUS_CREATE, { allCampuses: true });

  // Follows the campus chosen in the top bar. A campus none of the user's dashboard blocks cover
  // (404) falls back to everything they can see.
  useEffect(() => {
    let live = true;
    setD(null); setError(null);
    const load = (c: string | null) => api<DashboardSummary>(`/dashboard/summary${c ? `?campusId=${c}` : ''}`);
    load(campusId)
      .catch((e) => (e instanceof ApiError && e.status === 404 && campusId ? load(null) : Promise.reject(e)))
      .then((x) => { if (live) setD(x); })
      .catch((e) => { if (live) setError(apiErrors(e).message); });
    return () => { live = false; };
  }, [campusId]);

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api<unknown[]>('/campuses'), api<{ isCurrent: boolean }[]>('/academic-years'), api<unknown[]>('/departments'), api<unknown[]>('/holidays'), api<unknown[]>('/users'),
    ]).then(([c, y, dep, h, u]) => setSetup({ campuses: c.length, year: y.some((x) => x.isCurrent), departments: dep.length, holidays: h.length, users: u.length })).catch(() => setSetup(null));
  }, [isAdmin]);

  const firstName = session?.user.fullName.split(' ')[0] ?? '';
  const campusName = (id: string) => d?.campuses.find((c) => c.id === id)?.name ?? '';
  const steps: Step[] = isAdmin && setup
    ? [
        { key: 'campus', icon: 'campus', title: t('dash.s1.t'), text: t('dash.s1.d'), href: '/campuses', done: setup.campuses > 0 },
        { key: 'year', icon: 'calendar', title: t('dash.s2.t'), text: t('dash.s2.d'), href: '/academic-years', done: setup.year },
        { key: 'dept', icon: 'department', title: t('dash.s3.t'), text: t('dash.s3.d'), href: '/departments', done: setup.departments > 0 },
        { key: 'hol', icon: 'holiday', title: t('dash.s4.t'), text: t('dash.s4.d'), href: '/holidays', done: setup.holidays > 0 },
        { key: 'users', icon: 'users', title: t('dash.s5.t'), text: t('dash.s5.d'), href: '/users', done: setup.users > 1 },
      ]
    : [];
  const done = steps.filter((s) => s.done).length;
  const enabledNonCore = MODULES.filter((m) => !('core' in m) && modules.includes(m.code)).length;

  // ───── What needs doing, most urgent first; each item opens the screen where it is done. ─────
  const todos: Todo[] = [];
  if (d?.attendance) {
    for (const s of d.attendance.open.slice(0, SHOW_SHEETS)) {
      todos.push({
        key: `sheet-${s.sectionId}`, icon: 'clipboard', tone: s.status === 'DRAFT' ? 'warn' : 'bad',
        title: t(s.status === 'DRAFT' ? 'home.sheetDraft' : 'home.sheetOpen', { cls: `${s.className} – ${s.sectionName}` }),
        text: [t('home.nStudents', { n: s.students }), d.campuses.length > 1 ? campusName(s.campusId) : ''].filter(Boolean).join(' · '),
        href: `/attendance?section=${s.sectionId}&date=${d.date}${s.periodId ? `&period=${s.periodId}` : ''}`,
      });
    }
    const more = d.attendance.notTaken + d.attendance.draft - Math.min(d.attendance.open.length, SHOW_SHEETS);
    if (more > 0) todos.push({ key: 'sheets-more', icon: 'clipboard', tone: 'bad', title: t('home.sheetsMore', { n: more }), text: t('home.sheetsMoreHint'), href: '/attendance/day' });
  }
  if (d?.staff) {
    for (const c of d.staff.notMarkedCampuses) {
      todos.push({ key: `staff-${c}`, icon: 'users', tone: 'warn', title: t('home.staffOpen'), text: campusName(c), href: `/staff-attendance?campus=${c}` });
    }
  }
  const enq = d?.admissions?.enquiries;
  if (enq && enq.overdue) todos.push({ key: 'enq-late', icon: 'phone', tone: 'bad', title: t(enq.overdue === 1 ? 'home.followLateOne' : 'home.followLate', { n: enq.overdue }), text: t('home.followHint'), href: '/admissions/enquiries?show=due' });
  if (enq && enq.dueToday) todos.push({ key: 'enq-today', icon: 'phone', tone: 'warn', title: t(enq.dueToday === 1 ? 'home.followTodayOne' : 'home.followToday', { n: enq.dueToday }), text: t('home.followHint'), href: '/admissions/enquiries?show=due' });
  const apps = d?.admissions?.applications;
  if (apps && apps.pending) todos.push({ key: 'apps', icon: 'file', tone: 'info', title: t(apps.pending === 1 ? 'home.appsOne' : 'home.apps', { n: apps.pending }), text: t('home.appsHint'), href: '/admissions/applications?status=SUBMITTED' });
  const fees = d?.fees;
  if (fees && fees.outstanding.overdueStudents) {
    todos.push({ key: 'fees', icon: 'rupee', tone: 'warn', title: t(fees.outstanding.overdueStudents === 1 ? 'home.overdueOne' : 'home.overdue', { n: fees.outstanding.overdueStudents }), text: t('home.overdueHint', { amount: inr(fees.outstanding.overdue) }), href: '/fees/dues?overdue=1' });
  }
  for (const a of d?.approvals.items ?? []) {
    const label = t(`entity.${a.entityType}` as MessageKey);
    todos.push({ key: `apr-${a.id}`, icon: 'approvals', tone: 'info', title: a.summary ? `${label}: ${a.summary}` : label, text: t('home.requestedBy', { name: a.requesterName }), href: '/approvals' });
  }

  const att = d?.attendance;
  const closedHere = d ? Object.entries(d.closed) : [];
  const allClosed = d ? d.campuses.length > 0 && closedHere.length === (d.campusId ? 1 : d.campuses.length) : false;
  const maxMode = fees ? Math.max(1, ...fees.month.byMode.map((m) => toPaise(m.amount))) : 1;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        title={t(greetingKey(), { name: firstName })}
        description={d?.approvals.waiting ? (d.approvals.waiting === 1 ? t('dash.waitingOne') : t('dash.waitingMany', { n: d.approvals.waiting })) : t('dash.today')}
      />

      {error && <div className="alert" role="alert"><Icon name="alert" />{error}</div>}
      {closedHere.length > 0 && (
        <p className="notice dash-closed" role="status">
          <Icon name="holiday" size={18} />
          <span>{closedHere.map(([c, why]) => (d!.campuses.length > 1 ? `${campusName(c)}: ${why}` : why)).join(' · ')}</span>
        </p>
      )}

      {!d && !error ? <SkeletonRows rows={5} /> : d && (
        <>
          <div className="stats dash-stats">
            {att && att.sections > 0 && !allClosed && (
              <StatTile icon="check" label={t('home.presentToday')} value={att.presentPct === null ? '–' : `${att.presentPct}%`}
                hint={att.presentPct === null ? t('home.noneMarked') : t('home.presentHint', { present: att.present, marked: att.present + att.absent + att.leave, absent: att.absent })} href="/attendance/day" />
            )}
            {att && att.sections > 0 && !allClosed && (
              <StatTile icon="clipboard" label={t('home.classesOpen')} value={att.notTaken + att.draft} hint={t('home.classesHint', { done: att.submitted, total: att.sections })} href="/attendance/day" />
            )}
            {d.staff && d.staff.staff > 0 && !allClosed && (
              <StatTile icon="users" label={t('home.staffPresent')} value={`${d.staff.present} / ${d.staff.staff}`} hint={t('home.staffHint', { leave: d.staff.onLeave, open: d.staff.notMarked })} href="/staff-attendance" />
            )}
            {fees && <StatTile icon="rupee" label={t('home.collectedToday')} value={inr(fees.today.amount)} hint={t(fees.today.receipts === 1 ? 'home.receiptsOne' : 'home.receipts', { n: fees.today.receipts })} href="/fees/reports" />}
            {fees && <StatTile icon="receipt" label={t('home.outstanding')} value={inr(fees.outstanding.balance)} hint={t('home.outstandingHint', { n: fees.outstanding.students })} href="/fees/dues" />}
            {enq && <StatTile icon="phone" label={t('home.followDue')} value={enq.dueToday + enq.overdue} hint={t('home.openEnquiries', { n: enq.open })} href="/admissions/enquiries?show=due" />}
            <StatTile icon="approvals" label={t('dash.tile.waiting')} value={d.approvals.waiting} hint={t('dash.tile.waitingHint')} href="/approvals" />
          </div>

          <div className="dash-grid">
            <div className="dash-col">
              <section className="card">
                <h2 className="card-title">{t('home.attention')}</h2>
                <p className="muted">{todos.length ? t('home.attentionHint') : ''}</p>
                {todos.length === 0 ? (
                  <EmptyState icon="check" title={t('home.clear')} text={t('home.clearHint')} />
                ) : (
                  <ul className="todo-list">
                    {todos.map((x) => (
                      <li key={x.key}>
                        <Link href={x.href} className="todo">
                          <span className={`todo-icon tone-${x.tone}`}><Icon name={x.icon} size={18} /></span>
                          <span className="todo-text"><strong>{x.title}</strong><span>{x.text}</span></span>
                          <Icon name="chevronRight" className="muted" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {apps && (
                <section className="card">
                  <p className="eyebrow">{t('home.admissions', { year: apps.year ?? '' })}</p>
                  <ul className="stage-list">
                    {STAGES.map((s) => (
                      <li key={s}>
                        <Link href={`/admissions/applications?status=${s}`}>
                          <StatusBadge status={s} />
                          <strong>{apps.byStatus[s] ?? 0}</strong>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {enq && <p className="muted small">{t('home.openEnquiries', { n: enq.open })}</p>}
                </section>
              )}

              {steps.length > 0 && done < steps.length && (
                <section className="card">
                  <div className="card-row">
                    <div>
                      <h2 className="card-title">{t('dash.ready')}</h2>
                      <p className="muted">{t('dash.progress', { done, total: steps.length })}</p>
                    </div>
                    <div className="progress-ring" style={{ ['--p' as string]: `${(done / steps.length) * 100}%` }} aria-label={`${done} of ${steps.length} done`}>
                      <span>{Math.round((done / steps.length) * 100)}%</span>
                    </div>
                  </div>
                  <ol className="steps">
                    {steps.map((s) => (
                      <li key={s.key}>
                        <Link href={s.href} className={`step ${s.done ? 'done' : ''}`}>
                          <span className="step-icon">{s.done ? <Icon name="check" size={18} strokeWidth={2.4} /> : <Icon name={s.icon} size={18} />}</span>
                          <span className="step-text"><strong>{s.title}</strong><span>{s.text}</span></span>
                          <Icon name="chevronRight" className="muted" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            <div className="dash-col">
              {fees && (
                <section className="card">
                  <p className="eyebrow">{t('home.thisMonth')}</p>
                  <h2 className="dash-big">{inr(fees.month.amount)}</h2>
                  <p className="muted small">{t(fees.month.receipts === 1 ? 'home.receiptsOne' : 'home.receipts', { n: fees.month.receipts })}</p>
                  {fees.month.byMode.length > 0 && (
                    <ul className="mode-bars" aria-label={t('home.byMode')}>
                      {fees.month.byMode.map((m) => (
                        <li key={m.key}>
                          <span className="mode-name">{t(`fee.mode.${m.key}` as MessageKey)}</span>
                          <span className="mode-bar" aria-hidden="true"><span style={{ width: `${(toPaise(m.amount) / maxMode) * 100}%` }} /></span>
                          <span className="mode-amt">{inr(m.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link href="/fees/reports" className="card-link">{t('home.feeReports')} <Icon name="arrowRight" size={16} /></Link>
                </section>
              )}

              <section className="card plan-card">
                <p className="eyebrow">{t('dash.plan')}</p>
                {plan ? (
                  <>
                    <h2 className="plan-name">{plan.plan.name}</h2>
                    <div className="plan-meta">
                      <StatusBadge status={plan.status} />
                      <span className="muted">{t('dash.until', { date: new Date(plan.endDate).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="plan-name">{t('dash.trial')}</h2>
                    <div className="plan-meta"><StatusBadge status="TRIAL" /><span className="muted">{t('dash.everyModule')}</span></div>
                  </>
                )}
                <p className="plan-modules">{t('dash.modules', { n: enabledNonCore, m: MODULES.filter((m) => !('core' in m)).length })}</p>
                <p className="muted small">{t('dash.modulesNote')}</p>
              </section>
            </div>
          </div>

          <Trends campusId={d.campusId} />
        </>
      )}
    </>
  );
}

/** Fee collection over the last 30 days and attendance over the last 4 weeks (M4.3). */
function Trends({ campusId }: { campusId: string | null }) {
  const { t, locale } = useI18n();
  const [tr, setTr] = useState<DashboardTrends | null>(null);
  useEffect(() => {
    let live = true;
    setTr(null);
    api<DashboardTrends>(`/dashboard/trends${campusId ? `?campusId=${campusId}` : ''}`).then((x) => { if (live) setTr(x); }).catch(() => { if (live) setTr(null); });
    return () => { live = false; };
  }, [campusId]);
  if (!tr || (!tr.collection && !tr.attendance)) return null;
  const date = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', ...o });
  const short = (iso: string) => date(iso, { day: 'numeric', month: 'short' });
  const long = (iso: string) => date(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const receipts = (n: number) => t(n === 1 ? 'home.receiptsOne' : 'home.receipts', { n });

  const col = tr.collection;
  const colTotal = col ? col.reduce((a, d) => a + toPaise(d.amount), 0) : 0;
  const colPoints: ChartPoint[] = (col ?? []).map((d) => ({ key: d.date, axis: short(d.date), title: long(d.date), value: toPaise(d.amount) / 100, text: `${formatINR(toPaise(d.amount))} · ${receipts(d.receipts)}` }));
  const colMax = niceMax(Math.max(0, ...colPoints.map((p) => p.value ?? 0)));

  const att = tr.attendance;
  const attSum = (att ?? []).reduce((a, d) => ({ attended: a.attended + d.attended, marked: a.marked + d.marked }), { attended: 0, marked: 0 });
  const attPct = attSum.marked ? Math.round((attSum.attended / attSum.marked) * 1000) / 10 : null;
  const attPoints: ChartPoint[] = (att ?? []).map((d) => ({ key: d.date, axis: short(d.date), title: long(d.date), value: d.pct, text: d.pct === null ? t('home.notMarked') : t('home.attPoint', { pct: d.pct, attended: d.attended, marked: d.marked }) }));

  return (
    <div className="trend-grid">
      {col && (
        <section className="card">
          <h2 className="card-title">{t('home.trendFees')}</h2>
          <p className="muted small">{t('home.trendFeesHint', { total: formatINR(colTotal), receipts: receipts(col.reduce((a, d) => a + d.receipts, 0)) })}</p>
          <TrendChart kind="bar" points={colPoints} max={colMax} tick={inrShort} label={t('home.trendFees')} />
          <details className="chart-table">
            <summary>{t('home.showTable')}</summary>
            <table>
              <thead><tr><th>{t('home.colDate')}</th><th className="num">{t('home.colAmount')}</th><th className="num">{t('home.colReceipts')}</th></tr></thead>
              <tbody>{[...col].reverse().filter((d) => d.receipts).map((d) => <tr key={d.date}><td>{long(d.date)}</td><td className="num">{formatINR(toPaise(d.amount))}</td><td className="num">{d.receipts}</td></tr>)}</tbody>
            </table>
          </details>
          <Link href="/fees/reports" className="card-link">{t('home.feeReports')} <Icon name="arrowRight" size={16} /></Link>
        </section>
      )}
      {att && (
        <section className="card">
          <h2 className="card-title">{t('home.trendAtt')}</h2>
          <p className="muted small">{attPct === null ? t('home.trendAttNone') : t('home.trendAttHint', { pct: attPct })}</p>
          <TrendChart kind="line" points={attPoints} max={100} tick={(v) => `${v}%`} label={t('home.trendAtt')} />
          <details className="chart-table">
            <summary>{t('home.showTable')}</summary>
            <table>
              <thead><tr><th>{t('home.colDate')}</th><th className="num">{t('home.colPct')}</th><th className="num">{t('home.colMarked')}</th></tr></thead>
              <tbody>{[...att].reverse().map((d) => <tr key={d.date}><td>{long(d.date)}</td><td className="num">{d.pct === null ? t('home.notMarked') : `${d.pct}%`}</td><td className="num">{d.marked}</td></tr>)}</tbody>
            </table>
          </details>
          <Link href="/attendance/reports" className="card-link">{t('home.attReports')} <Icon name="arrowRight" size={16} /></Link>
        </section>
      )}
    </div>
  );
}
