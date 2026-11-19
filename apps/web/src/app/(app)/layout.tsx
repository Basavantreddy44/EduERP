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
      { href: '/certificates', label: 'nav.certificates', icon: 'file', permission: PERMISSIONS.CERT_READ, module: 'STUDENTS' },
    ],
  },
  {
    section: 'nav.attendance',
    items: [
      { href: '/attendance', label: 'nav.takeAttendance', icon: 'check', permission: PERMISSIONS.ATT_MARK, module: 'ATTENDANCE' },
      { href: '/attendance/day', label: 'nav.attendanceDay', icon: 'calendar', permission: PERMISSIONS.ATT_READ, module: 'ATTENDANCE' },
      { href: '/attendance/reports', label: 'nav.attReports', icon: 'layers', permission: PERMISSIONS.ATT_READ, module: 'ATTENDANCE' },
      { href: '/attendance/corrections', label: 'nav.attCorrections', icon: 'swap', permission: PERMISSIONS.ATT_READ, module: 'ATTENDANCE' },
      { href: '/staff-attendance', label: 'nav.staffAttendance', icon: 'users', permission: PERMISSIONS.STAFF_ATT_MARK, module: 'ATTENDANCE' },
      { href: '/leave', label: 'nav.leave', icon: 'calendar', module: 'ATTENDANCE', anyOf: [PERMISSIONS.LEAVE_SELF, PERMISSIONS.LEAVE_READ, PERMISSIONS.LEAVE_STUDENT, PERMISSIONS.LEAVE_STAFF] },
      { href: '/attendance/periods', label: 'nav.bellTimings', icon: 'clock', permission: PERMISSIONS.ATT_SETUP, module: 'ATTENDANCE' },
    ],
  },
  {
    section: 'nav.academics',
    items: [
      { href: '/academics/my-week', label: 'nav.myWeek', icon: 'clock', module: 'ACADEMICS', anyOf: [PERMISSIONS.ACAD_TEACH] },
      { href: '/academics/homework', label: 'nav.homework', icon: 'book', module: 'ACADEMICS', anyOf: [PERMISSIONS.ACAD_READ, PERMISSIONS.ACAD_TEACH] },
      { href: '/academics/timetable', label: 'nav.timetable', icon: 'grid', permission: PERMISSIONS.ACAD_READ, module: 'ACADEMICS' },
      { href: '/academics/substitutions', label: 'nav.substitutions', icon: 'swap', permission: PERMISSIONS.ACAD_READ, module: 'ACADEMICS' },
      { href: '/academics/lessons', label: 'nav.lessons', icon: 'clipboard', module: 'ACADEMICS', anyOf: [PERMISSIONS.ACAD_READ, PERMISSIONS.ACAD_TEACH] },
      { href: '/academics/materials', label: 'nav.materials', icon: 'book', module: 'ACADEMICS', anyOf: [PERMISSIONS.ACAD_READ, PERMISSIONS.ACAD_TEACH] },
      { href: '/academics/subjects', label: 'nav.subjects', icon: 'layers', permission: PERMISSIONS.ACAD_READ, module: 'ACADEMICS' },
    ],
  },
  {
    section: 'nav.exams',
    items: [
      { href: '/exams/marks', label: 'nav.markEntry', icon: 'edit', module: 'EXAMS', anyOf: [PERMISSIONS.EXAM_MARKS, PERMISSIONS.EXAM_VERIFY, PERMISSIONS.EXAM_SETUP] },
      { href: '/exams/results', label: 'nav.results', icon: 'star', permission: PERMISSIONS.EXAM_READ, module: 'EXAMS' },
      { href: '/exams', label: 'nav.examsList', icon: 'calendar', permission: PERMISSIONS.EXAM_READ, module: 'EXAMS' },
    ],
  },
  {
    section: 'nav.engagement',
    items: [
      { href: '/news', label: 'nav.news', icon: 'mail', permission: PERMISSIONS.FEED_READ, module: 'NEWS_FEED' },
      { href: '/events', label: 'nav.events', icon: 'calendar', permission: PERMISSIONS.EVENT_READ, module: 'EVENTS' },
      { href: '/ptm', label: 'nav.ptm', icon: 'users', module: 'MEETINGS', anyOf: [PERMISSIONS.PTM_MANAGE, PERMISSIONS.PTM_TEACH] },
      { href: '/meetings', label: 'nav.meetings', icon: 'clipboard', permission: PERMISSIONS.MEETING_ATTEND, module: 'MEETINGS' },
      { href: '/complaints', label: 'nav.complaints', icon: 'shield', module: 'GRIEVANCE', anyOf: [PERMISSIONS.GRIEVANCE_RAISE, PERMISSIONS.GRIEVANCE_HANDLE, PERMISSIONS.GRIEVANCE_MANAGE] },
    ],
  },
  {
    section: 'nav.operations',
    items: [
      { href: '/front-office', label: 'nav.frontOffice', icon: 'building', permission: PERMISSIONS.FRONT_DESK, module: 'FRONT_OFFICE' },
      { href: '/requests', label: 'nav.requests', icon: 'layers', module: 'DEPT_REQUESTS', anyOf: [PERMISSIONS.DEPT_REQ_RAISE, PERMISSIONS.DEPT_REQ_HANDLE, PERMISSIONS.DEPT_REQ_SETUP] },
    ],
  },
  {
    section: 'nav.people',
    items: [
      { href: '/staff', label: 'nav.staff', icon: 'users', permission: PERMISSIONS.HR_STAFF_READ },
    ],
  },
  {
    section: 'nav.hr',
    items: [
      { href: '/hr/my-profile', label: 'nav.hrMine', icon: 'clipboard', module: 'HR_PAYROLL' },
      { href: '/hr/leave-balances', label: 'nav.hrLeave', icon: 'calendar', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.HR_PROFILE_READ, PERMISSIONS.HR_SETUP] },
      { href: '/hr/exits', label: 'nav.hrExits', icon: 'logout', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.HR_EXIT, PERMISSIONS.HR_CLEARANCE, PERMISSIONS.ACC_ENTRY, PERMISSIONS.HOSTEL_MANAGE] },
      { href: '/hr/setup', label: 'nav.hrSetup', icon: 'settings', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.HR_SETUP, PERMISSIONS.HR_PROFILE_READ] },
    ],
  },
  {
    section: 'nav.payroll',
    items: [
      { href: '/payroll/my-payslips', label: 'nav.payMine', icon: 'receipt', module: 'HR_PAYROLL' },
      { href: '/payroll/runs', label: 'nav.payRuns', icon: 'rupee', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_PAY, PERMISSIONS.PAYROLL_REPORTS] },
      { href: '/payroll/salaries', label: 'nav.paySalaries', icon: 'users', module: 'HR_PAYROLL', permission: PERMISSIONS.PAYROLL_SALARY_READ },
      { href: '/payroll/loans', label: 'nav.payLoans', icon: 'layers', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.PAYROLL_LOAN] },
      { href: '/payroll/setup', label: 'nav.paySetup', icon: 'settings', module: 'HR_PAYROLL', anyOf: [PERMISSIONS.PAYROLL_SETUP, PERMISSIONS.PAYROLL_SALARY_READ] },
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
    section: 'nav.accounts',
    items: [
      { href: '/accounts/bills', label: 'nav.accBills', icon: 'receipt', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
      { href: '/accounts/payments', label: 'nav.accPayments', icon: 'rupee', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
      { href: '/accounts/vouchers', label: 'nav.accVouchers', icon: 'book', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
      { href: '/accounts/vendors', label: 'nav.accVendors', icon: 'users', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
      { href: '/accounts/bank', label: 'nav.accBank', icon: 'building', permission: PERMISSIONS.ACC_BANK, module: 'ACCOUNTS' },
      { href: '/accounts/reports', label: 'nav.accReports', icon: 'layers', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
      { href: '/accounts/setup', label: 'nav.accSetup', icon: 'settings', permission: PERMISSIONS.ACC_READ, module: 'ACCOUNTS' },
    ],
  },
  {
    section: 'nav.transport',
    items: [
      { href: '/transport', label: 'nav.buses', icon: 'bus', permission: PERMISSIONS.TRANSPORT_READ, module: 'TRANSPORT' },
      { href: '/transport/routes', label: 'nav.routes', icon: 'route', permission: PERMISSIONS.TRANSPORT_READ, module: 'TRANSPORT' },
    ],
  },
  {
    section: 'nav.hostel',
    items: [
      { href: '/hostel', label: 'nav.hostels', icon: 'building', permission: PERMISSIONS.HOSTEL_READ, module: 'HOSTEL' },
      { href: '/hostel/mess', label: 'nav.mess', icon: 'clipboard', permission: PERMISSIONS.HOSTEL_READ, module: 'HOSTEL' },
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
  const { loading, session, can, hasModule, logout, campusId, setCampusId, permissions, portal } = useSession();
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
    // Parents and students (no staff role) use their own app.
    else if (session.tenantId && !permissions.length && portal?.hasPortal) router.replace('/portal');
  }, [loading, session, isPlatformPath, router, permissions, portal]);

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
  // The menu item for this page: the longest link that matches (so /attendance/day is not also "Take attendance").
  const activeHref = visible.flatMap((g) => g.items.map((i) => i.href)).filter((h) => path === h || path.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];

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
                <Link key={i.href} href={i.href} className={`side-link ${i.href === activeHref ? 'active' : ''}`} aria-current={i.href === activeHref ? 'page' : undefined}>
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
              <button className="user-btn" aria-label={session.user.fullName} aria-expanded={menuOpen} aria-controls="account-menu" onClick={() => setMenuOpen((v) => !v)}>
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
