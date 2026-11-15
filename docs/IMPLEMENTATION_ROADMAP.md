# Implementation Roadmap

Aligned to **[DOC §24]** release priorities (MVP 0–5) and **[DOC §20]** phases. It resolves conflict D-05 by placing Finance before Exams. Durations are indicative, assume the DOC §23 team size, and will be re-estimated after discovery. With a smaller AI-assisted team, expect the timeline to stretch. Scope is never cut silently.

Each phase follows the master-prompt workflow: requirements → module spec pack → plan → backend → migrations → frontend → real API wiring → authz/validation → audit → tests → run → fix → verify → docs → completion report. **A phase is done only when its exit criteria pass on executed tests.**

## 1. Phases

| Phase | DOC release | Scope | Exit criteria (summary) |
|---|---|---|---|
| **P0 Foundation** (≈6–8 wks) | MVP 0 | Monorepo, CI, docker env, DB + RLS framework, identity/auth/MFA/OTP, tenancy context, RBAC/ABAC, audit, settings, numbering, approvals engine, outbox + jobs, files, notifications core (in-app + email), import/export framework, entitlements, SaaS console (tenant lifecycle, plans, subscriptions without billing provider), org (legal entities, campuses, depts), design system + app shell | Tenant isolation suite green; login → tenant → campus flow works end to end; approval engine demo with SoD; numbering concurrency test; audit chain verification |
| **P1 Student core** (≈6 wks) | MVP 1 | Academic structure (years, terms, programmes, levels, courses, groups, offerings, faculty), admissions CRM + applicant portal, SIS, guardians + verification, consent capture, documents | W-01 end to end incl. CS-04/CS-05; import of students/guardians |
| **P2 Daily academics** (≈5 wks) | MVP 1 | Rooms, bell schedules, timetable builder + conflicts + publish, substitutions, attendance (daily/period), unified leave, corrections, staff attendance (manual), parent alerts (in-app/email) | W-02, CS-06; attendance perf test |
| **P3 Finance core** (≈8 wks) | MVP 2 | COA, fiscal years/periods, posting service + rules, journals, fee setup, assignments, invoice runs, concessions, payment gateway adapter (1 provider), webhooks, cashier sessions, instruments, receipts, refunds, credit notes, AR ageing, bank statement import & reconciliation, TB/GL/P&L/BS | W-04, W-17, CS-08/09/14/15; finance owner sign-off |
| **P4 Academic outcomes** (≈7 wks) | MVP 3 | Learning/assignments, assessment schemes, grading, exams, eligibility, hall tickets, seating, marks, moderation, results versioning, publication, revaluation, report cards/transcripts, certificates + QR verify, **year rollover & promotion** | W-03, W-09, W-12, CS-07/16 |
| **P5 People** (≈7 wks) | MVP 4 | HR master, onboarding/exit, contracts, salary structures, payroll engine, statutory config, payslips, bank files, payroll posting, loans | W-05, W-13, CS-10; parallel payroll run |
| **P6 Campus ops** (≈6 wks) | MVP 4 | Hostel, transport (without live GPS), library, related fee charges | W-06, W-07 (non-GPS), W-14 |
| **P7 Supply chain** (≈6 wks) | MVP 4 | Items, suppliers, PR/RFQ/quotes/comparison/PO, GRN + QC, stock ledger, transfers/issues, stock counts, vendor bills (3-way), AP payments, TDS, fixed assets, budgets & commitments | W-08; GRNI & stock reconciliation |
| **P8 Experience** (≈8 wks) | MVP 5 | SMS/WhatsApp/push adapters, consent/preferences, emergency broadcast, parent/student PWA polish, Flutter apps (parent, teacher, driver, warden), GPS ingestion & live map, device integrations (biometric/RFID) | Mobile UAT; CS-11; delivery monitoring |
| **P9 Insight & compliance** (≈6 wks) | MVP 5 | Dashboards, governed metrics, standard reports, AI features with governance, DSR/retention/legal hold/incidents/access reviews, govt/board export adapters | Model governance; CS-12 |
| **P10 Go-live** (≈6 wks) | §20 M12 | Data migration rehearsals, pilot, pen-test + remediation, DR drill, load test, training, hypercare | Pre-production checklist [DOC §25] fully signed |

## 2. First implementation milestone: **M0.1 "Isolated Walking Skeleton"** (≈2 weeks, after approval)

**Goal:** prove the riskiest architecture (tenant isolation + auth + context propagation) end to end before any business module.

**Scope**
1. Monorepo scaffold (pnpm + Turborepo): `apps/api`, `apps/worker`, `apps/web`, `packages/{contracts,ui,domain-kit,eslint-config,tsconfig}`.
2. `docker-compose.yml`: Postgres 16, Redis, MinIO, Mailpit.
3. Prisma schema + migrations for: `tenants`, `legal_entities`, `campuses`, `users`, `user_tenants`, `user_campus_scopes`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, `login_history`, `audit_logs`, `outbox_events`, `idempotency_keys`. Includes **RLS policies, FORCE RLS, composite FKs, DB roles**.
4. NestJS platform: config, pino logging + correlation ID, Problem-Details error filter, Zod validation pipe, `withTenantTx`, `AuthGuard`, `TenantContextGuard`, `PermissionGuard` (RBAC + campus scope), `AuditService`, health endpoints, OpenAPI.
5. Endpoints: `/auth/login|refresh|logout|switch-tenant`, `/me`, `/me/memberships`, `/me/permissions`, `/campuses` (list/create/update), `/users` (list/invite), `/audit-logs` (list), platform `/platform/tenants` (create/list/activate/suspend).
6. Web: login, tenant picker, app shell (sidebar from permissions, campus selector), campuses list + create form (DataTable + Form kit v0), platform tenants list.
7. CI pipeline: lint, typecheck, unit, integration (Testcontainers), security suite, build.
8. Docs: ADR-001…005, DATA_DICTIONARY entries for the above tables, DEVELOPMENT_STATUS updated.

**Acceptance criteria (all executed)**
- AC1 Tenant isolation suite (TEST_STRATEGY §3 items 1–5, 7–8) passes for `campuses`, `users`, `audit_logs`.
- AC2 Without `app.tenant_id`, the runtime role reads 0 rows from every tenant table.
- AC3 A user with memberships in two tenants gets distinct tokens; switching tenant changes visible data; a revoked membership blocks within token TTL; refresh-token reuse revokes the family.
- AC4 Campus-scoped user cannot read or modify an unassigned campus (404).
- AC5 Every mutating request writes an audit row in the same transaction (verified by forced-failure rollback test).
- AC6 Every route has a permission decorator or `@Public()` (static test).
- AC7 Suspended tenant → API returns the configured read-only behaviour.
- AC8 Web E2E: login → choose tenant → create campus → see it in the list; a user without `org.campus.create` does not see the button **and** gets 403 from the API.

**Status:** ✅ complete 2026-11-14 (see DEVELOPMENT_STATUS).

## 2a. Rest of P0, split into M0.2 → M0.4

| Milestone | Scope |
|---|---|
| **M0.2 Platform services** | Settings registry (campus override), numbering service, transactional outbox + pg-boss worker, files (storage driver, local disk), notifications core (templates en/kn, in-app inbox, email via SMTP, preferences, delivery log), approvals engine (multi-level, role approvers, SoD) |
| **M0.3 Onboarding & SaaS** | Entitlements (plans, plan modules, subscriptions, module guard + menu), departments, academic years, holidays, invite + password-reset emails, Users screen, design-system refresh of every screen |
| **M0.3b Data in/out** | Import/export framework (upload → validate → dry run → commit), idempotency keys |
| **M0.4 Experience** | Kannada screens (i18n with per-person language), data table with sorting and paging, accessibility pass (WCAG 2.1 AA, automated) |

### M0.2 acceptance criteria (all executed)
- **AC9 Settings:** the effective value resolves campus → institution → registry default; unknown keys and invalid values are rejected (422); changes are audited; tenant-isolated.
- **AC10 Numbering:** 50 concurrent allocations give 50 distinct consecutive numbers; a rolled-back business transaction does not consume a number (gapless).
- **AC11 Outbox:** an event is stored in the same transaction as the change (rollback → no event); the worker delivers it; a duplicate delivery has no extra effect; a failing handler is retried with backoff and then parked as failed.
- **AC12 Files:** upload within type/size limits, others rejected; download only inside the same institution and with permission (other tenant → 404); storage keys never contain the uploaded file name.
- **AC13 Notifications:** an event creates an in-app notification and an email (received by Mailpit) in the recipient's language; opt-out is respected except for mandatory events; each delivery's status is recorded.
- **AC15 Academic setup (M0.3):** academic years (no overlaps, exactly one current, current can't be closed), departments (unique code per campus, institution-wide allowed), holidays (one per date per campus, date-range filter); tenant-isolated; read-only roles cannot change them.
- **AC16 Account emails (M0.3):** invite → email with a set-password link → password set → sign in; links are one-time and expire; only the token hash is stored; forgot-password answers the same for unknown emails; a reset ends every session.
- **AC17 Plans & modules (M0.3):** new institutions start with every module; assigning a plan switches modules to the plan (core always on) and keeps platform add-ons; institutions cannot change their own modules (API and RLS); a route of a switched-off module is refused with 403.
- **AC18 Import/export (M0.3b):** Excel template with this institution's codes; .xlsx and .csv uploads are checked row by row and nothing is saved until commit; an error report lists the rows to fix; commit imports once (second commit 409), re-checks data changed since upload, and is audited; permission, campus scope and tenant isolation apply; an export can be edited and re-imported; CSV exports neutralise spreadsheet formulas.
- **AC19 Idempotency keys (M0.3b):** a retry with the same key returns the first response and creates nothing new; same key + different body → 422; failed attempts are not remembered; concurrent duplicates create one record; keys are per institution.
- **AC20 Language (M0.4):** every staff screen of the institution app, sign-in and password pages switch between English and Kannada; the choice made on a device is saved to the person's account (and sets their email language); the account language is used on new devices; dates use Kannada month/day names; Kannada typography is correct.
- **AC21 Data table (M0.4):** sortable columns (accessible `aria-sort`), paging with page size, "Showing x–y of n", used on Users and Departments.
- **AC22 Accessibility (M0.4):** axe-core WCAG 2.1 A/AA scan of sign-in, forgot-password, all institution screens, an open dialog and the account menu reports **zero violations** in English and in Kannada; skip-to-content link; labelled fields; menu semantics.
- **AC14 Approvals:** a 2-level rule routes level 1 → level 2; the requester cannot approve their own request (SoD); only the configured role can act; reject ends the request; completion writes an outbox event; every action is audited.

## 2b. B1 Phase 1 — Admissions & Students (approved 2026-11-14)

Built on the Phase 0 foundation (numbering, approvals, files, outbox, imports, i18n). Design: docs/tables/B1_core.md §5, §7, §8; workflows W-01, I-1, G-16.

| Milestone | Scope | Out of scope (later) |
|---|---|---|
| **M1.1 Class structure** | Boards; programmes (School / PU / UG / PG) with levels generated in promotion order (Class 1–10, I–II PUC, Semester 1–6); sections per academic year with capacity; screens | Subjects & syllabus (B2 Academics), class teachers (needs Staff) |
| **M1.2 Admissions** | Enquiries + follow-ups (CRM); applications entered by staff with documents; duplicate check (same parent phone + date of birth, similar name); decisions approve / reject (with reason) / waitlist; seats per section; **enrol in one transaction** → student + admission number + guardians + enrolment | Online applicant portal with OTP and application fee (needs payments, B1 Fees), configurable form builder |
| **M1.3 Students & parents** | Student list with fast search and filters, profile (details, guardians, documents, enrolment, status history), edit, status changes with history, section change within the year, student import/export, guardian sharing between siblings | Parent/student login portal (B3), promotion/rollover and TC (M1.4) |
| M1.4 Lifecycle | Year-end promotion wizard (dry run → commit, exceptions), withdrawal & Transfer Certificate with no-dues | Needs Fees (no-dues) — scheduled after Fees |

### Acceptance criteria
- **AC23 Class structure (M1.1):** creating a programme generates its levels in promotion order with the last one final; codes unique per campus; sections are per academic year and level with a unique name and capacity ≥ 1; no sections in a closed year; campus scope and tenant isolation apply.
- **AC24 Enquiries (M1.2):** enquiry numbers come from the numbering service; follow-ups update status and next follow-up date; "due today" list; conversion to an application keeps the link.
- **AC25 Applications (M1.2):** application numbers are gapless; duplicate check flags same parent phone + date of birth (and same phone + similar name) before submit, and staff can proceed only with a reason; documents attach via Files; Aadhaar is never stored in full (last 4 only).
- **AC26 Decisions (M1.2):** only holders of the decide permission act; reject needs a reason; every decision is audited; the decided application cannot be edited.
- **AC27 Enrolment (M1.2):** one transaction creates the student, allocates the admission number, creates or re-uses guardians (matched by phone), enrols into a section with a free seat, marks the application ENROLLED and writes an outbox event; a failure at any step leaves nothing behind (forced-failure test); a full section is refused; a second enrolment of the same application is refused.
- **AC28 Students (M1.3):** list/search by name, admission number or parent phone with campus/class/section/status filters; **search and first page return in < 300 ms with 20,000 students** (measured); status changes keep history; section change keeps one active enrolment; siblings share guardians; import/export round-trip; campus scope and isolation.

## 2c. B1 Phase 2 — Fees & basic accounts (approved 2026-11-15; gateway: Razorpay; complete 2026-11-15)

Built on Phase 0 (numbering, approvals, outbox, files, imports, notifications) and Phase 1 (students, classes). Design: docs/tables/B1_core.md §10–§11; workflows W-04, W-17. Money is stored as NUMERIC(14,2) and calculated in paise (no floating point). Every collection and reversal posts a balanced journal entry.

| Milestone | Scope | Out of scope (later) |
|---|---|---|
| **M2.1 Fee setup** | Financial years (Apr–Mar); starter chart of accounts per institution (Cash, Bank, Gateway clearing, Student receivable, Fee income by type, Refunds, Fines); fee heads linked to an income account; fee structures per campus / year / class (optional category such as management quota) with instalments and due dates; copy last year's structure; late-fee rules (fixed / per day / percent, grace days, cap) | Full accounting screens (B4), GST computation (DEC-14: flag only) |
| **M2.2 Assign & bill** | Structure assigned automatically on enrolment / import and in bulk for a class; extra one-off charges; concessions (sibling, merit, staff child, scholarship, management) through the approvals engine; invoice run per instalment with gapless numbers and posting Dr Receivable / Cr Fee income; student fee account on the profile (billed, concession, paid, balance) | Hostel / transport charges (B-campus ops) |
| **M2.3 Counter collection** | Cashier session open → collect → close with counted cash and difference; modes cash, cheque, DD, UPI / card (reference), bank transfer; partial payment, allocation oldest-due first (editable); receipt numbers gapless, receipt only for successful money; printable receipt (English / Kannada); cancel receipt (reason, reversal entry) and cheque bounce (reopens the dues, optional bounce fine); idempotent "Collect" (double click cannot charge twice) | Bank statement reconciliation (P3 later) |
| **M2.4 Online payment** | Payment-gateway adapter (provider per DEC-09) with test mode: order → checkout page reachable by a secure link sent to the parent → signature-verified, idempotent webhook → receipt only after confirmed capture; pending payments checked again automatically; refunds with approval (full / partial) and reversal posting | Parent portal (B3) — the link page is the interim way to pay |
| **M2.5 Dues & reports** | Dues / defaulter list by class with ageing; late fee applied on schedule; reminders by email through the notification engine (SMS when DEC-09 provider is chosen); daily collection report by mode and cashier; fee register; **no-dues check** used by TC in M1.4 | Advanced finance reports (TB / P&L / BS in B4) |

### Acceptance criteria
- **AC29 Fee setup (M2.1):** structures are per campus / year / class with instalments whose total equals the sum of items; an active structure with invoices cannot change amounts (new version instead); fee heads post to an income account; amounts never negative; campus scope and isolation.
- **AC30 Billing (M2.2):** enrolment assigns the matching structure; invoice runs are gapless and idempotent (running twice bills nobody twice); concessions apply only after approval and never exceed the amount; every invoice posts a balanced entry.
- **AC31 Counter (M2.3):** a payment allocates to dues and updates balances in one transaction; receipts are gapless and only for successful payments; a double-submitted payment is recorded once; cancel / bounce reverse the entry and reopen dues; a cashier session closes with the computed difference; all actions audited.
- **AC32 Online (M2.4):** webhooks with a bad signature are rejected and logged; a repeated webhook does not create a second receipt; a payment shows as paid only after confirmed capture; refunds need approval and post a reversal.
- **AC33 Dues (M2.5):** dues and ageing match invoices minus payments to the paisa; late fee follows the rule and its cap; the no-dues check is correct for paid / partly paid / waived students; reports match postings.

## 3. Parallelisation guidance
After P0, P1/P2 (academic track) and the P3 setup work (COA, posting engine) can proceed in parallel with separate owners. P5/P6/P7 are largely independent once P3's posting service is stable.
