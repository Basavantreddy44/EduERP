'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PERMISSIONS, PermissionCode } from '@eduerp/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { LanguageSwitch, useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { Icon, IconName } from '@/components/Icon';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: IconName;
  permission?: PermissionCode; // none = every member
  anyOf?: PermissionCode[]; // visible with any of these
  module?: string; // plan module the screen belongs to (core modules are always on)
  platform?: boolean; // platform staff only
}

/** Menu is driven by permissions and plan modules; the API enforces the same rules again. */
const NAV: { section: MessageKey; items: NavItem[] }[] = [
  {
    section: 'nav.overview',
    items: [
      { href: '/dashboard', label: 'nav.dashboard', icon: 'home' },
      { href: '/approvals', label: 'nav.approvals', icon: 'approvals' },
    ],
  },
  {
    section: 'nav.admissions',
    items: [
      { href: '/admissions/enquiries', label: 'nav.enquiries', icon: 'phone', permission: PERMISSIONS.ADM_ENQUIRY_MANAGE, module: 'ADMISSIONS' },
      { href: '/admissions/applications', label: 'nav.applications', icon: 'clipboard', permission: PERMISSIONS.ADM_APPLICATION_MANAGE, module: 'ADMISSIONS' },
    ],
  },
  {
    section: 'nav.students',
    items: [
      { href: '/students', label: 'nav.studentList', icon: 'cap', permission: PERMISSIONS.STU_STUDENT_READ, module: 'STUDENTS' },
      { href: '/students/promotion', label: 'nav.promotion', icon: 'layers', permission: PERMISSIONS.STU_PROMOTE, module: 'STUDENTS' },
    ],
  },
  {
    section: 'nav.fees',
    items: [
      { href: '/fees/collect', label: 'nav.collect', icon: 'receipt', permission: PERMISSIONS.FEE_COLLECT, module: 'FEES' },
      { href: '/fees/dues', label: 'nav.dues', icon: 'alert', permission: PERMISSIONS.FEE_READ, module: 'FEES' },
      { href: '/fees/reports', label: 'nav.feeReports', icon: 'layers', permission: PERMISSIONS.FEE_READ, module: 'FEES' },
      { href: '/fees/setup', label: 'nav.feeSetup', icon: 'rupee', permission: PERMISSIONS.FEE_READ, module: 'FEES' },
      { href: '/fees/billing', label: 'nav.billing', icon: 'receipt', permission: PERMISSIONS.FEE_READ, module: 'FEES' },
    ],
  },
  {
    section: 'nav.setup',
    items: [
      { href: '/campuses', label: 'nav.campuses', icon: 'campus', permission: PERMISSIONS.ORG_CAMPUS_READ },
      { href: '/academic-years', label: 'nav.academicYears', icon: 'calendar', permission: PERMISSIONS.ORG_ACADEMIC_READ },
      { href: '/departments', label: 'nav.departments', icon: 'department', permission: PERMISSIONS.ORG_ACADEMIC_READ },
      { href: '/classes', label: 'nav.classes', icon: 'layers', permission: PERMISSIONS.ORG_ACADEMIC_READ },
      { href: '/holidays', label: 'nav.holidays', icon: 'holiday', permission: PERMISSIONS.ORG_ACADEMIC_READ },
      { href: '/users', label: 'nav.users', icon: 'users', permission: PERMISSIONS.IAM_USER_READ },
      { href: '/imports', label: 'nav.imports', icon: 'upload', anyOf: [PERMISSIONS.ORG_ACADEMIC_MANAGE, PERMISSIONS.IAM_USER_INVITE] },
      { href: '/settings', label: 'nav.settings', icon: 'settings', permission: PERMISSIONS.ORG_SETTINGS_READ },
    ],
  },
  {
    section: 'nav.platform',
    items: [
      { href: '/platform/tenants', label: 'nav.institutions', icon: 'building', platform: true },
      { href: '/platform/plans', label: 'nav.plans', icon: 'layers', platform: true },
    ],
  },
];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, session, can, hasModule, logout, campusId, setCampusId } = useSession();
  const { t } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const isPlatformPath = path.startsWith('/platform');
  const canReadCampuses = can(PERMISSIONS.ORG_CAMPUS_READ);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace('/login');
    else if (!session.tenantId && !isPlatformPath) router.replace(session.user.platformRole ? '/platform/tenants' : '/select-institution');
  }, [loading, session, isPlatformPath, router]);

  useEffect(() => {
    if (session?.tenantId && canReadCampuses) api<{ id: string; name: string }[]>('/campuses').then(setCampuses).catch(() => setCampuses([]));
    else setCampuses([]);
  }, [session?.tenantId, canReadCampuses]);

  useEffect(() => {
    if (!session?.tenantId) return setPending(0);
    api<unknown[]>('/approvals/inbox').then((r) => setPending(r.length)).catch(() => setPending(0));
  }, [session?.tenantId, path]);

  useEffect(() => setNavOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);
  useEffect(() => {
    if (!navOpen) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [navOpen]);

  if (loading || !session) return null;
  const tenant = session.memberships.find((m) => m.tenantId === session.tenantId);
  const canSwitch = session.memberships.length > 1 || (!!session.user.platformRole && session.memberships.length > 0);

  const visible = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) =>
      i.platform
        ? !!session.user.platformRole
        : !!session.tenantId && (!i.permission || can(i.permission)) && (!i.anyOf || i.anyOf.some((p) => can(p))) && (!i.module || hasModule(i.module)),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a href="#main" className="skip-link">{t('common.skipToContent')}</a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link href={session.tenantId ? '/dashboard' : '/platform/tenants'} className="side-brand">
          <span className="side-mark"><Icon name="cap" size={20} /></span>
          <span className="side-word">Edu<em>ERP</em></span>
        </Link>
        <nav aria-label="Main">
          {visible.map((g) => (
            <div key={g.section}>
              <div className="side-section">{t(g.section)}</div>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className={`side-link ${path.startsWith(i.href) ? 'active' : ''}`} aria-current={path.startsWith(i.href) ? 'page' : undefined}>
                  <Icon name={i.icon} />
                  {t(i.label)}
                  {i.href === '/approvals' && pending > 0 && <span className="side-count" aria-label={t('shell.waiting', { n: pending })}>{pending}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">{t('shell.privacy')}</div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <div>
        <header className="topbar">
          <div className="top-left">
            <button className="btn btn-ghost icon-btn menu-toggle" aria-label={t('shell.openMenu')} aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={20} />
            </button>
            <span className="tenant-name">{tenant?.name ?? t('shell.platformConsole')}</span>
            {campuses.length > 1 && (
              <select className="campus-select" aria-label={t('common.campus')} value={campusId ?? ''} onChange={(e) => setCampusId(e.target.value || null)}>
                <option value="">{t('shell.allMyCampuses')}</option>
                {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          <div className="top-right">
            {session.tenantId && <NotificationBell tenantId={session.tenantId} />}
            <div className="user-menu" ref={menuRef}>
              <button className="user-btn" aria-expanded={menuOpen} aria-controls="account-menu" onClick={() => setMenuOpen((v) => !v)}>
                <span className="avatar" aria-hidden>{initials(session.user.fullName)}</span>
                <span className="user-name">{session.user.fullName}</span>
                <Icon name="chevronDown" size={16} className="muted" />
              </button>
              {menuOpen && (
                <div className="dropdown" id="account-menu">
                  <div className="dropdown-head">
                    <strong>{session.user.fullName}</strong>
                    <span>{tenant?.name ?? (session.user.platformRole ? `Platform ${session.user.platformRole === 'SUPER_ADMIN' ? 'super admin' : 'support'}` : '')}</span>
                  </div>
                  <div className="lang-row">{t('common.language')}<LanguageSwitch /></div>
                  {canSwitch && (
                    <Link href="/select-institution" className="dropdown-item"><Icon name="swap" /> {t('shell.switchInstitution')}</Link>
                  )}
                  {session.user.platformRole && session.tenantId && (
                    <Link href="/platform/tenants" className="dropdown-item"><Icon name="building" /> {t('shell.platformConsole')}</Link>
                  )}
                  <button className="dropdown-item" onClick={logout}><Icon name="logout" /> {t('shell.signOut')}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" id="main" tabIndex={-1} key={path}>{children}</main>
      </div>
    </div>
  );
}
