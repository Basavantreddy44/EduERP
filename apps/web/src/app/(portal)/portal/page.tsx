'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/ui';
import { SchoolNews } from '@/components/portal-news';

/** Two letters from a full name, e.g. "Ravi Kumar" → "RK". */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'dash.morning' : h < 17 ? 'dash.afternoon' : 'dash.evening';
};

/** Parent & student home (M5.1): one card per child (or the student themself). */
export default function PortalHome() {
  const { session, portal } = useSession();
  const { t, locale } = useI18n();
  if (!session || !portal) return null;
  const self = portal.children.length === 1 && portal.children[0].relation === 'SELF';
  const relation = (r: string) => (r === 'SELF' ? '' : t(`stu.rel.${r}` as MessageKey) !== `stu.rel.${r}` ? t(`stu.rel.${r}` as MessageKey) : r.charAt(0) + r.slice(1).toLowerCase());

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        title={t(greetingKey(), { name: session.user.fullName.split(' ')[0] })}
        description={self ? t('portal.introSelf') : t(portal.children.length === 1 ? 'portal.introOne' : 'portal.introMany', { n: portal.children.length })}
      />
      <ul className="child-cards">
        {portal.children.map((c) => (
          <li key={c.id}>
            <Link href={`/portal/${c.id}`} className="card child-card">
              <span className="avatar avatar-lg" aria-hidden>{initials(c.name)}</span>
              <span className="child-text">
                <span className="card-title">{c.name}</span>
                <span className="child-class">{c.className ? `${c.className} – ${c.sectionName}` : t('portal.noClass')}</span>
                <span className="muted small">{[c.admissionNo, c.campusName, relation(c.relation) && t('portal.youAre', { rel: relation(c.relation) })].filter(Boolean).join(' · ')}</span>
                <span className="child-links">{t('portal.open')}</span>
              </span>
              <Icon name="chevronRight" className="muted" />
            </Link>
          </li>
        ))}
      </ul>
      <SchoolNews />
      <section className="card portal-soon">
        <span className="soon-icon"><Icon name="bell" size={18} /></span>
        <div>
          <strong>{t('portal.smsTitle')} <span className="soon-badge">{t('common.comingSoon')}</span></strong>
          <p className="muted small">{t('portal.smsText')}</p>
        </div>
      </section>
    </>
  );
}
