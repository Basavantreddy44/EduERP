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
| **M1.4 Lifecycle** | Year-end promotion wizard (check → confirm; next class, same section name or chosen; final class passes out; chosen students stay back; seat check), Transfer Certificate only with no dues (numbered, printable; student marked transferred, class place closed, future fees and payment links stopped) | Withdrawal without a TC is the M1.3 "Dropped" status; cancelling an issued TC (later, with approval) |

### Acceptance criteria
- **AC23 Class structure (M1.1):** creating a programme generates its levels in promotion order with the last one final; codes unique per campus; sections are per academic year and level with a unique name and capacity ≥ 1; no sections in a closed year; campus scope and tenant isolation apply.
- **AC24 Enquiries (M1.2):** enquiry numbers come from the numbering service; follow-ups update status and next follow-up date; "due today" list; conversion to an application keeps the link.
- **AC25 Applications (M1.2):** application numbers are gapless; duplicate check flags same parent phone + date of birth (and same phone + similar name) before submit, and staff can proceed only with a reason; documents attach via Files; Aadhaar is never stored in full (last 4 only).
- **AC26 Decisions (M1.2):** only holders of the decide permission act; reject needs a reason; every decision is audited; the decided application cannot be edited.
- **AC27 Enrolment (M1.2):** one transaction creates the student, allocates the admission number, creates or re-uses guardians (matched by phone), enrols into a section with a free seat, marks the application ENROLLED and writes an outbox event; a failure at any step leaves nothing behind (forced-failure test); a full section is refused; a second enrolment of the same application is refused.
- **AC28 Students (M1.3):** list/search by name, admission number or parent phone with campus/class/section/status filters; **search and first page return in < 300 ms with 20,000 students** (measured); status changes keep history; section change keeps one active enrolment; siblings share guardians; import/export round-trip; campus scope and isolation.
- **AC34 Promotion (M1.4):** the check changes nothing and lists missing sections and too few seats (counting everyone arriving in a section); confirming is refused while problems remain; each class moves to the next level (same section name or a chosen one), the final class passes out, chosen students stay back; fees for the new year are assigned; students already placed are skipped and a repeat run changes nothing; the promotion log cannot be edited; permission and campus scope apply.
- **AC35 Transfer Certificate (M1.4):** refused while any fee is due or a refund is pending; numbered from the numbering service; the student becomes TRANSFERRED (a passed-out student stays PASSED_OUT), the current class place is closed (a later-year place never started is cancelled), future fees and payment links stop; "class last studied" is the last class actually attended; one TC per student; TCs cannot be deleted; tenant isolation.

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

## 2d. B1 Phase 3 — Staff, Attendance & Leave (approved 2026-11-16; complete 2026-11-17)

Design: docs/tables/B1_core.md §6 (staff, basic) and §9 (attendance & leave). Attendance is **daily by default**; a campus can switch to **period-wise** in settings (owner decision 2026-11-16). Absent alerts go in-app and by email until an SMS / WhatsApp provider is chosen (DEC-09).

| Milestone | Scope | Not in scope |
|---|---|---|
| **M3.1 Staff (basic)** | Staff list (teaching / non-teaching / contract / visiting): employee code, campus, department, contact, joining date, status; link to a login; Excel import / export; screens | Designations, contracts, salary, payroll (B4) |
| **M3.2 Bell timings & student attendance** | Periods per campus; attendance mode per campus (daily / period-wise); mark a section (all Present by default, change only exceptions); submit locks it; holidays and Sundays refused; one record per student per session | Subject-wise attendance tied to the timetable (B2) |
| **M3.3 Corrections & parent alerts** | Change a submitted record with a reason through the approvals engine; history kept; absent alert to the main contact (in-app + email) once per student per day | SMS / WhatsApp (DEC-09) |
| **M3.4 Leave & staff attendance** | Leave types (student / staff, days per year); leave requests with approval; approved leave shows as LEAVE on sheets; staff daily attendance by the office | Leave encashment, payroll effect (B4) |
| **M3.5 Attendance reports** | Monthly class register, student attendance %, below-threshold list, staff summary; Excel export | Dashboards (later in B1) |

### Acceptance criteria
- **AC36 Staff (M3.1):** employee code unique per institution; campus scope; a login can be linked to one staff record only; import / export round-trip; isolation.
- **AC37 Attendance (M3.2):** one session per section, date and period; one record per student; only enrolled, active students on the sheet; no attendance on holidays / future dates; submitted sheets are locked; marking a 60-student section is a single request.
- **AC38 Corrections & alerts (M3.3):** a locked record changes only through an approved correction (history kept); one absent alert per student per day, only to the main contact.
- **AC39 Leave & staff attendance (M3.4):** overlapping leave refused; approved leave marks LEAVE on later sheets; balance never negative when a yearly limit is set; one staff record per day.
- **AC40 Reports (M3.5):** percentages and counts match the records exactly; export matches the screen.

## 2e. B1 Phase 4 — Dashboards (approved 2026-11-17; complete 2026-11-17)

Every figure on a dashboard is computed live from the records already kept (attendance sheets, staff attendance, leave, receipts, invoices, enquiries, applications, approvals). Nothing is stored separately, so a dashboard can never disagree with the report behind it. Each block appears only for users whose role can open that report, and only for the campuses they can see.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M4.1 Dashboard figures (API)** | One call for the home screen, per campus or all campuses the user can see: **today's attendance** (classes marked / not marked, present %, absentees, holiday notice), **staff today** (present, on leave, not marked), **fees** (collected today and this month by mode, total outstanding, students overdue), **admissions** (open enquiries, follow-ups due / overdue, applications by status, enrolled this year), **waiting for me** (approvals). Blocks are left out when the user lacks the permission or the module is off | Governed metric layer, report builder, scheduled reports (P9) |
| **M4.2 Home screens** | Role-aware home: principal / admin see all blocks; office, accounts and teachers see their own; "Needs attention" list that links straight to the work (classes not marked, staff not marked, overdue follow-ups, approvals); campus picker for multi-campus users; setup checklist kept for admins until done | Custom / drag-and-drop dashboards |
| **M4.3 Trends** | Fee collection per day for the last 30 days, attendance % per working day for the last 4 weeks, admissions by stage for the current year; each chart has a table view and links to its full report | AI forecasts and insights (P9) |

### Acceptance criteria
- **AC41 Figures (M4.1):** every number equals the matching report for the same campus and date (attendance day view, staff sheet, collection report, dues list, admissions lists); campus scope and permissions respected; tenant isolation.
- **AC42 Home screens (M4.2):** each role sees only its blocks; every "needs attention" item opens the screen where it is fixed; phone layout; English and Kannada; no accessibility violations.
- **AC43 Trends (M4.3):** chart values equal the daily figures; holidays and Sundays are left out of attendance trends; each chart readable without colour (table view).

## 2f. B1 Phase 5 — Parent & student app (PWA) (started 2026-11-17 under the owner's "continue with all phases"; complete 2026-11-17)

Design: docs/BASIC_PHASE_DESIGN.md (`app/(portal)`, guardians → users), docs/UX_SCREEN_INVENTORY.md (simplified navigation, bottom tab bar on phones). A parent or student signs in with the same sign-in page; what they can see comes **only from their links** (guardian ↔ student, student ↔ login), never from staff roles. Push notifications and SMS / WhatsApp belong to the communication phase (DEC-09).

| Milestone | Scope | Not in scope |
|---|---|---|
| **M5.1 Parent & student logins** | The office invites a guardian (from the student's profile, using the guardian's email) or a student; one login can be the parent of several children and staff elsewhere; access to a child ends when the link is removed or the student leaves; sign-in sends parents and students to their own app | Self sign-up, OTP sign-in by phone (needs DEC-09) |
| **M5.2 Child's day-to-day** | Home with a card per child; attendance by month with %; fees: bills, receipts (download), pay online through the existing gateway flow; apply for the child's leave (goes through the existing approvals); notifications in-app | Results, timetable, homework (B2) |
| **M5.3 Installable app** | Web-app manifest and icons, offline page, "add to home screen", bottom tab bar on phones; English + Kannada | Web push (communication phase), native apps (P8) |

### Acceptance criteria
- **AC44 Logins (M5.1):** a parent sees only linked children, a student only themself — in every API, by test; staff permissions never apply to portal logins; removing a link or a TC ends access; isolation.
- **AC45 Day-to-day (M5.2):** figures equal the office screens (attendance %, dues); a receipt opens only for its own child; online payment uses the same verified flow; leave goes to the approver.
- **AC46 Installable (M5.3):** passes the browser's install checks; works at phone width; English and Kannada; no accessibility violations.

## 2g. Order after Phase 5 (owner, 2026-11-17)

1. **Transport (bus) management** and **Hostel management** (with mess) come next, brought forward from B5. Design: docs/tables/B5_campus_life.md §1 Hostel, §2 Mess, §3 Transport (basic for v1: no GPS). Each gets its own phase plan here before building.
2. The **core modules must keep working**: the full API test suite is re-run (in batches on the dev laptop) at the end of every phase, and any break is fixed before the next phase starts.
3. Anything that needs an outside service (SMS / WhatsApp provider DEC-09, web push, phone OTP, GPS devices) is built up to the point of sending and shown in the app with a **"Coming soon"** icon and message, then connected later (owner, 2026-11-17).

## 2h. Phase 6 — Transport (bus) management (owner, 2026-11-17; complete 2026-11-18)

Design: docs/tables/B5_campus_life.md §3 (basic for v1: no GPS). Module `TRANSPORT`. Live bus location and SMS alerts need outside services → shown as **Coming soon**; stop latitude / longitude are stored now so tracking can be switched on later.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M6.1 Vehicles, documents & crew** | Vehicles (number, type, seats, own / hired, status); documents (RC, insurance, fitness, permit, PUC, tax) with expiry dates and a file; expiry alerts in-app and by email 30 / 15 / 7 days before; drivers, attendants and conductors from the staff list with licence number and expiry | GPS devices, fuel and maintenance logs (later) |
| **M6.2 Routes & stops** | Routes per campus (number, name, vehicle, driver, attendant, shift); stops in order with pickup / drop times, distance and the stop's yearly fee; seats used vs seats on the bus | Route optimisation, live map |
| **M6.3 Students on buses** | Assign a student to a stop (pickup, drop or both) from a date; the bus can never be over-full; the transport fee goes to the student's bills under a Transport fee head (prorated by the months left); stop / change stop with history; route-wise student list for drivers (print / Excel); parents see the child's bus, stop and timings in the app | Live bus location, boarding scans (Coming soon) |

### Acceptance criteria
- **AC47 Vehicles & crew (M6.1):** vehicle number unique per institution; expiry alerts sent once per threshold; a driver is a current staff member; isolation.
- **AC48 Routes (M6.2):** stops in strict order; a route's vehicle and crew belong to the same campus; seats-used figure equals the assigned students.
- **AC49 Students on buses (M6.3):** active students on a route never exceed the vehicle's seats (also under two simultaneous assignments); one active assignment per student per year; the bill equals the stop fee for the months left and appears in the fee account and dues; the parent sees only their own child's bus.

## 2i. Phase 7 — Hostel management, with mess (owner, 2026-11-17; complete 2026-11-18)

Design: docs/tables/B5_campus_life.md §1 Hostel, §2 Mess. Module `HOSTEL`. SMS / WhatsApp alerts to parents (absent at roll-call, late return) and biometric / RFID gates need outside services → **Coming soon**; alerts go in-app and by email meanwhile.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M7.1 Hostels, rooms & beds** | Hostels per campus (boys / girls / staff, warden from the staff list); rooms (block, floor, type, AC, yearly fee) with beds created to the room's capacity; room inventory (cot, mattress, table…) with unit cost; occupancy board (vacant / reserved / occupied / blocked per bed) | Floor plans |
| **M7.2 Allotment, fees & deposit** | Allot a bed to a student (hostel type must match the student's gender; one student per bed, one bed per student — also under two simultaneous allotments); hostel fee billed for the months left and the caution deposit billed once, through the fee module; check-in and check-out against the room inventory; damaged / missing items become a damage charge (approval) on the bills; vacate frees the bed and shows the deposit to refund after deductions; room change keeps history | Online hostel applications by parents (later) |
| **M7.3 Daily hostel life** | Night roll-call per hostel (everyone present by default, mark exceptions; students on an outpass or home-going shown as such); absent students' parents alerted in-app and by email; **outpasses** — parent approves in the parent app, then the warden; out / back times, late return flagged; **home-going register** with the pickup person checked against the student's guardians; visitors log; maintenance requests (raise, assign, resolve) | Gate devices |
| **M7.4 Mess** | Mess plans (meals included, fixed per month or per meal, amount); weekly menu; subscriptions for students (billed through fees) and staff; daily meal counts for the kitchen | Inventory of provisions (B6) |

### Acceptance criteria
- **AC50 Rooms (M7.1):** beds always equal the room's capacity (added / blocked, never deleted while occupied); occupancy figures equal the allotments; isolation.
- **AC51 Allotment (M7.2):** gender rule; one active bed per student and one student per bed (also concurrently); bills equal the room fee for the months left plus the deposit once; damage charges reach the bills only after approval; vacate frees the bed.
- **AC52 Daily life (M7.3):** one roll-call mark per student per night; parents of absent students alerted once; an outpass is used only after both parent and warden approve; a pickup person not among the guardians needs the warden's explicit OK; a parent sees only their own child.
- **AC53 Mess (M7.4):** one active plan per person; meal counts equal the subscriptions for the day; mess bills equal the plan.

## 2j. Phase 8 — Academics I: subjects, timetable, homework & diary (B2; started after Phase 7 under the owner's "continue with all phases"; complete 2026-11-18)

Design: docs/tables/B1_core.md §5 (subjects, level_subjects, section_subject_teachers, student_subjects) and docs/tables/B2_academics.md §1 Timetable, §2 Homework, §3 Class diary. Module `ACADEMICS`. Push notifications are Coming soon; parents are told in-app and by email.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M8.1 Subjects & teachers** | Subjects (code, name, Kannada name, theory / practical / activity, credits, language); the syllabus per class (core, elective, first / second language, optional); class teacher per section; subject teachers per section; students' electives | Board-specific schemes (exams phase) |
| **M8.2 Timetable & substitution** | Rooms; a weekly timetable per section on the campus's bell timings (draft → publish, versions kept); no clash — a teacher, a room or a section is never in two places in the same period (checked when publishing, also across sections); teacher's and room's own timetable; substitution for an absent teacher (only free teachers offered) with an in-app note to the substitute | Automatic timetable generation |
| **M8.3 Homework & class diary** | Homework for a section (subject, due date, attachments); students / parents see it in the app and can submit (text or file); the teacher marks submissions and gives feedback; class diary notes to a whole class or one student, which the parent acknowledges in the app | Plagiarism checks, online tests (LMS phase) |

### Acceptance criteria
- **AC54 Subjects (M8.1):** subject code unique per institution; a class's syllabus lists each subject once; a subject teacher teaches that subject in that section's class; electives only from the class's optional subjects; isolation.
- **AC55 Timetable (M8.2):** no published clash for a teacher, a room or a section in any period (also when two timetables are published at once); periods come from the campus's bell timings; a substitute is free in that period and the substitution is visible to them; a parent sees only their child's section timetable.
- **AC56 Homework & diary (M8.3):** homework visible only to the section's students and their parents; one submission per student (resubmission replaces it until marked); a diary note for one student is seen only by that student's parents; acknowledgements recorded once.

## 2k. Phase 9 — Exams & report cards (school and PU boards) (B2; after Phase 8, 2026-11-18; complete 2026-11-18)

Design: docs/tables/B2_academics.md §6 (grade scales, assessment schemes and components, exams, exam subjects, marks, co-scholastic grades, results, result subjects, publications). Module `EXAMS`. Each board's scheme is data, not code: the institution picks a ready-made pattern (CBSE, Karnataka State, Karnataka PU) and can change it.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M9.1 Grading & schemes** | Grade scales (percentage bands → grade, grade point, "fail" band) with ready-made scales (CBSE 8-point A1–E, Karnataka State A+–C, PU Distinction / First / Second / Pass); assessment schemes per class (terms, components with maximum marks and weightage, overall and per-subject pass %, rounding); co-scholastic areas (CBSE) graded on a scale | University CBCS (SGPA / CGPA, credits, backlogs — university phase) |
| **M9.2 Exams & marks** | An exam fills one component for a campus and year; its timetable per class and subject (date, time, maximum and pass marks); marks entry by the subject's teacher in a class grid (absent, malpractice, exempt codes; never above the maximum), submit → verify by a different person → locked; corrections after verification need set-up rights and a reason (audit) | Hall tickets, seating plans, invigilators, Excel import of marks, revaluation, supplementary exams |
| **M9.3 Results & report cards** | Results per student per term / final: weighted component marks per subject, subject grade and pass, total, percentage, grade, rank in section, attendance %, class teacher's remarks, co-scholastic grades; publish per class after approval by someone other than the marks entrant (versions kept — re-publishing makes a new version); parents and students see results only after publishing (parent app **Results** tab); printable report card (English / Kannada, school name and logo) | Report-card layout designer, transcripts |

### Acceptance criteria
- **AC57 Schemes (M9.1):** a grade scale's bands do not overlap and cover 0–100; component weightages of a term add up to 100; a ready-made scheme applies as editable data; isolation.
- **AC58 Marks (M9.2):** only the subject's teacher (or set-up staff) enters marks for a class; marks never exceed the maximum; absent / exempt need no marks; verified marks are locked and only corrected with a reason by set-up staff; the verifier is not the person who entered them.
- **AC59 Results (M9.3):** results follow the scheme (weights, rounding, pass rules) exactly; rank is by percentage within the section (ties share a rank); a parent sees only their child's published results; publishing needs approval by someone other than the marks entrant; a re-published result is a new version and the old one is kept.

## 2l. Phase 10 — Academics II: lesson plans, study material, certificates (B2; after Phase 9, 2026-11-18; complete 2026-11-18)

Design: docs/tables/B2_academics.md §4 (syllabus units, topics, lesson plans, syllabus progress), §5 (study materials, material views) and §7 (certificate templates, certificates). Modules `ACADEMICS` (lesson plans, material) and `STUDENTS` (certificates).

| Milestone | Scope | Not in scope |
|---|---|---|
| **M10.1 Lesson plans & syllabus tracking** | Syllabus units and topics per class and subject for the year (planned hours); the subject teacher plans lessons for their section (date, topic, objectives, method, resources) and marks them taught or postponed; taught topics record the section's syllabus progress; completion % per section and subject for teachers and the office | Head-of-department approval of plans (later, with the approvals engine) |
| **M10.2 Study material** | Notes, links, videos (links) and files (PDF, images) for a class — all sections or one — and subject, optionally a topic; published or kept as draft; students and parents see published material of the child's class in the app (files opened through the app only); who has opened each item | Online classes, quizzes and question banks (LMS phase) |
| **M10.3 Certificates** | Bonafide, study, character and conduct certificates from templates per institution in English and Kannada (placeholders such as name, class, year, date of birth, parent); request → issue (or through approvals when the template asks), a number from the institution's series, a verification code with a QR code; a public page confirms a certificate is genuine (and shows if cancelled); cancel with a reason; printable on A4 | Migration certificate (university phase); designing templates with a visual editor |

### Acceptance criteria
- **AC60 Lesson plans (M10.1):** only the section's subject teacher (or set-up staff) plans and records lessons; a topic belongs to that class and subject; completion % = taught topics ÷ all topics of the subject; isolation.
- **AC61 Study material (M10.2):** a parent sees only published material of their child's class (whole class or their section); files are served only through that check; views counted once per student with the last time; isolation.
- **AC62 Certificates (M10.3):** numbers are unique and gapless per series; the verification page shows only name, certificate type, number, date, school and status (no other personal data) and rejects unknown codes; a cancelled certificate shows as cancelled; templates needing approval are issued only after approval; isolation.

## 2m. Phase 11 — Engagement I: news feed, events & calendar, parent-teacher meetings (B3; after Phase 10, 2026-11-18; complete 2026-11-18)

Design: docs/tables/B3_engagement.md §1 (feed posts, media, targets, reactions, comments, reports), §2 (events, targets, participants) and §3 (PTM sessions, slots, bookings). Modules `NEWS_FEED`, `EVENTS`, `MEETINGS`. The rest of B3 (staff meetings & minutes, complaints, front office, department requests) is Phase 12. Push notifications stay "Coming soon"; parents are told in the app.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M11.1 News feed** | Posts (news, circular, achievement, event, gallery) with text, photos and PDFs, for the whole institution, a campus, a class or a section; teachers' posts wait for approval when the institution's setting says so; pin; reactions (one per person) and comments (one level of replies; staff can hide); report a post or comment, moderators act; parents and students see only posts meant for their child's class | Video upload (links only), photo-consent rules per student, scheduled posts |
| **M11.2 Events & calendar** | Events (type, dates, venue, organiser) for an audience; registration with a limit, parent consent for trips, a fee billed to the student when a paid event is accepted; attendance after the event; a calendar that combines events, holidays, exam papers and PTM days; parents answer and see the calendar in the app | Photos posted to the feed automatically, recurring events |
| **M11.3 Parent-teacher meetings** | A PTM day for chosen classes with a booking window; slots made for each class teacher and subject teacher; parents book one slot per teacher per child (one family per slot, also when two book at once) and cancel; the teacher sees the day, marks attended / no-show and writes notes; parents leave feedback | Online meeting links created automatically, reminders by SMS |

### Acceptance criteria
- **AC63 News feed (M11.1):** a parent sees only published posts aimed at all, their child's campus, class or section; a post needing approval is invisible until approved; one reaction per person; hidden comments are not shown to parents; reports reach moderators; isolation.
- **AC64 Events (M11.2):** registration never exceeds the limit (also when two register at once); a trip needing consent counts only students with consent; a paid event bills the student once; the calendar shows only what the user may see; isolation.
- **AC65 PTM (M11.3):** slots fit the session's times without overlap; one booking per slot and one per student per teacher per session (also when two book at once); bookings only inside the window and only for the parent's own child of an included class; only the slot's teacher records attendance and notes; isolation.

## 2n. Phase 12 — Engagement II: staff meetings & minutes, complaints, front office, department requests (B3; after Phase 11, 2026-11-18; complete 2026-11-18)

Design: docs/tables/B3_engagement.md §4 (committees, meetings, participants, agenda, minutes, action items), §5 (complaint categories, complaints, updates), §6 (visitors, gate passes, call log, postal register) and §7 (request categories, department requests, updates). Modules `MEETINGS` (staff meetings sit with parent-teacher meetings), `GRIEVANCE`, `FRONT_OFFICE`, `DEPT_REQUESTS`.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M12.1 Staff meetings & minutes** | Committees with members (chair, secretary, member); meetings for staff, a department or a committee with agenda; invitees answer yes / no in the app; attendance; minutes written, circulated and approved by the chair; action items with owner and due date, each person's open actions, overdue ones marked | Recurring meeting series, calendar invitations by email |
| **M12.2 Complaints** | Categories (default handler, time to resolve, sensitive ones visible only to a few); parents raise complaints in the app (staff for themselves too), numbered; assigned, updates (internal notes hidden from the complainant), resolved; the complainant closes with a rating or reopens; overdue complaints are escalated automatically | Anonymous student complaints by students' own logins (students raise through parents for now) |
| **M12.3 Front office** | Visitor log (purpose, whom to meet, student, ID last 4 digits only, pass number, in / out); gate passes for students leaving early — to a guardian allowed to collect, or someone else only after approval — and for staff; call log with follow-ups; postal register in / out with hand-over | Visitor photos from a camera (later), gate devices (Coming soon) |
| **M12.4 Department requests** | Request types (handling department, approval needed, time to complete); any department raises a request to another, approval when needed (approvals engine), assignment to someone in the handling department, updates, completion, closure by the requester | Stock issue from the store (inventory phase) |

### Acceptance criteria
- **AC66 Meetings (M12.1):** only invitees answer and see the minutes; minutes once approved cannot change; an action's owner (or the organiser) updates it; isolation.
- **AC67 Complaints (M12.2):** a parent sees only their own complaints and never internal notes; sensitive complaints are visible only to those allowed; numbers are gapless; overdue complaints are escalated once; isolation.
- **AC68 Front office (M12.3):** a student leaves early only with a guardian allowed to collect, or after approval for anyone else; a visitor or pass is out once and back once; ID numbers are never stored in full; isolation.
- **AC69 Department requests (M12.4):** a request needing approval is not worked on before approval; only the handling department's staff are assigned; only the requester closes it; isolation.

## 2o. Phase 13 — Accounts: full accounting that replaces Tally (B4 part 1; after Phase 12, 2026-11-18; complete 2026-11-19)

Design: docs/tables/B4_finance_hr.md §1 (cost centres, tax codes, TDS sections, vendors, vendor bills and items, vendor payments and allocations, expense vouchers, bank accounts, bank statement lines, reconciliations, period locks). Builds on the B1 chart of accounts, financial years and the posting service (`fees/ledger.ts`: every voucher posts one balanced journal; posted entries never change, mistakes are reversed). Module `ACCOUNTS`. Owner decisions 2026-11-18: bank account numbers and PAN encrypted with an app-level key (CD-84); GST / TDS rates pre-filled and marked "please check" (CD-85); built-in roles including Accountant (CD-86). B4 continues with Phase 14 HR and Phase 15 Payroll.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M13.1 Accounts set-up** | Field encryption service (CD-84); chart of accounts editor (groups and ledgers under the starter chart, system accounts protected); cost centres (campus / department); bank accounts (number encrypted, last 4 shown) each with its own ledger; GST tax codes (CGST + SGST within Karnataka, IGST outside) and TDS sections, pre-filled and effective-dated (CD-85); opening balances (must balance); month lock and unlock (unlock needs approval), year close (surplus / deficit to the general fund, next year's opening balances) | Multi-currency, consolidation across institutions |
| **M13.2 Vendors & bills** | Vendors (supplier / service / contractor / utility; GSTIN and PAN checked for format; bank number encrypted; default TDS section); purchase / expense bills with items (account, cost centre, GST code), GST split by the vendor's state, TDS when the section's threshold is crossed in the year; approval (approvals engine, type "Vendor bill") then posting (Dr expense + input GST / Cr vendor, TDS payable); cancel by reversal; vendor ledger and dues ageing | Purchase orders and goods receipts (B6 inventory; the link columns stay empty), e-invoicing |
| **M13.3 Payments & vouchers** | Vendor payments (cash, cheque, NEFT / RTGS, UPI) against one or more bills or as an advance, partial payments, approval before paying; expense and petty-cash vouchers without a bill; contra (cash ↔ bank, bank ↔ bank); manual journal vouchers for adjustments; every voucher numbered, approved where set up and posted in the same transaction; posting into a locked month refused | Cheque printing, bulk bank payment files (payroll phase) |
| **M13.4 Bank reconciliation** | Import bank statements (CSV / Excel, column mapping, duplicates ignored); suggested matches by amount, date (± 3 days) and reference; manual match of one line to one or more entries; unmatch; ignore bank-only lines with a reason or post them as a voucher (charges, interest); reconciliation statement (book balance vs bank balance with the differences) | Live bank feeds (Coming soon) |
| **M13.5 Reports** | Day book, cash book and bank book, account ledger (with cost-centre filter), trial balance, income & expenditure (profit & loss), balance sheet, receipts & payments, GST register (input tax by rate and vendor), TDS register (deducted, by section and vendor, for the return); campus and date filters; Excel export; plain-language headings | Filing returns online, audit-firm formats beyond Excel |

### Acceptance criteria
- **AC70 Set-up (M13.1):** encrypted fields are never stored or logged in plain text and show only the last 4 digits; opening balances must balance; nothing posts into a locked month; a closed year moves the surplus to the general fund and opens the next year with matching balances; isolation.
- **AC71 Bills (M13.2):** GST splits into CGST + SGST for a Karnataka vendor and IGST otherwise; TDS is deducted only above the section's threshold for the year; a bill posts only after approval, and its journal balances; a vendor's bill number is unique per vendor; isolation.
- **AC72 Payments & vouchers (M13.3):** a payment never exceeds what is due unless it is an advance; allocations keep bill balances and statuses right under two payments at once; every voucher's journal balances; the approver is not the preparer; isolation.
- **AC73 Bank reconciliation (M13.4):** importing the same statement twice adds nothing; a statement line is matched only once and only to entries on that bank's ledger; the reconciliation statement explains the whole difference; isolation.
- **AC74 Reports (M13.5):** the trial balance balances; income & expenditure and the balance sheet tie out to the trial balance (assets = liabilities + funds + surplus); fee receipts, refunds and earlier postings appear correctly; isolation.

## 2p. Phase 14 — HR: staff records, shifts, leave balances, exits (B4 part 2; after Phase 13, 2026-11-19; complete 2026-11-19)

Design: docs/tables/B4_finance_hr.md §2 (designations, employee details, qualifications, experiences, shifts, leave balances, employee exits). Builds on the B1 staff list (`employees`), leave types / requests and staff attendance. Module `HR_PAYROLL` (the basic staff list stays in the core, CD-52). PAN and bank account numbers use the Phase 13 field encryption (CD-84); Aadhaar is never stored in full (last 4 only, as for students). Phase 15 Payroll reads these records.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M14.1 Designations & staff profile** | Designations (teaching / non-teaching / admin / support) replacing the free-text designation (existing values carried over); full profile: personal (father / spouse, marital status, blood group, addresses, emergency contact), statutory (PAN encrypted, Aadhaar last 4, UAN, PF and ESI numbers), bank (encrypted, last 4 shown), reporting manager, confirmation and probation dates; qualifications and experience; documents through the existing files service; staff can see (not change) their own profile | Recruitment and onboarding checklists, appraisal |
| **M14.2 Shifts & staff attendance** | Shifts per campus (start, end, late after, half-day after), staff assigned to a shift; staff attendance marks late / half-day from the shift times when an in-time is entered; monthly staff attendance summary (present, absent, leave, late, half-day) that payroll will use | Biometric / RFID devices (Coming soon) |
| **M14.3 Leave balances** | Yearly allotment per leave type (days per year, carry-forward limit), opening balances, balance used when leave is approved and given back when cancelled, encashment recorded; the leave form shows the balance and refuses paid leave beyond it (unpaid leave allowed as loss of pay); year-end carry-forward | Leave encashment payment (payroll phase) |
| **M14.4 Exits** | Resignation / retirement / termination / contract end with last working day; handover to a colleague; no-dues clearance by section (library, store, accounts, hostel, IT) each cleared by its owner; on closing: login removed from the institution and its sessions ended, the staff member shown as left (approvals route by role, so nothing waits on the person who left); final settlement amount recorded for payroll | Full and final settlement calculation (payroll phase), relieving / experience letters from templates (later, with certificates) |

### Acceptance criteria
- **AC75 Profile (M14.1):** PAN and bank numbers are encrypted and shown as the last 4 (full only with the reveal right, audited); Aadhaar is never stored in full; a staff member sees only their own profile; existing designations are carried over; isolation.
- **AC76 Shifts & attendance (M14.2):** late / half-day follow the shift times; the monthly summary adds up to the days in the month; isolation.
- **AC77 Leave balances (M14.3):** approved leave uses the balance once (also when approved twice at once), a cancelled leave gives it back, paid leave beyond the balance is refused, carry-forward respects the limit; isolation.
- **AC78 Exits (M14.4):** an exit closes only after every no-dues section is cleared; on closing (on or after the last day) the login is removed and its sessions end, and the staff record shows left; isolation.

## 2q. Phase 15 — Payroll: salary set-up, statutory rules, monthly runs, payslips, loans (B4 part 3; after Phase 14, 2026-11-19; complete 2026-11-19)

Design: docs/tables/B4_finance_hr.md §3 (salary components, structures, employee salary, statutory rules, payroll runs, payslips, loans). Builds on the Phase 14 staff profile (PAN, UAN, PF / ESI numbers, encrypted bank account), staff attendance, leave requests and leave balances, the Phase 13 posting service, bank accounts and period locks, and the approvals engine. Module `HR_PAYROLL`. Owner decision 2026-11-19: income tax on salary (TDS) is worked out automatically under the new regime, slabs pre-filled and marked "please check" (as CD-85), with a per-person monthly override; the old regime with declarations comes later.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M15.1 Salary set-up** | Salary components (earning / deduction / employer contribution; fixed amount, % of basic, % of gross, the balance of gross, a simple formula, or statutory PF / ESI / PT / TDS), with "reduced for loss of pay", "taxable" and "counts for PF" flags and the account each posts to; starter components (Basic, DA, HRA, Special allowance, PF, ESI, PT, TDS, employer PF and ESI); salary structures (e.g. "Teaching staff") with their components and values; each staff member's salary: structure, monthly gross, effective from (one open salary per person, revisions close the old one), PF / ESI on or off, personal values and a TDS override; payroll accounts added to the chart (salary payable, PF / ESI / PT payable, staff loans & advances, employer PF / ESI expense) | Arrears worked out automatically for back-dated revisions (entered as a one-off line instead), grades and pay bands |
| **M15.2 Statutory rules** | Effective-dated rules, pre-filled and marked "please check": PF 12% employee and employer on PF wages up to ₹15,000; ESI 0.75% / 3.25% when gross is ₹21,000 or less; Karnataka professional tax (₹200 a month from ₹25,000, ₹300 in February); income tax new regime (slabs, ₹75,000 standard deduction, no tax up to ₹12 lakh with marginal relief, 4% cess) spread over the remaining months of the financial year, less tax already deducted | Old tax regime and investment declarations, surcharge above ₹50 lakh, PF admin / EDLI charges, other states' professional tax |
| **M15.3 Monthly payroll run** | One run per campus per month: everyone with a salary that month (joiners and leavers paid for their days); paid days from staff attendance (absent = loss of pay, half day = half), approved unpaid leave and days not employed (days without attendance marked are paid); calculate → review (per person; one-off additions and deductions such as arrears, bonus or recoveries; recalculate any time before approval) → submit for approval (never approved by the person who prepared it; a run cannot be submitted until an approver is set up) → approved: one balanced journal (salary expense and employer contributions / salary, PF, ESI, PT, TDS payable and loan recovery), loan balances reduced → bank transfer file (CSV: name, account, IFSC, amount — full account numbers only for the payer, recorded in the audit log; staff without bank details listed for cheque / cash) → paid on a date from a bank account (Dr salary payable / Cr bank) and payslips released; a run can be cancelled until it is approved; nothing posts into a locked month | Bank-specific bulk upload formats and direct bank integration (Coming soon), reversing an approved run (corrections go in the next month as one-off lines) |
| **M15.4 Payslips, loans, reports & settlement** | Payslip page (print / save as PDF from the browser) with earnings, deductions, employer contributions, paid / LOP days and year-to-date tax; "My payslips" for every staff member (released ones only); salary advances and loans with EMI, approval, disbursement posting (Dr staff loans / Cr cash or bank) and recovery in each run until repaid; reports: payroll register, PF statement and the EPFO ECR text file, ESI statement, professional tax statement, TDS on salary — each with CSV download; final settlement worksheet for a staff exit (days worked in the last month, earned-leave encashment from the balance, loan still owed → suggested settlement amount for the exit) | Form 16 / 24Q returns, ESI portal upload, gratuity, bonus act calculations |

### Acceptance criteria
- **AC79 Salary set-up (M15.1):** a structure works out each component from the gross (fixed, %, balance, formula) to the paisa and the earnings add up to the gross; one open salary per person (a revision closes the previous one); salary figures are visible only with the salary right; isolation.
- **AC80 Statutory (M15.2):** PF on wages capped at the ceiling, ESI only up to the gross limit (rounded up), Karnataka PT by slab with February's higher amount, new-regime TDS (no tax up to ₹12 lakh, marginal relief just above it) spread over the remaining months and reduced by tax already deducted; the rule in force on the month's last day is used; isolation.
- **AC81 Payroll run (M15.3):** paid days = days employed − absences − half of half days − unpaid leave; one run per campus and month; the preparer cannot approve; approval posts one balanced journal that matches the payslips; loans recover their EMI and never go below zero; payment posts Dr salary payable / Cr bank and releases payslips; nothing posts into a locked month; a cancelled run frees the month; isolation.
- **AC80a Tax opening (added during the build):** salary and tax already paid earlier in the financial year (before EduERP payroll) are entered per person and count for income tax, so the first year’s TDS is right.
- **AC82 Payslips, loans & reports (M15.4):** staff see only their own released payslips; the PF / ESI / PT / TDS statements add up to the run's postings; the bank file carries full account numbers only for the payer and the export is audited; the settlement worksheet uses the earned-leave balance and the loan still owed; isolation.

## 2r. Phase 16 — Campus life II: library, health & infirmary, discipline & counselling (B5 part 2; after Phase 15, 2026-11-20; complete 2026-11-20)

Design: docs/tables/B5_campus_life.md §4 Library, §5 Health & infirmary, §6 Discipline & counselling (hostel, mess and transport were built in Phases 6–7). Modules `LIBRARY`, `HEALTH`, `DISCIPLINE`. Fines and lost-book charges are billed to the student's fees as a one-off bill under a fee head of type Fine (as hostel damage charges are). Parents are told through in-app notices and email (SMS / WhatsApp: Coming soon). Health and counselling records are sensitive: each needs its own right, and counselling notes are encrypted (CD-84) and readable only by the counsellor who wrote them.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M16.1 Library catalogue** | Books (title, authors, ISBN, publisher, edition, year, language, subject, call number) and copies per campus with an accession number (numbered automatically or typed / scanned), barcode, price, rack, status; search by title / author / ISBN / accession number; bulk import of the existing register from Excel (one row per copy); withdraw a copy; library settings (loan days, books at a time and renewals for students and for staff, fine per day after a grace period, hold days for reservations) | ISBN look-up from an online catalogue (Coming soon), RFID tags, e-books |
| **M16.2 Circulation** | Issue (by accession number or barcode scan) to a student or staff member within their limit; return (fine for late students worked out on return and billed to fees, or waived with the right); renew up to the limit (not when someone is waiting); reservations — the next returned copy is held for the first in line, who is told; lost or damaged — the copy's price billed to the student's fees; overdue list and daily reminders (in-app and email to the borrower, or the student's parents); stock verification (scan what is on the shelf, report what is missing, mark missing copies lost); "My library" for students and staff; the parent app shows the child's books and due dates | Staff fines (staff get reminders only), inter-library loans, a public OPAC |
| **M16.3 Health & infirmary** | Student health profile (height, weight, blood group from the student record, allergies, conditions, medicines, disability, family doctor); infirmary visits for students and staff (complaint, temperature, treatment, medicine, outcome — back to class, rest, sent home, referred to hospital); parents told when a child is sent home or referred; health check-ups (general, dental, eye, BMI) and vaccinations with the next due date and a due list; nurses see everyone on their campus, wardens only the students in their hostel | Medicine stock (B6 inventory), doctor appointments, insurance claims |
| **M16.4 Discipline & counselling** | Incident types with severity and "tell parents"; incidents reported by any teacher (student, date and time, place, description, witnesses); review and actions — warning, parent meeting, suspension (dates), fine (billed to fees after approval where a rule exists), counselling referral, other — and closing; parents told for types that say so; class teachers see their class's incidents (read-only); a student's behaviour record; counselling sessions (referral source, linked incident, follow-up date) with notes encrypted and readable only by the counsellor who wrote them | Behaviour points / house points, automatic suspension in attendance, anonymous reporting |

### Acceptance criteria
- **AC83 Catalogue (M16.1):** accession numbers are unique per institution (typed or automatic); the import adds books and copies and refuses duplicates; search finds by title, author, ISBN and accession number; isolation.
- **AC84 Circulation (M16.2):** a copy is never issued twice at once (also when two desks issue together); limits and renewal rules hold; a late return bills the fine to the student's fees once (or is waived with the right); a reserved book is held for the first in line; a lost copy bills its price; stock verification lists missing copies; borrowers see only their own loans; isolation.
- **AC85 Health (M16.3):** health records need the health right (wardens: their hostel's students only); a visit that sends a child home tells the parents; vaccinations due are listed; isolation.
- **AC86 Discipline & counselling (M16.4):** an incident's actions and status follow review → action → closed; a fine is billed to fees (after approval where set up); class teachers read their class's incidents only; counselling notes are stored encrypted and only their author can read them; isolation.

## 2s. Phase 17 — Inventory & purchase (B6 part 1; after Phase 16, 2026-11-20; complete 2026-11-20)

Design: docs/tables/B6_operations.md §1 (item categories, items, stores, stock balances, stock ledger, purchase requests, quotations, purchase orders, goods receipts, stock issues and transfers, stock counts). Builds on Phase 13 vendors, GST codes and vendor bills (the bill's purchase-order and goods-receipt links are filled from here), Phase 12 department requests and the approvals engine. Module `INVENTORY`. Owner decision 2026-11-20: purchases are booked as an expense on the vendor bill, as today; EduERP keeps stock quantities and their weighted-average value per store for issues, counts and reports, but stock is not an asset in the balance sheet (no inventory postings).

| Milestone | Scope | Not in scope |
|---|---|---|
| **M17.1 Items & stores** | Item categories (starter: stationery, cleaning, lab consumables, IT, furniture, kitchen, sports); items with code, unit, type (consumable / asset / lab equipment), HSN, GST code, reorder level and the expense account the bill uses; stores per campus with a store keeper; opening stock per store at a rate; stock balance per store (quantity, weighted-average rate, value) changed only through the stock ledger in the same transaction with the row locked; item ledger | Fixed-asset register and depreciation, batch / expiry tracking, barcodes for items |
| **M17.2 Purchase requests & quotations** | Purchase request from a department (optionally from a Phase 12 department request) with items, quantities, estimated rates and the date needed; approval (type "Purchase request", where a rule exists); quotations from vendors with item rates, GST, delivery days and terms; comparative statement (lowest per item and in total) and selection with a reason | Online tender / reverse auction, vendor portal |
| **M17.3 Purchase orders, goods receipts & bills** | Purchase order from the selected quotation or directly, delivered to a store, approved by amount (type "Purchase order"), printable; goods receipt against the order with received, accepted and rejected quantities (accepted up to the ordered quantity + 5%), posted into stock at the order rate; order partly / fully received, closed or cancelled; the vendor bill made from a goods receipt (3-way match: billed quantity never more than accepted less already billed, at the order rate) and posted as in Phase 13 | Returns to vendor with debit notes, landed-cost apportionment |
| **M17.4 Issues, transfers, counts & alerts** | Issue to a department or a staff member (optionally against a department request, closing it), out at the weighted-average rate, never more than in stock; transfer between stores (out and in together); physical stock count per store with the differences adjusted after approval (type "Stock adjustment", where a rule exists); low-stock list and a daily notice to the store keepers; reports: stock by store with value, item ledger, consumption by department and item, purchase register | Automatic reorder purchase requests, mess / kitchen consumption from menus |

### Acceptance criteria
- **AC87 Items & stock (M17.1):** stock never goes below zero (also with two issues at once); the weighted-average rate and value follow every receipt; the ledger balance always equals the stock balance; isolation.
- **AC88 Requests & quotations (M17.2):** a request needs approval where a rule exists; the comparative statement picks the lowest total and per-item rates; only one quotation is selected per request; isolation.
- **AC89 Orders, receipts & bills (M17.3):** an order is approved by someone else where a rule exists; accepted quantities never exceed the order + 5%; only accepted quantities enter stock; a bill from a receipt never bills more than was accepted less already billed; the order shows partly / fully received; isolation.
- **AC90 Issues, counts & alerts (M17.4):** issues and transfers move stock at the average rate and never below zero; a count's differences adjust stock only after approval; items below their reorder level are listed and the store keeper is told once a day; isolation.

## 2u. Phase 18 — Labs, and Sports & activities (B6 part 2; after Phase 17, 2026-11-20; complete 2026-11-20)

Design: docs/tables/B6_operations.md §2 (labs, lab equipment, lab sessions, lab breakages) and §3 (activities, activity members, competitions, competition participants, achievements). Builds on Phase 17 stores and issues (each lab may have its own store for consumables), Phase 2 fee billing (breakages charged under the Fines fee head, like library fines), the approvals engine, Phase 8 sections and subjects, Phase 11 events and the news feed. Modules `LABS` and `SPORTS`.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M18.1 Labs & equipment** | Labs per campus with department, in-charge, lab assistant, capacity and the lab's store; equipment register with asset tag (unique per institution), quantity, condition (working / needs repair / damaged / disposed), optional inventory item, last and next calibration; calibration due / overdue list (30 days) | Equipment loans to students, maintenance contracts (AMC) |
| **M18.2 Practical sessions & breakages** | Practical sessions per lab: class section, subject, batch, teacher, date and time, experiment; never two sessions in one lab at the same time; mark completed (with attendance count and remarks) or cancelled; a teacher's own sessions; breakage register (item or equipment, student, quantity, amount) charged to the student's fees under the Fines head — after approval where a LAB_BREAKAGE rule exists, otherwise at once — or waived with a reason; damaged equipment marked | Per-student practical attendance and marks (exams module), lab timetable inside the class timetable |
| **M18.3 Activities & teams** | Activities per campus — sports, clubs (NCC, NSS, music, robotics…) and houses — with a coordinator; members per academic year with team and role (member, captain, vice-captain, secretary); a student's activities on their profile and in the parent app | Fees for activities, practice schedules and attendance |
| **M18.4 Competitions & achievements** | Competitions per activity (intra-school to international) with venue, dates and an optional calendar event; participants by category with results (participated, winner, runner-up, third, special mention); achievements for students and staff (sports, academic, cultural, NCC / NSS, other) created from a result or entered directly, verified by a coordinator, then shown on the student profile and in the parent app, parents told, and optionally posted to the school news feed; reports: participation and medals by activity and level | Certificates printed for each participant, inter-school league tables |

### Acceptance criteria
- **AC91 Labs & equipment (M18.1):** asset tags are unique per institution; condition and calibration dates are kept; the due list shows equipment due within 30 days or overdue; isolation.
- **AC92 Sessions & breakages (M18.2):** two sessions can never overlap in one lab (also when booked at the same moment); a breakage is billed to the student's fees once — after approval where a rule exists — or waived with a reason; isolation.
- **AC93 Activities (M18.3):** a student is a member of an activity once per year; members show on the student profile and in the parent app for their own child only; isolation.
- **AC94 Competitions & achievements (M18.4):** a student is entered once per competition and category; an achievement from a result keeps the link; only verified achievements reach the profile, the parent app, parents and the news feed; isolation.

## 2v. Phase 19 — Placements, and Reports & exports (B6 part 3; after Phase 18, 2026-11-21; complete 2026-11-21)

Design: docs/tables/B6_operations.md §4 (companies, student placement profiles, placement drives, applications, offers) and §5 (saved reports, export jobs). Builds on Phase 1 programmes and students, the files store, the outbox / pg-boss worker and email, and the reports already inside each module. Modules `PLACEMENTS` and `REPORTS`. Owner decisions 2026-11-21: (1) until university CBCS is built, the placement cell enters each student's CGPA (or percentage) and backlogs in the placement profile, marked verified; CBCS will fill them later and the manual entry stays as history; (2) background exports are Excel (.xlsx) and CSV only, kept 7 days; PDF stays "Print / save as PDF" from the browser.

| Milestone | Scope | Not in scope |
|---|---|---|
| **M19.1 Companies & placement profiles** | Companies with industry, website, HR contact, address, status (active / blacklisted with reason); a placement profile per student: opted in, skills, preferred locations, resume (file), passing year, CGPA or percentage and backlogs entered and verified by the placement cell (who and when), placed flag | Company portal, student-uploaded marks, automatic CGPA (CBCS phase) |
| **M19.2 Drives & applications** | Drives per campus and company: role, full-time / internship, CTC range, eligible programmes, passing year, minimum CGPA, maximum backlogs, last date to apply, drive date, rounds, status draft → open → closed → completed; eligible students listed (opted in, verified, programme, year, CGPA, backlogs, not blacklisted company); students apply from the student app or the officer enrols them (eligibility snapshot kept); applications move round by round (shortlisted, in process, selected, rejected, withdrawn); eligible students told when a drive opens | Online tests, interview scheduling per slot, company feedback forms |
| **M19.3 Offers & statistics** | Offers for selected students with CTC, offer and joining dates, offer letter (file), status offered → accepted / declined / revoked; a student is placed when an offer is accepted (one accepted full-time offer per student unless the officer allows more); statistics per batch: opted in, placed and %, highest / average / median CTC, by programme and by company; the student's own placement view in the app | Alumni tracking after joining, placement fees |
| **M19.4 Reports & exports** | A report catalogue across modules (students, fee dues, fee collection, attendance summary, staff, library overdue, stock value, achievements, placements), each with its filters and the right that reads it; run on screen; saved reports with filters (private or shared); background exports to Excel / CSV through the job queue with row count, a download link kept 7 days and an export log; optional weekly / monthly email of a saved report to its owner | Report designer, server-made PDF (owner decision), charts builder, emailing outside the institution |

### Acceptance criteria
- **AC95 Companies & profiles (M19.1):** one profile per student; CGPA 0–10 or percentage 0–100 and backlogs ≥ 0 are kept with who verified them; a blacklisted company cannot get a new drive; isolation.
- **AC96 Drives & applications (M19.2):** only opted-in, verified students who meet programme, year, CGPA and backlog rules can apply, and only while the drive is open and before the last date; one application per student and drive, with the eligibility snapshot; a student sees only their own applications; isolation.
- **AC97 Offers & statistics (M19.3):** offers only for selected applications; accepting marks the student placed; a second accepted full-time offer is refused unless allowed; statistics match the offers; isolation.
- **AC98 Reports & exports (M19.4):** a report runs only with its right and within the user's campuses; an export produces the same rows as the screen, in Excel and CSV, logged with the row count, downloadable only by its owner until it expires; saved reports are private unless shared; isolation.

## 2w. Improvement round — module by module (owner, 2026-11-23)

After Phase 19 the owner asked to go module by module, improving each module and its links to the others, in the order the owner names, and to check that the product fits two target customers: a **Morarji Desai residential school** (Karnataka government residential school) and **VTU** (university with affiliated colleges). First module named: **access control**.

### 2w.1 Access control — roles master and user access (2026-11-23) — ✅ complete 2026-11-23

Owner decisions 2026-11-23: (1) built-in roles are **fixed templates** that stay up to date with each release; a school customises access by **copying** a built-in role and editing the copy (custom roles are never changed by releases); (2) access is limited per **campus** — each campus has its own role holders (e.g. a separate HOD for each campus), and one person may hold several roles, each for all campuses or one campus.

| Milestone | Scope | Not in scope |
|---|---|---|
| **A1 Roles master** | One screen listing built-in roles (read-only, with "Copy") and the school's own roles; a role editor with every right grouped by module in plain English / Kannada, select-all per module, search, only modules the school has; create from scratch or from a copy; rename; delete a custom role nobody holds; who holds each role | Department-level limits (owner: per campus is enough for now), time-limited roles |
| **A2 User access** | From the users list, one page per person: their roles with the campus each applies to, add a role for all campuses or one campus, remove a role, everything the person can do grouped by module (read-only), send a password link, remove from the institution; the linked staff / student / parent record shown | Single sign-on, two-factor sign-in (later) |
| **A3 Safety rules** | Only people with the role-management right edit roles; nobody can give a role with rights they do not hold themselves, or for a campus outside their own reach; the institution always keeps at least one all-campus Institution Admin; nobody removes their own admin access; changes apply at the person's next click and are written to the audit log | — |

### Acceptance criteria
- **AC99 Roles master (A1):** built-in roles cannot be changed or deleted; a copy holds the same rights and can be edited; custom role names are unique; a role held by anyone cannot be deleted; only rights of the school's modules are offered; isolation.
- **AC100 User access (A2, A3):** a role is given for all campuses or one campus and takes effect on the next request; the same role twice for the same reach is refused; nobody grants rights they do not hold or a campus they cannot reach; the last all-campus Institution Admin cannot be removed; the effective-rights view matches what the API allows; every change is audited; isolation.

### 2w.2 Government residential school pack — Morarji Desai / KREIS (2026-11-23) — ✅ complete 2026-11-23

From the fit check for a Morarji Desai residential school (KREIS): five gaps. Owner decisions 2026-11-23: (1) government exports use the published field lists with **columns the institution can rename, reorder and switch off** to match each year's portal template; (2) KREIS is **one institution and each school is a campus** (with its district) — head office holds all-campus roles, each principal their own campus; (3) the **diet scale is entered once by head office** for the institution (no built-in quantities). Everything is added beside the existing modules — no existing screen, rule or report changes.

| Milestone | Scope | Not in scope |
|---|---|---|
| **G1 Government data & exports (SATS / UDISE+)** | A government-data card on each student (SATS student ID, UDISE+ PEN, ration card type APL / BPL / AAY, EWS, minority group, child with special needs and type, medium of instruction, distance from home, previous school); two exports — SATS and UDISE+ student data — in the report catalogue (Excel / CSV, by campus and class), built from fields already in EduERP (name, date of birth, gender, category, religion, mother tongue, APAAR ID, Aadhaar last 4, parents, address, class, admission number and date, height and weight) plus the card; the column layout of each export can be renamed, reordered or switched off by an admin and reset to the standard; a readiness list per campus shows students with missing fields | Uploading to the portals (no public interface), full Aadhaar number (only the last 4 are kept) |
| **G2 Welfare items & allowances** | Welfare schemes per academic year: an item (uniform, shoes, kit, notebooks — from the inventory store, optional) or a cash allowance, with the quantity or amount per student, for which classes and gender; hand out to a class at once (students already given are skipped, never more than the entitlement) — stock leaves the store in one go, with a welfare movement in the item ledger; cash allowances recorded with the payment reference; who received what and who is still waiting, by scheme and class; the student's profile lists what they received | Paying allowances through a bank (DBT) — recorded only |
| **G3 Diet scale & daily meal register** | The diet scale: food items (from inventory) with the quantity per child per day, for all classes or for chosen classes, from a date (head office); a daily meal register per campus (breakfast, lunch, snacks, dinner — children who ate, suggested from the hostel roll call); a diet report for a period: children-days, quantity due by the scale, quantity actually issued from the campus stores and the difference, flagged when outside a tolerance (default 10%) | Menu planning by nutrients, ration orders to the government |
| **G4 Government staff details** | On the staff profile: employment type (government, outsourced, guest), KGID number, HRMS employee ID, PRAN (NPS) or GPF number, pay scale, date of joining government service; the DDO code on the campus; a staff report for HRMS with these fields. Payroll stays as it is and can be switched off when the treasury pays | Sending data to HRMS-2 |
| **G5 Head-office overview** | One page comparing schools (campuses), grouped by district with totals: students (boys / girls), staff, today's student attendance and hostel roll call, meals served yesterday, diet difference this month, welfare handed out against due, SATS / UDISE+ readiness, latest results pass %; each figure links to the module; a principal sees only their own campus | Charts over years, data from other institutions |

### Acceptance criteria
- **AC101 Government exports (G1):** the card is saved and audited; each export contains one row per active student in the reader's campuses with the configured columns in the configured order and labels; a reset brings back the standard; readiness lists exactly the students missing a required field; isolation.
- **AC102 Welfare (G2):** a hand-out never gives a student more than the entitlement (also when two run at once), skips those already given, takes stock once with a welfare movement and refuses when stock is short; class and gender rules are applied; cash allowances need a reference; isolation.
- **AC103 Diet (G3):** one register per campus and day; the report's due quantity equals children-days × scale for the classes it applies to, the issued quantity equals the campus's issues of that item in the period, and the flag follows the tolerance; isolation.
- **AC104 Staff and overview (G4, G5):** government staff fields are saved, audited and exported; the overview figures match the modules' own numbers for each campus and the district totals add up; a campus-only reader sees only their campus; isolation.

### 2w.3 Fit check — VTU (2026-11-23)

Findings reported to the owner on 2026-11-23 (no build yet): for a **VTU-affiliated engineering college** EduERP covers admissions, fees, accounts, HR / payroll, hostel, transport, library, labs, placements, attendance and timetable; missing are **CBCS** (credits, SGPA / CGPA, backlogs, CIE / SEE split per the VTU scheme — planned after Phase 20), **outcome-based education** for NBA (CO–PO mapping and attainment) and the **ABC ID** (APAAR exists; the USN can use the admission number). For **VTU itself** (the university) a further layer is needed: affiliated colleges and approved intake, central examinations (registration, hall tickets, evaluation, revaluation, results), convocation and migration certificates, credit upload to ABC. Open question to the owner: is the target an affiliated college or the university itself.

## 2x. Editions plan — one product, editions (approved 2026-11-24; VTU moved to the next version)

The owner asked (2026-11-24) for three products — standard EduERP, a Morarji Desai residential school and hostel ERP, and VTU — where "what we want we enable, otherwise it works the same". Decision: **one code base, editions**. An edition is a ready-made set-up chosen when an institution is created: which modules are switched on, the starting roles, names on screens, branding and starting settings. Module switches, roles by campus and plans already exist; the editions build on them. Separate servers (for example a government data centre for KREIS) run the same code. Nothing is copied into separate projects.

**Owner decision (2026-11-24):** everything except VTU is built in this version; VTU (the University edition and its phases) is planned in the next version.

| Edition | For | On by default | Off by default |
|---|---|---|---|
| **EduERP** (standard) | Private schools, PU and degree colleges | All school / college modules as today | — |
| **EduERP Residential** | Morarji Desai / KREIS and similar government residential schools | Hostel, mess, diet & meals, welfare, SATS / UDISE+, health, attendance, academics, exams, schools overview by district, inventory | Fees and online payment, placements, payroll (treasury pays) |
| *EduERP University* — next version | VTU-affiliated colleges; optionally VTU itself | CBCS, outcome-based education, placements, labs, exams, fees, accounts | School-only modules |

Any module of another edition can still be switched on for one institution. The edition list is built so a University edition can be added later without changing the others.

### Phases in this version

| Phase | Scope | Size |
|---|---|---|
| **20 Editions** | Edition templates in the platform console (modules, starting roles, settings) applied when an institution is created and changeable later; an institution's edition shown in the console; names on screens per edition (for example "Head office" for the all-campus admin, "School" for campus in Residential); branding per institution (logo and name on the sign-in page, letters, report cards and receipts); module groups in the menu follow the edition; a demo institution per edition | Medium |
| **21 Residential edition** | KREIS head-office set-up: allotment list import (students allotted by the entrance / counselling), transfer of a student or staff member between schools with history, monthly MIS report for head office (enrolment, attendance, hostel, meals, welfare, results by school and district), hostel-wise health check-up camps, warden daily report, Kannada-first screens | Medium |
| **22 SaaS billing** (was Phase 20) | As planned in 2t, with a price per edition and per student; grace period 30 days by default, changeable in the platform console (for all institutions and for one institution, e.g. 45 days); each institution chooses monthly or yearly billing (owner, 2026-11-24) | Medium |
| **B7 Final testing / private pilot** | One pilot institution per edition, release | — |

**Count:** 3 phases (20–22) plus the final testing. Order: Editions → Residential → SaaS billing → B7.

### 2x.1 Phase 20 — Editions: build plan (2026-11-24) — ✅ complete 2026-11-24

Existing institutions become the **Standard** edition and nothing changes for them. An edition only decides the starting set-up; afterwards every module, role and setting can still be changed as today.

| Step | Scope |
|---|---|
| **E1 Editions catalogue** | A fixed list of editions in the code (Standard, Residential; a University edition can be added in the next version). Each edition lists the modules it switches on, the extra starting roles, the screen names and the starting menu order. Residential: everything on except Admissions, Fees, Transport and Placements (students come by allotment, education is free, all live on the campus); extra roles Principal (one school), Warden, Kitchen in-charge, Head office officer. New column `tenants.edition` (default Standard) |
| **E2 Platform console** | Creating an institution: choose the edition (the trial switches on that edition's modules and creates its roles). Institutions list: edition shown and filterable. Institution page: change the edition — a preview shows the modules that will switch on or off and the roles that will be added; data is never deleted, platform overrides are kept, existing roles are not changed; audited |
| **E3 Screen names** | Edition wording laid over the normal screen text in English and Kannada — Residential says "School / Schools" for campus and "Head office" for the whole institution. The edition comes with the signed-in session; Standard text is unchanged |
| **E4 Institution profile & branding** | Settings → Institution profile: name (English, Kannada), contact, address and a logo (PNG / JPEG / WebP, up to 1 MB). The logo appears in the top bar, on the institution's own sign-in link (`/login?i=<address>`) and the institution chooser, and on receipts, report cards, certificates, transfer certificates, payslips, purchase orders and the online payment page. Only the name and logo of an institution are public (for its sign-in page) |
| **E5 Menu** | Menu groups ordered by edition (Residential: hostel, meals and welfare near the top); modules that are off stay hidden as today |
| **E6 Demo** | A second demo institution in the Residential edition (two schools in Mysuru and Chamarajanagar districts, head office, principals, a warden, students in the hostel, diet scale and meals) next to the existing Standard demo |

Acceptance: **AC105** a new institution gets its edition's modules and roles; **AC106** changing the edition switches modules as previewed, keeps overrides, data and existing roles, and is audited; **AC107** Residential screens say "School" / "Head office" in both languages while Standard screens are unchanged; **AC108** the institution profile and logo save with checks (image types only, 1 MB) and the logo shows on the sign-in link and printed documents; the public branding answer holds nothing but the name and logo.

### Next version — VTU (not built now)

| Phase | Scope | Size |
|---|---|---|
| CBCS | VTU scheme set-up (credits, L-T-P, CIE / SEE, pass rules), course registration, electives, CIE and SEE marks, SGPA / CGPA, backlogs and make-up exams, grade card, USN; placement CGPA filled automatically | Large |
| Outcome-based education | COs per course, CO–PO / PSO mapping, marks per question, attainment, NBA and NAAC formats | Large |
| Academic records | ABC ID, transcripts, provisional / degree / migration certificates with QR verification | Small |
| Affiliation, central examinations, convocation & university analytics | Only if VTU itself is the customer | Large / very large / medium |

**Open questions for the owner:** (1) does KREIS need its own server (government data centre)? — affects hosting only, not the build.

## 2t. Order after Phase 17 (owner, 2026-11-20)

1. **Phase 18:** Labs, and Sports & activities.
2. **Phase 19:** Placements, and Reports & exports (saved reports, background exports).
3. **Phase 20 — SaaS billing for institutions** (added by the owner on 2026-11-20, before release). Plans, subscriptions, trials and module switches already exist (P0); what is missing is charging the institutions and acting on expiry. Planned scope, to be detailed and confirmed before building:
   - **Invoices to institutions:** an invoice for each subscription (plan × students, GST), numbered and printable, with a running statement per institution in the platform console.
   - **Recording payments:** bank transfer / UPI / cheque entered by the platform owner; online payment is "Coming soon" until a gateway is chosen.
   - **Renewal & expiry:** reminders to the institution admin before the end date; after the end date a grace period, then the institution becomes read-only (SUSPENDED) automatically; reactivated when paid.
   - **Student-count true-up:** compare active students against the subscribed count and show the difference.
   - Not in scope: self sign-up, a custom web address per institution.
4. Then university CBCS (credits, SGPA / CGPA, backlogs).

## 3. Parallelisation guidance
After P0, P1/P2 (academic track) and the P3 setup work (COA, posting engine) can proceed in parallel with separate owners. P5/P6/P7 are largely independent once P3's posting service is stable.
