# Changelog

## [Unreleased] — 2026-11-15 (M2.5 Dues & reports — Fees phase complete)
### Added
- Dues list with how long amounts are overdue, filters, export, and email reminders (with a payment link).
- Late fees applied automatically every day from the late-fee rules; waive with a reason.
- Fee reports: daily collection by mode and cashier, collection by fee head, dues by class — each checked against the accounts.
- "No dues" check for a student (used by the Transfer Certificate next).

## [Unreleased] — 2026-11-15 (M2.4 Online payment)
### Added
- Payment links: parents pay online (UPI, cards, net banking) from a secure link — by email or WhatsApp; a receipt only after the payment is confirmed.
- Razorpay connection (test mode until go-live) with verified checkout, webhook and an automatic re-check; a simulated gateway for development.
- Refunds with approval: online refunds go back through the payment gateway.
### Fixed
- The permissions list is returned in a fixed order.

## [Unreleased] — 2026-11-15 (M2.3 Counter collection)
### Added
- Collect fees at the counter: cash, cheque, DD, UPI, card, bank transfer; part payments; printable receipts with the amount in words.
- Cash counter per cashier: open with opening cash, close with counted cash and the difference.
- Cancel a receipt or record a bounced cheque (with an optional bounce charge); the bills become due again.
- Receipts on the student's Fees tab; every receipt recorded in the accounts.

## [Unreleased] — 2026-11-15 (M2.2 Assign & bill)
### Added
- Students get their class's fee plan automatically; fee-group plans per student.
- Billing page: preview and create the bills of an instalment for everyone, safe to repeat.
- Concessions (percent or fixed amount) decided through Approvals; approval also reduces unpaid bills.
- Extra one-off charges; cancelling an unpaid bill.
- Student profile → Fees tab with bills, concessions and balance.
- Double-entry journal: every bill is recorded in the accounts; entries are balanced and can only be reversed.
### Changed
- Student search is faster on large schools.
- "Unpaid"/warning labels and faded table rows have stronger contrast.

## [Unreleased] — 2026-11-15 (M2.1 Fee setup)
### Added
- Fee heads (each recorded in an account), a starter chart of accounts per institution, financial years.
- Fee structures per class and year (optional fee group) with instalments; draft → active → closed; revise and copy to the next year.
- Late-fee rules (once, per day or percent; grace days; maximum).
- "Fee setup" screens with a fee grid and live totals, in English and Kannada.

## [Unreleased] — 2026-11-15 (M1.3 Students & parents)
### Added
- Student list with instant search (name, admission number, parent mobile) and class / section / status filters; fast with 20,000 students.
- Student profile: details, parents (shared between brothers and sisters), class history, status history, documents.
- Edit details, change status (inactive / discontinued / re-join) with permanent history, change section within the class.
- Student import from Excel and export with the same columns.
### Changed
- Admissions enrolment now writes the first status-history entry. Documents list shared between Applications and Students.

## [Unreleased] — 2026-11-15 (M1.2 Admissions)
### Added
- Enquiries with follow-ups and a due/overdue list; applications with duplicate check, documents, decisions and withdrawal; enrolment into a section with free seats (creates the student, admission number and parents). Screens in English and Kannada.
- Student, guardian and enrolment tables (foundation for M1.3).
- Tests AC24–AC27 (18 tests). OpenAPI now 79 paths.

## [Unreleased] — 2026-11-14 (M1.1 Class structure)
### Added
- Boards, programmes with generated classes, sections per academic year (API + "Classes & sections" screen, en/kn).
- Plan for B1 Phase 1 (M1.1–M1.4, AC23–AC28) in IMPLEMENTATION_ROADMAP §2b. Test AC23 (6 tests).

## [Unreleased] — 2026-11-14 (M0.4 Experience — Phase 0 complete)
### Added
- English/Kannada screens with a language switch (sign-in, password pages, account menu); language saved per person (`PATCH /me/preferences`).
- DataTable component (sorting, paging) on Users and Departments.
- Accessibility: skip link, labelled settings fields, menu semantics; tests AC20 (browser + API).
### Changed
- Colour tokens adjusted for WCAG AA contrast (muted text, gold ink, faded rows).

## [Unreleased] — 2026-11-14 (M0.3b Data in/out)
### Added
- Import framework with Departments, Holidays and Users importers; Excel templates with Help sheet; row-level review; error report; one-transaction commit.
- Exports (xlsx/csv) for Campuses, Departments, Holidays, Users.
- Idempotency keys (API interceptor + web create forms).
- "Import data" page and Export buttons. Tests AC18–AC19 (13 tests).
### Changed
- DATABASE_URL now sets `connection_limit=15` (update your .env from .env.example).
- Clearer browser messages when the server is busy or unreachable.

## [Unreleased] — 2026-11-14 (M0.3 Onboarding & SaaS)
### Added
- Academic years, departments, holidays (API + screens).
- Invite and password-reset emails with one-time links; Forgot-password and Set-password pages.
- Plans, subscriptions and per-institution modules (32-module catalogue); module guard; platform Plans page and institution Manage panel.
- Users & access screen (invite, roles, remove access); roles endpoint.
- Design system across the app: shell with icons and slide-in phone menu, dashboard with setup checklist, shared components, toasts.
- Tests AC15–AC17 (11 tests); decisions CD-17, CD-18.
### Fixed
- DB transaction maxWait raised to 10 s (bursts no longer fail); phone-width overflow; sign-in/forgot forms safe before hydration.

## [Unreleased] — 2026-11-14 (M0.2 Platform services)
### Added
- Migration `m02_platform_services` (11 tables, RLS, SoD trigger, partial unique index for open approvals).
- Settings registry, numbering service, transactional outbox, background worker (pg-boss) with retries and dead letter, files with local storage driver, notifications core (in-app + email, en/kn templates, preferences, delivery log), approvals engine.
- `@TenantMember()` access rule; 7 permissions; seed syncs new permissions into existing institutions' system roles and loads default templates.
- Web: notification bell, Approvals page, Settings page.
- Tests for AC9–AC14 (35 new tests); ADR-006; decisions CD-14…CD-16.
### Changed
- `migrate:new` uses `prisma migrate diff` (shadow DB cannot replay hand-written grants).
- Mailpit is a standard local service; `db:seed` also runs `jobs:setup`; CI runs Mailpit.

## [Unreleased] — 2026-11-14 (M0.1 complete)
### Added
- `apps/e2e`: Playwright AC8 end-to-end test (institution picker, campus create, viewer 403).
- OpenAPI 3 document generated from routes + shared Zod schemas + access rules; Swagger UI at `/api/docs` (non-production); `docs/api/openapi.json`; CI checks it is up to date.
- Favicon.
### Changed
- Login page redesigned (navy & gold split layout, feature list with icons, floating labels, show/hide password, Caps Lock warning).

## [Unreleased] — 2026-11-13 (M0.1)
### Added
- Monorepo (pnpm + Turborepo), docker-compose (Postgres 16 + Redis), `.env.example`, git repository.
- `packages/db`: Prisma schema + first migration (11 platform tables) with RLS, composite tenant FKs, CHECKs, append-only audit; seed for permissions and platform admin.
- `packages/shared`: permission catalogue, system roles, Zod schemas.
- `apps/api` (NestJS 11): auth with rotating refresh tokens, tenant context, AccessGuard, campuses, users, audit log, platform tenants, health.
- `apps/web` (Next.js 15): login, institution picker, permission-driven shell, campuses, platform institutions.
- Integration test suites for AC1–AC7; GitHub Actions CI.
- ADR-001…005; decisions CD-06…CD-13.
### Changed
- B1 table doc: users.platform_role, users.locked_until, refresh_tokens.family_id/replaced_by, login_history.identifier, audit_logs.request_id; user_type no longer has PLATFORM.

## [Unreleased] — 2026-11-13
### Added (requirements finalised)
- `docs/REQUIREMENTS_DISCUSSION.md`: agreed v1 scope (32 modules, SaaS, school + PU + CBCS, English + Kannada, Razorpay, full accounting, single launch).
- `docs/BASIC_PHASE_DESIGN.md` rewritten as the architecture + design overview.
- `docs/tables/B1…B6`: complete table structures (237 tables) in build order.

### Added (initial blueprint)
- Initial project blueprint from `School_College_ERP_Complete_Project_Documentation.pdf` v1.0 and the master project prompt: requirements analysis, gap analysis (G-01…G-32), document defects (D-01…D-08), module/submodule breakdown, dependency matrix, workflow catalogue, architecture, database plan, API plan, role/permission matrix, screen inventory, security/privacy assessment, test strategy, roadmap, risk/assumption register, decision log.
- No application code, migrations or source files created (analysis phase).
