'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MODULES, PERMISSIONS } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon, IconName } from '@/components/Icon';
import { PageHeader, StatTile, StatusBadge } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface Step {
  key: string;
  icon: IconName;
  title: string;
  text: string;
  href: string;
  done: boolean;
}

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'dash.morning' : h < 17 ? 'dash.afternoon' : 'dash.evening';
};

export default function Dashboard() {
  const { session, can, plan, modules } = useSession();
  const { t, locale } = useI18n();
  const [counts, setCounts] = useState<{ campuses?: number; pending?: number; unread?: number; year?: string | null; departments?: number; holidays?: number; users?: number }>({});

  useEffect(() => {
    const get = <T,>(path: string, ok: boolean) => (ok ? api<T>(path).catch(() => null) : Promise.resolve(null));
    Promise.all([
      get<unknown[]>('/campuses', can(PERMISSIONS.ORG_CAMPUS_READ)),
      get<unknown[]>('/approvals/inbox', true),
      get<{ unreadCount: number }>('/notifications?limit=1', true),
      get<{ name: string; isCurrent: boolean }[]>('/academic-years', can(PERMISSIONS.ORG_ACADEMIC_READ)),
      get<unknown[]>('/departments', can(PERMISSIONS.ORG_ACADEMIC_READ)),
      get<unknown[]>('/holidays', can(PERMISSIONS.ORG_ACADEMIC_READ)),
      get<unknown[]>('/users', can(PERMISSIONS.IAM_USER_READ)),
    ]).then(([campuses, inbox, notes, years, depts, hols, users]) =>
      setCounts({
        campuses: campuses?.length,
        pending: inbox?.length ?? 0,
        unread: notes?.unreadCount ?? 0,
        year: years ? years.find((y) => y.isCurrent)?.name ?? null : undefined,
        departments: depts?.length,
        holidays: hols?.length,
        users: users?.length,
      }),
    );
  }, [can]);

  const firstName = session?.user.fullName.split(' ')[0] ?? '';
  const isAdmin = can(PERMISSIONS.ORG_CAMPUS_CREATE, { allCampuses: true });
  const steps: Step[] = isAdmin
    ? [
        { key: 'campus', icon: 'campus', title: t('dash.s1.t'), text: t('dash.s1.d'), href: '/campuses', done: (counts.campuses ?? 0) > 0 },
        { key: 'year', icon: 'calendar', title: t('dash.s2.t'), text: t('dash.s2.d'), href: '/academic-years', done: !!counts.year },
        { key: 'dept', icon: 'department', title: t('dash.s3.t'), text: t('dash.s3.d'), href: '/departments', done: (counts.departments ?? 0) > 0 },
        { key: 'hol', icon: 'holiday', title: t('dash.s4.t'), text: t('dash.s4.d'), href: '/holidays', done: (counts.holidays ?? 0) > 0 },
        { key: 'users', icon: 'users', title: t('dash.s5.t'), text: t('dash.s5.d'), href: '/users', done: (counts.users ?? 0) > 1 },
      ]
    : [];
  const done = steps.filter((s) => s.done).length;
  const enabledNonCore = MODULES.filter((m) => !('core' in m) && modules.includes(m.code)).length;

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        title={t(greetingKey(), { name: firstName })}
        description={counts.pending ? (counts.pending === 1 ? t('dash.waitingOne') : t('dash.waitingMany', { n: counts.pending })) : t('dash.today')}
      />

      <div className="stats">
        <StatTile icon="approvals" label={t('dash.tile.waiting')} value={counts.pending ?? '–'} hint={t('dash.tile.waitingHint')} href="/approvals" />
        <StatTile icon="bell" label={t('dash.tile.unread')} value={counts.unread ?? '–'} hint={t('dash.tile.unreadHint')} />
        {counts.campuses !== undefined && <StatTile icon="campus" label={t('dash.tile.campuses')} value={counts.campuses} hint={t('dash.tile.campusesHint')} href="/campuses" />}
        {counts.year !== undefined && <StatTile icon="calendar" label={t('dash.tile.year')} value={counts.year ?? t('common.notSet')} hint={counts.year ? t('dash.tile.yearHint') : t('dash.tile.yearSet')} href="/academic-years" />}
      </div>

      <div className="dash-grid">
        {steps.length > 0 && (
          <section className="card">
            <div className="card-row">
              <div>
                <h2 className="card-title">{t('dash.ready')}</h2>
                <p className="muted">{done === steps.length ? t('dash.allSet') : t('dash.progress', { done, total: steps.length })}</p>
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
                    <span className="step-text">
                      <strong>{s.title}</strong>
                      <span>{s.text}</span>
                    </span>
                    <Icon name="chevronRight" className="muted" />
                  </Link>
                </li>
              ))}
            </ol>
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
    </>
  );
}
