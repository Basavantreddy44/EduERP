# Requirements Analysis & Enhanced Specification

Tags: **[DOC §n]** from the spec · **[ENH]** recommended enhancement · **[ASM]** assumption · **[DEC-nn]** open decision (see [DECISION_LOG.md](DECISION_LOG.md)).

---

## 1. Requirements analysis: what the document gives us

| Area | Coverage in PDF | Assessment |
|---|---|---|
| Vision, principles, scope, out-of-scope | §1–2 | **Strong.** Clear and usable as-is |
| Personas and permission model (RBAC + ABAC, SoD) | §3 | **Good** principles. Role catalogue is incomplete (see G-03) |
| Module catalogue (20 modules) | §4 | **Good breadth.** Each module is a feature list, not a specification (no fields, rules or states) |
| Workflows (8) and edge cases (15) | §5 | **Good.** Missing workflows: rollover/promotion, withdrawal, staff onboarding/exit, library circulation, certificates, communication (G-10) |
| Functional requirements | §6 | **Thin.** 16 one-line FRs. Must be expanded into per-module stories (done in §6 below at FR level) |
| Architecture and tenancy | §7 | **Strong** on isolation. Silent on identity model, tenant resolution, eventing and the approvals engine |
| Stack | §8 | Leaves the backend choice open. **Closed by the master prompt: NestJS** |
| Data design | §9–10 | Conventions are strong. The table catalogue is a name list only, and is **garbled in the PDF** (D-01) |
| API catalogue | §11 | Representative only. Some ambiguous paths (D-04) |
| Screens / UX | §12 | Inventory plus 6 wireframe descriptions. No navigation model or design system |
| Mobile | §13 | Good security rules. Mobile stack (Flutter) differs in toolchain from web (DEC-06) |
| Integrations | §14 | Good control list. Providers not chosen (DEC-09) |
| Accounting | §15 | **Strong** invariants. Missing *legal entity / books* concept (G-01) and fiscal vs academic year (G-02) |
| Security, privacy, India compliance | §16 | Good baseline. Needs concrete DPDP mechanics: verifiable parental consent, Aadhaar handling (G-15, G-16) |
| AI | §17 | Good guardrails |
| NFRs | §18 | Attributes only, no numbers. Targets are DEC-12 |
| Testing, rollout, ops, risks, governance, backlog | §19–25 | Good |

## 2. Defects and inconsistencies in the source document

| ID | Defect | Impact | Resolution |
|---|---|---|---|
| D-01 | §9 "Core table catalogue" is rendered character-by-character ("t, e, n, a, n, t, s, ,"). | Unreadable for readers. Table names are still recoverable | Recovered and normalised in [DATABASE_DESIGN.md](DATABASE_DESIGN.md). Fix the PDF generator |
| D-02 | Contents lists §10 as "Core database entities and relationships", but the body §10 is "Database integrity, indexing and migration strategy". | Navigation confusion | Treat the body title as correct |
| D-03 | "P&L;" appears in §4.11 and §15 (HTML-entity artifact). | Cosmetic | Read as "P&L" |
| D-04 | §11 abbreviates paths such as `POST /{id}/review`, `POST /{id}/approve` and `POST /{id}/disburse` without a resource. | Ambiguous contracts | Normalised to full resource paths in [API_DOCUMENTATION.md](API_DOCUMENTATION.md) |
| D-05 | §20 roadmap puts **exams in Month 4, before fees (Month 5)**. §24 backlog puts **Finance (MVP 2) before Academic outcomes (MVP 3)**. | Conflicting order | **Recommend the §24 order** (Finance before Exams), because fee dues gate exam eligibility (§5.3 step 2) and hall tickets. See Roadmap |
| D-06 | §5.3 refers to a "Controller/authorised approver" (Controller of Examinations), and §5.8/§4.16 to procurement. Neither has a persona in §3. | Missing roles | Added in [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md) |
| D-07 | §3 says the Accountant is scoped to "assigned finance entities". No finance entity exists in the data model. | Model gap | G-01 |
| D-08 | `leave_requests` sits in the Attendance group and `employee_leaves` in HR. It is unclear whether student leave and staff leave are one model. | Duplication risk | One leave engine with `subject_type` (student or employee) and separate policies. See DATABASE_DESIGN |

## 3. Gap analysis: existing versus missing requirements

Each gap lists **what is missing → why it matters → recommendation → affected module/phase**.

### Platform & architecture gaps

| ID | Missing | Why it matters | Recommendation | Affects |
|---|---|---|---|---|
| G-01 | **Legal entity / books of account.** Indian trusts and societies often run a school and a college as separate legal and tax entities with separate books, GSTINs and PAN/TAN. | A tenant-wide single ledger would produce wrong financial statements. §3 already mentions "finance entities". | Add `legal_entities` (tenant 1–many). Each campus maps to one legal entity. COA, periods, journals, bank accounts, numbering and GST registrations are all **per legal entity**. Inter-entity transactions use due-to/due-from accounts. **[ENH]** | Org (P0), Accounting (P3) |
| G-02 | **Fiscal year vs academic year.** In India the fiscal year runs Apr–Mar and academic years often run Jun–May or Jul–Jun. | Fee revenue spans fiscal years. Deferred income and period close must not depend on the academic year. | Keep separate `fiscal_years`/`accounting_periods` and `academic_years`. Revenue recognition schedule per fee head is configurable (DEC-14). **[ENH]** | Fees, Accounting (P3) |
| G-03 | **Incomplete role catalogue.** Missing: Exam Controller, Class Teacher, Cashier, Finance Approver/Controller, Payroll Officer, Store/Procurement Officer, Front Office, Applicant, DPO/Compliance Officer, Platform Support. | SoD and maker-checker cannot be configured without these roles. | Seed **role templates** (editable per tenant). See ROLE_PERMISSION_MATRIX. **[ENH]** | Identity (P0) |
| G-04 | **Generic approvals/workflow engine.** Approvals appear in about 25 places, but there are no tables or design for them. | Without a shared engine each module re-implements approvals inconsistently, and the SLA metric in §2 becomes impossible. | Platform `approval_policies` (conditions such as amount thresholds and campus), multi-step `approval_requests`/`approval_steps`, delegation, escalation, SLA timers, self-approval block (SoD). **[ENH]** | Platform (P0) |
| G-05 | **Document numbering service.** §4.2 mentions it, but there is no design. GST invoices need unique consecutive numbers per fiscal year. | Duplicate or gapped receipt numbers are an audit and tax finding. | `number_sequences` scoped by tenant, legal entity, campus, document type and fiscal year, with a pattern template. Allocated with a row lock **inside** the business transaction. Gapless where configured. **[ENH]** | Platform (P0) |
| G-06 | **Cross-module eventing.** The spec requires "fee payment → journal", "admission → enrolment" and so on, but has no event or outbox design. | Dual writes and lost events break reconciliation. | **Transactional outbox** table written in the same DB transaction, dispatched to a durable job queue, with idempotent consumers. Synchronous in-process calls are allowed where one transaction is required (for example receipt and journal). **[ENH]** | Platform (P0) |
| G-07 | **Identity model across tenants.** A person can be a parent at Tenant A and a teacher at Tenant B. A guardian can also be staff. | Duplicate logins and broken linking. | Global `users` (credentials only). Tenant-scoped `user_tenants` membership. Tenant-scoped domain records (`students`, `guardians`, `employees`) carry an optional `user_id`. **Access tokens are issued per tenant membership.** **[ENH]** | Identity (P0) |
| G-08 | **Tenant resolution and login UX.** | Users need to land in the right tenant, and custom domains (§4.1) need routing. | Resolve the tenant by subdomain or custom domain, or show a tenant picker after login. The token carries the active tenant. Switching tenant re-issues the token. **[ENH]** | P0 |
| G-09 | **Phone-first authentication for guardians.** The PDF assumes email. | Many Indian parents do not use email actively. | Login by mobile OTP for guardian/student roles, with rate limiting and SIM-swap-aware risk controls. Email+password+MFA for staff. **[ENH]**, DEC-08 | P0/P1 |
| G-10 | **Missing workflows:** academic-year rollover and promotion, student withdrawal and TC issue, staff onboarding and exit, library circulation, certificate issue and verification, bulk import, tenant offboarding. | These are among the riskiest year-end and lifecycle events. | Specified in [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) W-09…W-16. **[ENH]** | Various |
| G-11 | **Settings hierarchy model.** "Tenant defaults with campus overrides" (§4.2) has no design. | Settings become scattered across modules. | Typed settings registry (key, schema, scope levels allowed, default). Resolution order: platform → tenant → legal entity → campus. Effective-dated where flagged. Audited. **[ENH]** | P0 |
| G-12 | **Bulk import framework.** Only "CSV templates" is mentioned. | Migration and onboarding depend on it (§20). | `import_jobs` with upload → staging → validate (row-level errors) → dry-run → commit, all idempotent and tenant-scoped. **[ENH]** | P0 (framework), each module adds importers |
| G-13 | **Feature entitlement and quota enforcement.** | Plans must actually gate modules and student counts. | Entitlement guard on API routes and menu items. Quota checks such as active students and SMS credits. **[ENH]** | P0 |
| G-14 | **Unified academic structure model.** The spec says not to force one hierarchy, but proposes no model. | This is the biggest modelling risk in the product. | See DATABASE_DESIGN §4: `programmes` → `programme_levels` (Grade 5 / Semester 3) → `student_groups` (section/batch) plus `courses` (subjects) → `course_offerings` (course × group × term × faculty). Institution-type templates seed it. **[ENH]**, DEC-13 | P1 |

### Compliance & data gaps (India)

| ID | Missing | Why it matters | Recommendation | Affects |
|---|---|---|---|---|
| G-15 | **Verifiable parental consent** (DPDP Act 2023 s.9 for children's data), and a consent-manager approach. | Most data subjects are children. | Consent module: purpose catalogue, consent capture with guardian verification evidence, withdrawal, purpose-bound processing checks. Subject to legal review **[ASM]** | P0 (model), P1 (capture) |
| G-16 | **Aadhaar / government ID handling.** | Storing Aadhaar has strict restrictions. | Do not store full Aadhaar by default. Store only masked (last 4) or a reference/vault token. Encrypt any ID numbers at field level. Legal confirmation required. **[ENH]**, DEC-15 | P1 |
| G-17 | **Indian education identifiers and portals:** UDISE+, APAAR ID, ABC (Academic Bank of Credits), board registration numbers, scholarship portals (NSP). | Mandatory reporting for many institutions. | Generic "external identifier" table per student/institution, plus portal export adapters later. **[ENH]** | P1 (identifiers), P9 (exports) |
| G-18 | **CERT-In directions:** 6-hour incident reporting, log retention (180 days), NTP time sync. | Operational legal obligation for service providers in India. | Logging retention and incident runbook aligned to CERT-In. Legal confirmation. **[ASM]** | P0 ops, P10 |
| G-19 | **Data residency.** | DPDP cross-border rules and customer contracts. | Host in an India region by default. DEC-10 | P0 infra |
| G-20 | **Erasure vs statutory retention conflict.** | Erasure requests clash with financial and academic retention rules. | Retention policy per data class, legal hold, pseudonymisation instead of deletion where retention applies. **[ENH]** | P9, design from P0 |

### Functional gaps by module

| ID | Module | Missing | Recommendation |
|---|---|---|---|
| G-21 | Fees | Cash counter / cashier day-close, cheque/DD lifecycle (received → deposited → cleared/bounced), proration for mid-year joiners, fee-defaulter rules, fine/late-fee rule engine | Add cashier sessions with denomination-wise close, an instrument lifecycle, proration policy and a late-fee rule set **[ENH]** |
| G-22 | Fees | Indian gateways and UPI, payment links, auto-reconciliation from settlement reports | Gateway adapter interface (Razorpay / PayU / Cashfree candidates), settlement report import **[ENH]**, DEC-09 |
| G-23 | Exams (school) | Report cards in board formats (for example CBSE scholastic + co-scholastic), remarks, term-wise weighting | Configurable assessment scheme and report-card templates **[ENH]** |
| G-24 | Exams (college) | Credit-based registration, backlog/arrear tracking, CGPA rules, ABC credit sync | Versioned grading rules + registration rules **[DOC §4.9]** expanded |
| G-25 | Attendance | Student leave applications by parents; attendance-based exam eligibility thresholds | Unified leave engine + eligibility rule **[ENH]** |
| G-26 | Accounting | Budget commitment (encumbrance) when POs are approved; TDS on vendor payments; GST input/output registers | Commitment ledger, TDS sections config, tax registers **[ENH]**, validated by a tax expert |
| G-27 | Inventory ↔ Assets | Capitalising goods received into fixed assets | GRN line flagged "capital" creates an asset record **[ENH]** |
| G-28 | Payroll | State Professional Tax, PF/ESI challans, Form 16, gratuity and leave encashment at exit | Effective-dated statutory config; outputs validated by specialists **[DOC §15]**, expanded |
| G-29 | Student life (not in PDF) | Discipline/behaviour log, health/infirmary visits, counselling notes, campus visitor management and gate passes for day scholars | Candidate enhancements for after Phase 6 **[ENH]**, must be approved before adding |
| G-30 | Communication | Parent–teacher messaging rules (moderation, hours, retention); PTM scheduling | Moderated messaging + PTM slots **[ENH]** |
| G-31 | Search | Global search across students/staff/invoices | Postgres full-text + trigram first. External search only when needed **[ENH]** |
| G-32 | Platform billing | How the SaaS bills tenants (GST invoices to institutions) | Platform billing runs in the platform's own books. Use a billing/subscription provider, separate from tenant accounting **[ENH]**, DEC-11 |

## 4. Recommended additional features (prioritised)

| Priority | Feature | Rationale | Phase |
|---|---|---|---|
| Must (foundational) | Approvals engine, numbering service, outbox/events, settings registry, import framework, entitlements, legal entities | Every later module depends on them (G-01…G-13) | P0 |
| Must | Cashier session/day-close, instrument lifecycle, proration | Real-world fee desk operation in Indian schools | P3 |
| Must | Academic-year rollover & promotion wizard | Highest-risk annual operation | P2/P4 |
| Should | Parent web PWA before native apps | Faster parent adoption, and reuses the web stack | P8 (earlier if approved) |
| Should | Report-card designer (school), transcript designer (college) | Common requirement in tenders | P4 |
| Should | QR-verifiable certificates (TC, bonafide, marksheet) | §4.18 mentions QR; make it a public verification page | P4 |
| Could | Discipline, health, counselling, visitor management | Common ERP expectations, not in the PDF | Post-P6 |
| Could | Online admission-form builder | Reduces per-tenant customisation | P1 |
| Could | Alumni network and donations | §4.4 mentions alumni only as a status | Post-P9 |

## 5. Assumptions requiring confirmation

See [RISKS_AND_ASSUMPTIONS.md](RISKS_AND_ASSUMPTIONS.md) §2 (ASM-01…ASM-14). Key ones: India-first launch (INR, IST, GST, DPDP); English UI first with i18n-ready architecture; single currency per legal entity; the pilot is one tenant with 1–3 campuses.

## 6. Enhanced functional requirements specification

The 16 FRs in §6 are retained **verbatim in intent** and expanded. IDs FR-001…FR-016 are **[DOC §6]**. FR-1xx are **[ENH]** additions. Detailed stories per module are produced in the "module spec pack" before each phase (MODULE_SPECIFICATIONS §3 lists the required contents).

| ID | Requirement | Acceptance (testable) | Source |
|---|---|---|---|
| FR-001 | Tenant provisioning | Platform admin can create → configure → activate → suspend → reactivate → offboard a tenant. Every transition is audited. Suspended tenant behaviour follows the configured read/export grace policy. | DOC §6, §5 edge |
| FR-002 | Campus hierarchy | Tenant admin manages legal entities, campuses, departments and academic units. No cross-tenant visibility via UI, API, reports or files. | DOC §6 + G-01 |
| FR-003 | Academic model | School and college structures are configured independently through templates. A school tenant never sees credit/semester fields unless enabled. | DOC §6 + G-14 |
| FR-004 | Admission | Applicant submits and tracks status. Staff review per the configured workflow. Duplicate detection runs before submission. | DOC §6 |
| FR-005 | Student lifecycle | Only the approved enrolment transition creates an active enrolment. At most **one active enrolment per student per academic scope**, enforced by the DB. | DOC §6, §10 |
| FR-006 | Guardian relationship | Multiple verified guardians per student with per-child access scope (view-only, payments, pickup authorisation, custody restriction). Unverified links grant nothing. | DOC §6, §5 edge |
| FR-007 | Attendance | Captured only against a valid enrolment and session. Duplicate manual or device events are rejected or merged idempotently. | DOC §6 |
| FR-008 | Examination | Results cannot be published before completeness, verification and approval. Post-publication changes create a new result version. | DOC §6 |
| FR-009 | Fees | Invoice, payment, allocation, receipt, refund and adjustment follow explicit state machines with a full history. | DOC §6 |
| FR-010 | Accounting | Posted journals balance, are immutable, reference a source document or an approved manual entry, and are rejected for closed periods. | DOC §6 |
| FR-011 | Payroll | A payroll run cannot be disbursed without configured checks and approval by a different user than the preparer. | DOC §6 |
| FR-012 | Transport | GPS and trip data are visible only to authorised users and to permitted guardians **during the tracking window**. Access is logged. | DOC §6, §13 |
| FR-013 | Communication | Sends respect consent, channel preferences, quiet hours, audience scope and provider status. Broadcasts are idempotent. | DOC §6 |
| FR-014 | Audit | Sensitive actions record actor, tenant, timestamp, target, action, before/after summary, reason and correlation ID. The audit store is append-only and tamper-evident. | DOC §6 + §16 |
| FR-015 | Reporting | Reports enforce the same tenant, campus and row/column rules as screens. | DOC §6 |
| FR-016 | Export | Exports are permissioned, logged, asynchronous for large sets, delivered via expiring signed URLs, and optionally watermarked. | DOC §6 |
| FR-101 | Approvals engine | Policies are configurable by document type, amount threshold and scope. Self-approval is blocked. Delegation and escalation are supported. SLA is measured. | G-04 |
| FR-102 | Numbering | Document numbers are unique per configured scope. Gapless where configured. Never reused after a reversal. | G-05 |
| FR-103 | Legal entities | All financial records carry `legal_entity_id`. Statements are produced per entity, with consolidated views optional. | G-01 |
| FR-104 | Settings | Each setting resolves deterministically through scope levels. Changes are audited and effective-dated where flagged. | G-11 |
| FR-105 | Import | Every import supports a dry run, row-level error reports, an idempotent commit and an audit trail. | G-12 |
| FR-106 | Entitlements | Disabled modules are hidden in the UI **and** rejected by the API (403 with an entitlement code). | G-13 |
| FR-107 | Consent | Processing purposes that need consent are checked before processing. Guardian consent for minors is verifiable. | G-15 |
| FR-108 | Rollover | Academic-year rollover runs as a dry run, then a committed, re-runnable promotion with an exception list. Historical data stays intact. | G-10 |
| FR-109 | Cashier sessions | Cash and instrument collections belong to a cashier session. Close requires reconciliation of counted versus system totals, with variance approval. | G-21 |
| FR-110 | Support access | Platform support can access tenant data only through time-boxed, tenant-approved, audited elevation. | DOC §16, §21 |

## 7. Enhanced non-functional requirements

The PDF lists the attributes (§18). Proposed **starting targets** for approval are below **[DEC-12]**. They will be re-baselined after discovery.

| Attribute | Proposed initial target |
|---|---|
| Availability | 99.5% monthly in the pilot, 99.9% at general availability (excluding announced maintenance) |
| API latency | p95 < 300 ms for reads, < 600 ms for standard writes, at the pilot load profile |
| Bulk operations | 1,000-student attendance submit < 2 s; invoice run of 10k students processed asynchronously < 10 min |
| Peak model | 5× normal load on fee deadlines and result publication |
| RPO / RTO | RPO ≤ 15 min (PITR), RTO ≤ 4 h at pilot |
| Accessibility | WCAG 2.2 AA for web |
| Browser support | Last 2 versions of Chrome, Edge, Firefox and Safari; Android Chrome |
| Audit retention | ≥ 8 years for financial evidence (to be confirmed by legal), ≥ 180 days for security logs |
| Localisation | en-IN first. i18n framework from day one. Hindi plus regional languages when approved |
