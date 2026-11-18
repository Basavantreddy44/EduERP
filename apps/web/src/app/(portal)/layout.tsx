'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import { Icon, IconName } from '@/components/Icon';
import { useInstall } from '@/components/pwa';
import { NotificationBell } from '../(app)/NotificationBell';

/** Two letters from a full name, e.g. "Ravi Kumar" → "RK". */
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/** Parent & student app (M5.1): a simple shell — brand, institution, notifications, account. */
export default function PortalShell({ children }: { children: React.ReactNode }) {
  const { loading, session, permissions, portal, logout } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const install = useInstall();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!session.tenantId) router.replace('/select-institution');
    else if (portal && !portal.hasPortal) router.replace('/dashboard');
  }, [loading, session, portal, router]);
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);

  if (loading || !session || !portal?.hasPortal) return null;
  const tenant = session.memberships.find((m) => m.tenantId === session.tenantId);

  return (
    <div className="portal">
      <a href="#main" className="skip-link">{t('common.skipToContent')}</a>
      <header className="portal-top">
        <Link href="/portal" className="portal-brand">
          <span className="side-mark"><Icon name="cap" size={18} /></span>
          <span className="portal-school">{tenant?.name ?? 'EduERP'}</span>
        </Link>
        <div className="top-right">
          <NotificationBell tenantId={session.tenantId!} />
          <div className="user-menu" ref={menuRef}>
            <button className="user-btn" aria-label={session.user.fullName} aria-expanded={menuOpen} aria-controls="portal-menu" onClick={() => setMenuOpen((v) => !v)}>
              <span className="avatar" aria-hidden>{initials(session.user.fullName)}</span>
              <span className="user-name">{session.user.fullName}</span>
              <Icon name="chevronDown" size={16} className="muted" />
            </button>
            {menuOpen && (
              <div className="dropdown" id="portal-menu">
                <div className="dropdown-head"><strong>{session.user.fullName}</strong><span>{tenant?.name}</span></div>
                <div className="lang-row">{t('common.language')}<LanguageSwitch /></div>
                {install.kind === 'prompt' && <button className="dropdown-item" onClick={() => { setMenuOpen(false); install.install(); }}><Icon name="download" /> {t('pwa.install')}</button>}
                {install.kind === 'ios' && <button className="dropdown-item" onClick={() => { setMenuOpen(false); setIosHelp(true); }}><Icon name="download" /> {t('pwa.install')}</button>}
                <div className="dropdown-item soon-item" aria-disabled="true"><Icon name="bell" /> {t('pwa.push')} <span className="soon-badge">{t('common.comingSoon')}</span></div>
                {permissions.length > 0 && <Link href="/dashboard" className="dropdown-item"><Icon name="home" /> {t('portal.staffScreens')}</Link>}
                {session.memberships.length > 1 && <Link href="/select-institution" className="dropdown-item"><Icon name="swap" /> {t('shell.switchInstitution')}</Link>}
                <button className="dropdown-item" onClick={logout}><Icon name="logout" /> {t('shell.signOut')}</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {iosHelp && (
        <div className="notice ios-help" role="status">
          <Icon name="info" />
          <span>{t('pwa.iosHelp')}</span>
          <button type="button" className="btn btn-ghost icon-btn" aria-label={t('common.close')} onClick={() => setIosHelp(false)}><Icon name="x" size={16} /></button>
        </div>
      )}
      <main className="portal-main" id="main" tabIndex={-1} key={path}>{children}</main>
      <BottomTabs />
    </div>
  );
}

/** Phone navigation (M5.3): Home and the current (or first) child's Attendance / Fees / Leave. */
function BottomTabs() {
  const { portal, hasModule } = useSession();
  const { t } = useI18n();
  const path = usePathname();
  const [hash, setHash] = useState('');
  useEffect(() => { const f = () => setHash(window.location.hash.slice(1)); f(); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, [path]);
  if (!portal?.children.length) return null;
  const current = portal.children.find((c) => path === `/portal/${c.id}`) ?? portal.children[0];
  const onChild = path === `/portal/${current.id}`;
  const items: { key: string; href: string; icon: IconName; label: string; on: boolean }[] = [
    { key: 'home', href: '/portal', icon: 'home', label: t('pwa.tab.home'), on: path === '/portal' },
    ...(hasModule('ATTENDANCE') ? [{ key: 'attendance', href: `/portal/${current.id}#attendance`, icon: 'calendar' as IconName, label: t('pt.tab.attendance'), on: onChild && (hash === 'attendance' || hash === '') }] : []),
    ...(hasModule('FEES') ? [{ key: 'fees', href: `/portal/${current.id}#fees`, icon: 'rupee' as IconName, label: t('pt.tab.fees'), on: onChild && hash === 'fees' }] : []),
    ...(hasModule('ATTENDANCE') ? [{ key: 'leave', href: `/portal/${current.id}#leave`, icon: 'clipboard' as IconName, label: t('pt.tab.leave'), on: onChild && hash === 'leave' }] : []),
  ];
  return (
    <nav className="bottom-tabs" aria-label={t('pwa.nav')}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={i.on ? 'on' : ''}
          aria-current={i.on ? 'page' : undefined}
          onClick={(e) => {
            // Same child page: switch the tab in place (a hash-only link does not reload the page).
            if (onChild && i.key !== 'home') {
              e.preventDefault();
              history.replaceState(null, '', `#${i.key}`);
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }
          }}
        >
          <Icon name={i.icon} size={20} />
          <span>{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
