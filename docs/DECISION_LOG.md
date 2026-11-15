# Decision Log

## 1. Closed decisions

| ID | Decision | Basis | Date |
|---|---|---|---|
| CD-01 | Backend = **NestJS/TypeScript** (not Spring Boot) | Master prompt §4 closes DOC §22 open item | 2026-11-13 |
| CD-02 | Architecture = **modular monolith**, no premature microservices | DOC §1, §7; prompt §4 | 2026-11-13 |
| CD-03 | DB = PostgreSQL with RLS + tenant-aware FKs | DOC §7; prompt §4 | 2026-11-13 |
| CD-04 | Web = Next.js + React + TS + Tailwind + RHF + Zod + TanStack Query | Prompt §4 | 2026-11-13 |
| CD-05 | Tests = Jest, Supertest, Playwright | Prompt §4 | 2026-11-13 |
| CD-06 | DEC-01 accepted: **pnpm workspaces + Turborepo**; `apps/{api,web}`, `packages/{shared,db}` ([ADR-001](adr/ADR-001-monorepo.md)) | Owner approved start of phases with recommended defaults | 2026-11-13 |
| CD-07 | DEC-02 accepted: **Prisma 6** + hand-written SQL in migrations for RLS/CHECK/special indexes ([ADR-002](adr/ADR-002-prisma-with-raw-sql.md)) | same | 2026-11-13 |
| CD-08 | DEC-05 accepted: **shared DB + RLS**, transaction-local context, runtime role without BYPASSRLS; campus scope in the app layer ([ADR-003](adr/ADR-003-tenant-isolation.md)) | same | 2026-11-13 |
| CD-09 | DEC-08 accepted: **in-house auth**: argon2id, 15-min JWT, rotating refresh token in httpOnly cookie with reuse detection ([ADR-004](adr/ADR-004-auth-sessions.md)). OTP/TOTP come later in B1 | same | 2026-11-13 |
| CD-10 | DEC-16 accepted: git repo initialised (`main`); CI = **GitHub Actions** (`.github/workflows/ci.yml`) | same | 2026-11-13 |
| CD-11 | DEC-03 accepted in principle (**outbox + pg-boss**); implemented with the jobs/notifications core (M0.2) | same | 2026-11-13 |
| CD-12 | Platform staff identified by `users.platform_role` (SUPER_ADMIN / SUPPORT) instead of a PLATFORM membership type | M0.1 build; avoids a fake "platform tenant" | 2026-11-13 |
| CD-14 | DEC-07 accepted: approvals engine, numbering, outbox, settings registry, import framework and entitlements are P0 foundations, built in M0.2–M0.3. Legal entities (G-01) stay out of v1 as already agreed in the table design | Owner approved M0.2 ("go") | 2026-11-14 |
| CD-15 | DEC-04 accepted: production on **AWS ap-south-1 (Mumbai)**. Files go through a `StorageDriver` interface: **local disk** in dev/test, **S3** in production (the S3 driver is written with the infra work, when a bucket exists to test it against). MinIO dropped (image no longer published) | same | 2026-11-14 |
| CD-16 | DEC-03 confirmed: **transactional outbox + pg-boss** in the same Postgres; a separate `apps/worker` process dispatches events and runs jobs ([ADR-006](adr/ADR-006-outbox-and-jobs.md)) | same | 2026-11-14 |
| CD-17 | Platform-level outbox events: `outbox_events.tenant_id` may be NULL for `auth.*` events only (password reset). Tenants can neither see nor write them; only the system worker processes them. Account-link tokens are created by the worker, so the raw token exists only in the email | M0.3 build | 2026-11-14 |
| CD-18 | Design system implemented in plain CSS tokens + shared React components (PageHeader, Modal, StatusBadge, EmptyState, StatTile, toasts) with the navy & gold brand (Playfair Display + Manrope, self-hosted). Supersedes the Tailwind part of CD-04/CD-13; React Hook Form / TanStack Query still to be decided when forms and tables grow (M0.4) | Owner asked for consistent, polished UI across all screens | 2026-11-14 |
| CD-19 | Screen translations in-house: typed dictionaries (`apps/web/src/lib/i18n/messages.ts`, English source, Kannada must have every key — enforced by TypeScript) and a small provider. No i18n library yet; revisit (e.g. next-intl) if we need plural rules beyond en/kn or translator tooling. Kannada text uses Noto Sans Kannada; tracking/upper-casing disabled for Kannada | M0.4 | 2026-11-14 |
| CD-20 | DEC-15 applied: Aadhaar stored as **last 4 digits only** (CHAR(4) + CHECK); a full 12-digit entry is refused with a message, never silently cut. A vault reference can be added later if a pilot needs it | M1.2 | 2026-11-15 |
| CD-21 | Parents are shared records: on enrolment the contact parent is matched by **mobile number**; if a sibling already studies here, that family's guardians are re-used (no duplicates). Father/mother/guardian names from the application become guardian records; only the contact parent carries the phone | M1.2 | 2026-11-15 |
| CD-22 | Duplicate check = same parent mobile + same date of birth, or same mobile + similar name (trigram similarity ≥ 0.45). Same mobile with a different child is treated as a sibling, not a duplicate. Staff may continue only with a written reason, which is stored and audited | M1.2 | 2026-11-15 |
| CD-23 | Enquiry, application and admission numbers: if the school has not set up a series, a default institution-wide one is created on first use (`ENQ/2026-27/0001`, `APP/…`, `ADM/…`), still gapless. A school can define its own series beforehand through the numbering API (no screen for it yet — noted as a follow-up) | M1.2 | 2026-11-15 |
| CD-24 | Student statuses changed by staff: ACTIVE, INACTIVE (temporary absence — seat kept) and DROPPED (discontinued — seat freed, enrolment closed as LEFT). TRANSFERRED and PASSED_OUT only through the Transfer Certificate and promotion (M1.4). Re-joining after DROPPED needs a section with a free seat. History rows are permanent | M1.3 | 2026-11-15 |
| CD-25 | Section change stays within the same class and academic year; the old enrolment is kept as MOVED with an end date, so there is always exactly one ACTIVE enrolment. Moving to another class is promotion (M1.4) | M1.3 | 2026-11-15 |
| CD-26 | A parent's mobile identifies the family: adding a parent whose mobile is already on record is refused with the match, and staff link the existing parent instead. Edits to a shared parent show for every child. Removing a parent only removes the link; the main contact cannot be removed until another parent is made main contact | M1.3 | 2026-11-15 |
| CD-27 | Student import places students in the **current** academic year; existing admission numbers are kept, blank ones get the next number. An older admission date is kept on the student; the enrolment starts on the first day of the current year | M1.3 | 2026-11-15 |
| CD-28 | DEC-09 (payment part) decided by the owner: **Razorpay** is the first payment gateway, behind an adapter interface so others can be added. Built and tested in test mode; live keys only in server environment settings, never in code | B1 Phase 2 | 2026-11-15 |
| CD-29 | Fees phase approved by the owner (roadmap §2c, M2.1–M2.5, AC29–AC33). Money held as NUMERIC(14,2) and calculated in paise; GST is a flag on the fee head only until DEC-14 is decided | B1 Phase 2 | 2026-11-15 |
| CD-30 | Fee structures: one per class + academic year + optional free-text **fee group** (e.g. "New admission", "Management quota"); once active, amounts never change — a **revision** (draft copy) replaces it on activation, so bills always match a fixed version. Blank grid cells are "not charged", not ₹0 lines | M2.1 | 2026-11-15 |
| CD-31 | Fee heads are institution-wide (same codes on every campus, used on receipts); only fee managers with all-campus scope may create or change them. Structures and late-fee rules follow campus scope | M2.1 | 2026-11-15 |
| CD-32 | Accounts: a 22-account starter chart is created per institution on first fee use; system accounts are found by `system_key` so schools can rename / renumber them. Fee heads default to the income account of their type (deposits → liability "Refundable deposits") | M2.1 | 2026-11-15 |
| CD-33 | Bills are made per instalment by a billing run (one live bill per student, year and instalment; repeat-safe); a wrong bill is cancelled with a reason and its posting reversed, never deleted. A bill fully covered by concessions is marked settled (shown as "Waived") | M2.2 | 2026-11-15 |
| CD-34 | Concessions need an approval rule: with no approver configured the request is refused with a message (no self-approval). An approved concession applies to new bills and to that year's bills with nothing paid yet (adjustment posting); partly or fully paid bills are not changed (credit / refund comes with collection) | M2.2 | 2026-11-15 |
| CD-35 | Approvals engine gains a completion hook: a business module (fees) updates its record inside the same transaction as the final decision, so it never lags; the outbox event and notifications are unchanged | M2.2 | 2026-11-15 |
| CD-36 | A cheque / DD gets a receipt when handed over (held in "Cheques / DD in hand"); a bounce marks the receipt BOUNCED, reverses the posting, reopens the dues and may bill a bounce charge. Bank deposit and reconciliation come later (P3) | M2.3 | 2026-11-15 |
| CD-37 | Cash can only be taken inside an open cashier counter (one per cashier); other modes may be recorded without one. A counter closes with counted cash; a difference must be explained in remarks | M2.3 | 2026-11-15 |
| CD-38 | Payment allocation: chosen bills in order, else oldest due first; within a bill tuition / academic fees first, then admission, exam, transport / hostel, other, fines, and refundable deposits last. Overpayment is refused (advance payments come later) | M2.3 | 2026-11-15 |
| CD-39 | Receipt numbers follow the financial year (RCT/2026-27/0001) and are given only to successful payments; receipts are never edited — only cancelled or bounced with a reason (DB trigger) | M2.3 | 2026-11-15 |
| CD-40 | Gateway behind an adapter; Razorpay is used when its three keys are in the environment, otherwise a simulated gateway in development / tests (never in production, where online payment is off without keys). Keys are never stored in code or the database | M2.4 | 2026-11-15 |
| CD-41 | Interim parent payment = a secure link (random 24-byte token, only its hash stored, 1–30 days) to a public page; the parent portal (B3) will reuse the same order / confirm / webhook flow | M2.4 | 2026-11-15 |
| CD-42 | A receipt only for a captured payment, confirmed server-to-server: browser confirmation (checkout signature + fetch), webhook (signature over the raw body) and a worker re-check all go through one locked "settle" step, so one gateway payment = one receipt | M2.4 | 2026-11-15 |
| CD-43 | Money already taken online is never refused: beyond the link's bills it pays the student's other open bills, then is held as "fees received in advance" (liability) | M2.4 | 2026-11-15 |
| CD-44 | Refunds need an approval rule (REFUND); an approved refund reopens that much of the receipt's dues (deposits and fines first) and posts the reversal. Online refunds go back through the gateway first; a gateway error leaves everything unchanged (refund FAILED). Online receipts are refunded, never cancelled | M2.4 | 2026-11-15 |
| CD-45 | Late fee per bill line from the most specific active rule (fee head + campus > fee head > campus > all); based on the line's unpaid fees (payments cover fees before fines); a fine never decreases automatically and the daily pass is repeat-safe; a waived bill never gets a late fee again | M2.5 | 2026-11-15 |
| CD-46 | Reminders are sent on demand (selected students), by email only until an SMS / WhatsApp provider is chosen (DEC-09); a 14-day payment link is included when online payment is on | M2.5 | 2026-11-15 |
| CD-47 | "No dues" = no open balance and no pending refund. Uncleared cheques are treated as paid until bounced (bank reconciliation comes later) | M2.5 | 2026-11-15 |
| CD-13 | M0.1 web uses plain CSS + shared Zod schemas. Tailwind, React Hook Form and TanStack Query (CD-04) arrive with the design-system kit in M0.2 | Keep the walking skeleton small | 2026-11-13 |

DEC-01, 02, 05, 08 and 16 below are now **closed** (see CD-06…CD-10). DEC-07: the agreed table design ([tables/B1_core.md](tables/B1_core.md)) already includes the approvals engine, numbering, settings and entitlements; legal entities are not in v1 scope.

## 2. Open decisions requiring approval

Each lists a **recommendation**. ⛔ = blocks Phase 0 start.

| ID | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| DEC-01 ⛔ | Monorepo tooling & layout | pnpm+Turborepo / Nx / separate repos | **pnpm + Turborepo**, structure in ARCHITECTURE §8 | P0 |
| DEC-02 ⛔ | Data access | Prisma (+raw SQL migrations) / Kysely / Drizzle | **Prisma**, with raw SQL for RLS/constraints; validate in the M0.1 spike; Kysely fallback | P0 |
| DEC-03 ⛔ | Job queue / eventing | pg-boss (Postgres) / BullMQ (Redis) / cloud queue | **Transactional outbox + pg-boss**; revisit at scale | P0 |
| DEC-04 ⛔ | Cloud provider | AWS / Azure / GCP | **AWS ap-south-1 (Mumbai)** (managed PG, S3, KMS); local dev cloud-agnostic | P0 infra (not M0.1 code) |
| DEC-05 ⛔ | Tenancy isolation | Shared DB + RLS / schema-per-tenant / DB-per-tenant | **Shared DB + RLS** (DOC §22), dedicated-DB path kept; **5b:** campus scope enforced in the app layer, not RLS, initially | P0 |
| DEC-06 | Mobile stack | Flutter (DOC §8) / React Native-Expo (shared TS) | Keep **Flutter** per DOC *unless* the team lacks Dart skills; either way **parent PWA first** | P8 |
| DEC-07 ⛔ | Adopt platform enhancements G-01 (legal entities), G-04 (approvals engine), G-05 (numbering), G-06 (outbox), G-07 (identity model), G-11 (settings), G-12 (import), G-13 (entitlements) into P0 scope | Yes / defer some | **Approve all**: they are foundations for later modules | P0 |
| DEC-08 ⛔ | Authentication | In-house (NestJS) / Keycloak / managed IdP (Auth0, Cognito) | **In-house** JWT + rotating refresh + TOTP + SMS OTP; SSO adapter later | P0 |
| DEC-09 | Providers: payment, SMS, WhatsApp BSP, email, GPS, biometric | e.g. Razorpay/PayU/Cashfree; MSG91/Gupshup; AWS SES | Shortlist in discovery; adapter interface first; first gateway chosen before P3 | P3/P8 |
| DEC-10 | Data residency | India-only / flexible | **India-only** hosting and backups | P0 infra |
| DEC-11 | SaaS billing of tenants | Build / Razorpay Subscriptions / Chargebee | **Use a provider**; P0 stores plans/subscriptions without live billing | P0 (later M0.4) |
| DEC-12 | NFR targets & retention (REQUIREMENTS §7, GPS retention 90 days raw) | — | Approve proposed initial targets | P0 |
| DEC-13 ⛔(P1) | Academic structure model (DATABASE_DESIGN §4) | As proposed / alternative | **Approve**, after validation with 1 school + 1 college SME | P1 |
| DEC-14 | Fee revenue recognition & deferral policy, GST applicability per fee head | — | Finance + tax expert decide; system supports both | P3 |
| DEC-15 | Aadhaar / government ID storage policy | Don't store / masked / vault | **Masked last-4 + optional vault reference** | P1 |
| DEC-16 | Source control & CI platform; git init of this repo | GitHub Actions / GitLab / Azure DevOps | **GitHub + Actions** | P0 |
| DEC-17 | Pilot institution(s) and domain owners | — | Name before P1 discovery | P1 |
| DEC-18 | Roadmap order Finance (P3) before Exams (P4) (resolves D-05) | DOC §24 order / DOC §20 order | **DOC §24 order** | P3/P4 |
| DEC-19 | Enhancements G-21…G-32 and the "Could" list (discipline, health, visitors, alumni) | Approve / defer | Approve G-21…G-28 into their phases; defer G-29 to post-P6 | Various |
| DEC-20 | Languages beyond English for v1 | — | en-IN only; i18n-ready | P8 |

## 3. Proposed ADRs (written at M0.1)
ADR-001 Modular monolith & module boundaries · ADR-002 Tenancy & RLS context binding · ADR-003 Tenant-bound tokens & refresh rotation · ADR-004 Outbox & job processing · ADR-005 Money & decimal handling · ADR-006 Approvals engine · ADR-007 Numbering service · ADR-008 Academic structure model · ADR-009 Posting service & accounting gateway.
