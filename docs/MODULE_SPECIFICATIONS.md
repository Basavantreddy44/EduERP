# Module Specifications

This document holds the module and submodule breakdown and the dependency matrix. A **full module spec pack** (all 19 items required by the master prompt, §3 below) is written *before* each module's phase begins and is appended here or linked as `docs/modules/<module>.md`.

Module codes are used as code-folder and permission prefixes.

## 1. Module & submodule breakdown

### M00 — Platform Core `platform` [ENH, required by all modules]
| Submodule | Responsibilities |
|---|---|
| identity | Users, credentials (argon2id), OTP, MFA (TOTP), sessions and refresh-token rotation, devices, login history |
| access | Roles, permissions, role templates, user-role-scope assignments, ABAC policy evaluation, access reviews |
| tenancy-context | Tenant/campus context resolution, RLS session binding, entitlement guard |
| audit | Append-only audit log, hash chain, audit search |
| settings | Typed settings registry, scope resolution, effective dating |
| numbering | Document sequences (G-05) |
| approvals | Policies, requests, steps, delegation, escalation, SLA (G-04) |
| files | Upload (presigned), malware-scan hook, versions, access grants, signed download |
| events-jobs | Transactional outbox, job queue, scheduler, dead letters, replay |
| notifications-core | Templates, in-app notifications, email channel; channel adapter interface |
| import-export | Import jobs (staging/validate/dry-run/commit), export jobs (async, signed URL, logged) |
| reference-data | Countries, states, languages, currencies, religions/categories (configurable lists) |

### M01 — SaaS Administration `saas` [DOC §4.1]
Tenant registry & lifecycle · plans & feature catalogue · subscriptions, trials, renewals, grace · platform invoices and failed-payment retries (DEC-11) · quotas and usage metering · custom domains · support tickets and **support elevation** · tenant data export and offboarding · platform health.

### M02 — Institution & Campus `org` [DOC §4.2]
Institution profile (legal identity, branding) · **legal entities** [ENH G-01] · campuses (timezone, address, codes) · departments · academic units · cost centres · holidays & calendars · document numbering config · approval policy config · campus overrides.

### M03 — Admissions & Enquiry CRM `admissions` [DOC §4.3]
Lead sources & campaigns · enquiries & follow-ups · admission cycles (per year/campus/programme, seat matrix) · configurable application forms · public applicant portal (OTP) · duplicate detection · eligibility rules · document checklist & verification · application fee · review/interview/entrance stages & scoring · committee decision · waitlist · offers & acceptance · conversion to student (calls M04).

### M04 — Student Information System `students` [DOC §4.4]
Student master (number, identity, demographics) · guardians & relationships with access scopes · emergency contacts · restricted medical notes · prior education · external identifiers (UDISE+, APAAR, ABC, board reg.) [ENH G-17] · documents · enrolments (effective-dated) · status history · transfers (campus/section/programme) · withdrawal & TC · alumni status · certificates (requests → issue → QR verify) · lifecycle timeline.

### M05 — Academic Management `academics` [DOC §4.5]
Academic years & terms · boards/universities · programmes & levels · student groups (section/batch/cohort) · courses/subjects (credits, type, electives, prerequisites) · programme curriculum · course offerings & faculty assignment · elective selection · academic calendar · promotion rules · **rollover wizard** [ENH].

### M06 — Timetable `timetable` [DOC §4.6]
Rooms & resources · period/bell schedules · teacher availability & workload limits · timetable builder (manual + assisted) · conflict detection (teacher/room/group) · versions & publication · exceptions (holidays/events) · substitutions · change notifications.

### M07 — Learning & Assignments `learning` [DOC §4.7]
Lesson plans & syllabus coverage · resources · assignments (windows, attachments, late policy) · submissions & resubmission · rubrics & criteria · feedback & grading · plagiarism adapter (optional) · LMS adapter (optional) · class notices.

### M08 — Attendance `attendance` [DOC §4.8]
Attendance rules (daily/period, late/half-day thresholds) · session generation from the timetable or a daily register · marking (manual, bulk) · device registry & event ingestion (QR/RFID/biometric) · GPS/geofence for staff where enabled · unified leave engine (student + staff) [D-08] · corrections with approval · missing-register tracking · parent alerts · summaries & eligibility % · staff attendance.

### M09 — Examinations & Results `exams` [DOC §4.9]
Assessment schemes & components (theory/practical/internal) · grading scales & versioned rules (GPA/CGPA, rounding) · exam definitions & schedules · registration & eligibility (attendance, dues) · hall tickets · seating plans · invigilators · marks entry (grid/import) with absent/malpractice codes · verification & moderation · result calculation (versioned) · approval & scheduled publication · revaluation · supplementary exams · report cards / marksheets / transcripts [ENH G-23].

### M10 — Fees `fees` [DOC §4.10]
Fee heads (→ GL mapping) · fee structures & lines (by programme/level/category) · instalment plans & due dates · student fee assignment (with proration [ENH]) · concessions, scholarships, sibling discounts (approval) · late-fee rules · invoice runs · payment orders (online) & webhooks · offline collection desk · **cashier sessions** & instruments [ENH G-21] · allocation & advances/credits · receipts · refunds & reversals · write-offs · reminders & dunning · arrears/ageing · gateway reconciliation.

### M11 — Accounting & Finance `accounting` [DOC §4.11, §15]
Chart of accounts (per legal entity) · fiscal years & periods (open/soft-close/closed) · journals (manual + system, maker-checker) · posting service (single gateway for all modules) · general ledger · AR subledger (students, others) · AP (vendors, bills, payments, TDS [ENH]) · cash & bank · bank statement import & matching · fixed assets & depreciation · budgets & commitments [ENH G-26] · tax codes & registers · financial statements (TB, P&L, BS, cash flow) · period close checklist.

### M12 — HR & Payroll `hr` / `payroll` [DOC §4.12]
Recruitment (requisitions, candidates — light) · onboarding checklist · employee master, designations, departments · contracts & salary history · qualifications & documents · shifts & staff attendance (via M08) · leave policies & balances (via the unified leave engine) · substitutions (via M06) · salary structures & components (formula-based, effective-dated) · loans & advances · payroll runs (inputs freeze → calculate → review → approve → disburse) · payslips · bank files · statutory outputs (PF/ESI/PT/TDS, config-driven) · exit settlement.

### M13 — Hostel `hostel` [DOC §4.13]
Hostel/building/floor/room/bed inventory · applications & eligibility · waitlist · allotment & bed reservation expiry · deposits & recurring charges (→ M10) · check-in/out with condition & inventory · room changes · outpasses · visitors · curfew exceptions · mess plans · incidents · maintenance requests · occupancy dashboard.

### M14 — Transport `transport` [DOC §4.14]
Vehicles & compliance documents (expiry alerts) · drivers & attendants · routes, stops, capacity · student route assignment (→ M10 charges) · trip schedules & trips · driver app events (start/stop, pickup/drop) · GPS devices & location ingestion (P8) · geofences, stale/jump detection · deviations, breakdowns, SOS · parent tracking window · utilisation reports.

### M15 — Library `library` [DOC §4.15]
Branches · titles (ISBN lookup), authors, publishers, editions · copies & barcodes · members & policies · issue/return/renew · reservations & holds · overdue & fines (→ M10 or library cash) · lost/damaged · stock verification · digital resources · circulation analytics.

### M16 — Procurement & Inventory `procurement` / `inventory` [DOC §4.16]
Items, categories, UoM · suppliers (KYC, GSTIN) · warehouses & stock locations · purchase requests (budget check) · RFQ & quotations · comparative statements · purchase orders · goods receipts with QC (ordered/received/accepted/rejected) · stock ledger (moving-average valuation [ASM]) · issues, transfers, returns · reorder levels · stock counts · 3-way match → AP bill (M11) · capitalisation → fixed assets [ENH G-27].

### M17 — Communication `comms` [DOC §4.17]
Announcements & audience builder · templates (multi-language, channel-specific, WhatsApp-approved templates) · notification dispatch (email, SMS, WhatsApp, push, in-app) · preferences & consent/opt-out · quiet hours · delivery receipts & retries · provider failover · emergency broadcast · history · moderated parent–teacher messaging [ENH G-30].

### M18 — Documents & Certificates `documents` [DOC §4.18]
Document types (required fields, expiry, sensitivity) · versioned uploads · verification status · expiry reminders · certificate templates · serial numbering · issue & revoke · **public QR verification page** · download logs · retention rules.

### M19 — Analytics & Dashboards `analytics` [DOC §4.19, §17]
Role dashboards · governed metric layer (tenant-scoped) · standard reports per module · report builder (later) · scheduled reports · exports (via M00) · AI features (forecasts, alerts, NL analytics) with a model registry and prediction audit.

### M20 — Compliance & Audit `compliance` [DOC §4.20, §16]
Audit search & evidence packs · access reviews · consent records · data-subject requests (access/correction/erasure) · retention schedules & legal holds · incident register · export logs · policy acknowledgements · support-access log.

## 2. Cross-module dependency matrix

Read across: **row module depends on column module**. **H** = hard dependency (cannot work without it) · **S** = soft/optional integration · **E** = emits events consumed by the column module.

| ↓ depends on → | M00 | M01 | M02 | M03 | M04 | M05 | M06 | M08 | M09 | M10 | M11 | M12 | M16 | M17 | M18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M01 SaaS | H | – | E | | | | | | | | | | | S | |
| M02 Org | H | H | – | | | | | | | | | | | | |
| M03 Admissions | H | | H | – | E/H | H | | | | H | | | | S | H |
| M04 Students | H | | H | | – | H | | | | E | | | | S | H |
| M05 Academics | H | | H | | | – | | | | | | S | | | |
| M06 Timetable | H | | H | | | H | – | | | | | H | | S | |
| M07 Learning | H | | | | H | H | S | | S | | | H | | S | H |
| M08 Attendance | H | | H | | H | H | H | – | E | | | E | | S | |
| M09 Exams | H | | H | | H | H | S | S | – | S | | H | | S | H |
| M10 Fees | H | | H | | H | H | | | | – | **H** | | | S | |
| M11 Accounting | H | | H | | | | | | | | – | | | | H |
| M12 HR/Payroll | H | | H | | | | S | H | | | **H** | – | | S | H |
| M13 Hostel | H | | H | | H | | | S | | H | | S | S | S | |
| M14 Transport | H | | H | | H | | | S | | H | | H | S | S | H |
| M15 Library | H | | H | | H | | | | | S | | S | S | S | |
| M16 Proc/Inv | H | | H | | | | | | | | **H** | S | – | S | H |
| M17 Comms | H | H | H | | S | | | | | | | | | – | |
| M19 Analytics | H | | H | S | S | S | S | S | S | S | S | S | S | | |
| M20 Compliance | H | | H | S | S | | | | | | | S | | | H |

**Key integration seams (owner → consumer; detailed contracts in [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) §3):**
1. Admissions → Students: `admission.offer.accepted` → enrolment command (single transaction).
2. Students/Academics → Fees: enrolment created/changed → fee assignment proposal.
3. Fees → Accounting: invoice/payment/refund → `PostingService.post()` (same transaction, idempotent by source).
4. Timetable → Attendance: published timetable → session generation.
5. Attendance + Fees → Exams: eligibility checks (attendance %, dues), as configured.
6. Attendance (staff) + Leave → Payroll: inputs frozen at payroll period close.
7. Procurement → Inventory → Accounting: GRN → stock ledger; vendor bill → AP journal; capital items → fixed assets.
8. Hostel/Transport/Library → Fees: charges via the fee assignment API (never direct invoice inserts).
9. All → Comms: notification requests via the outbox.
10. All → Audit: via a platform interceptor plus explicit domain audit events.

## 3. Module spec pack template (required before coding each module)

Each pack contains: 1 business purpose · 2 actors · 3 scope/out-of-scope · 4 functional requirements (story IDs `<MOD>-US-nnn` mapped to FR IDs) · 5 business rules (`<MOD>-BR-nnn`) · 6 workflows & state machines · 7 positive/negative scenarios · 8 field-level specs (→ DATA_DICTIONARY) · 9 validations (Zod schema refs) · 10 entities & relationships · 11 API specs (method, path, permission, request/response, errors, scope, transaction, audit) · 12 permission matrix rows · 13 screen specs (title, breadcrumbs, filters, search, sort, pagination, columns, forms, validation messages, actions, states, responsive) · 14 UI notes · 15 integration dependencies · 16 audit events · 17 acceptance criteria · 18 unit/integration test cases · 19 E2E scenarios.
