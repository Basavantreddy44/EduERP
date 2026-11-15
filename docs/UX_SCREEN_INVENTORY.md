# Screen & Navigation Inventory

Baseline **[DOC §12]**. Added as a separate doc (not in the original list) to keep MODULE_SPECIFICATIONS readable. Detailed per-screen specs (title, breadcrumbs, filters, search, sort, pagination, columns, forms, validation messages, actions, status badges, approvals, empty/loading/error states, responsive behaviour) are written in each module spec pack.

## 1. Application shell

- **Top bar:** tenant name/logo · campus selector (only campuses in scope; "All campuses" if tenant-scoped) · academic-year selector · global search (Ctrl+K) · approvals inbox badge · notifications · help · profile menu (sessions, MFA, switch tenant, logout).
- **Sidebar:** grouped, collapsible, built from `/me/permissions` + entitlements. Remembers state per user.
- **Breadcrumbs** on every page. Page header with title, primary action and secondary actions menu.
- **Surfaces:** `(platform)` SaaS console · `(app)` institution back-office · `(portal)` parent/student/applicant responsive PWA (simplified nav, bottom tab bar on mobile).

## 2. Navigation tree (back-office)

```
Home (role dashboard) · My Approvals · My Tasks
Admissions ▸ Enquiries · Applications · Interviews · Offers · Waitlist · Admission Cycles · Forms
Students ▸ Directory · Student Profile · Guardians · Transfers · Withdrawals · Certificates · Promotion/Rollover
Academics ▸ Academic Years & Terms · Programmes & Levels · Courses/Subjects · Groups/Sections · Offerings & Faculty · Calendar
Timetable ▸ Builder · Published Timetables · Substitutions · Rooms · Bell Schedules
Learning ▸ Lesson Plans · Assignments · Rubrics
Attendance ▸ Today (live) · Registers · Missing Registers · Corrections · Leave Requests · Devices · Staff Attendance · Reports
Examinations ▸ Exams · Schedules · Registrations · Hall Tickets · Seating · Marks Entry · Verification · Results · Revaluation · Report Cards
Fees ▸ Collection Desk · Cashier Sessions · Invoices · Invoice Runs · Online Payments · Concessions · Refunds · Arrears · Fee Setup (Heads, Structures, Instalments, Late Fees)
Finance ▸ Journals · Ledgers · Payables (Vendors, Bills, Payments) · Bank & Reconciliation · Fixed Assets · Budgets · Period Close · Statements · Setup (COA, Fiscal Years, Posting Rules, Taxes)
HR ▸ Employees · Onboarding · Leave · Attendance · Exit · Setup
Payroll ▸ Payroll Runs · Payslips · Loans · Salary Structures · Statutory
Hostel ▸ Bed Map · Applications · Allotments · Check-in/out · Outpasses · Visitors · Incidents · Maintenance
Transport ▸ Live Map · Trips · Routes & Stops · Assignments · Vehicles · Drivers · Incidents
Library ▸ Circulation Desk · Catalogue · Members · Reservations · Overdues · Stock Verification
Inventory ▸ Items · Stock · Purchase Requests · Quotations · Purchase Orders · Goods Receipts · Transfers/Issues · Stock Counts
Communication ▸ Announcements · Messages · Templates · Delivery Status · Preferences & Consent · Emergency Broadcast
Documents ▸ Library · Templates · Verification Log
Reports & Analytics ▸ Dashboards · Reports · Exports · Insights (AI)
Compliance ▸ Audit Log · Access Reviews · Data Requests · Retention & Holds · Incidents · Export Log
Settings ▸ Institution · Legal Entities · Campuses · Departments · Users · Roles · Approval Policies · Numbering · Notifications · Integrations · Subscription
```

**SaaS console:** Tenants (list/detail/lifecycle) · Plans & Features · Subscriptions & Billing · Usage · Domains · Support Tickets · Support Access Grants · Platform Health · Offboarding queue.

**Parent/Student portal:** Home (child switcher, today's attendance, next class, dues, latest notice, bus status [DOC §12 F]) · Attendance · Timetable · Homework · Results · Fees & Pay · Receipts · Bus · Notices · Leave request · Profile & consent. **Applicant portal:** Apply · Upload documents · Pay application fee · Status · Offer accept.

## 3. Design system (built in Phase 0, `packages/ui`)

Tokens (colour, spacing, typography, radius, elevation; light/dark) · AppShell, Sidebar, TopBar, Breadcrumbs, PageHeader · **DataTable** (server pagination, sort, filters, column visibility, row selection, bulk actions, export, saved views, empty/loading/error states) · **Form** kit (RHF + Zod, field-level errors, dirty-state guard, submit lock, async select, date/date-range with institution TZ, money input with decimal string, file upload with progress) · StatusBadge (one mapping per state machine, colour + icon + text for accessibility) · ConfirmDialog / ReasonDialog (high-risk actions show impact + reason capture [DOC §12]) · ApprovalTimeline · AuditTimeline · Toasts · EmptyState · Skeletons · KPI card · Chart wrappers · MaskedValue (reveal with permission + audit) · Stepper/Wizard · Calendar/Timetable grid · Mark/attendance grid (keyboard-first).

UX acceptance checklist [DOC §12] applies to every screen: search/filter/sort/pagination, export only when authorised, field errors, unsaved-change warning, duplicate-submit prevention, impact + reason + approval on high-risk actions, small screens, poor networks, retry-safe, keyboard and screen-reader support, contrast, masked sensitive values.
