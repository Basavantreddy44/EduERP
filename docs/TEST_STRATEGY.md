# Test Strategy & Acceptance

Baseline **[DOC §19]** plus the master prompt §12. **No test is reported as passed unless it was executed. Results are recorded in DEVELOPMENT_STATUS.md with the command and date.**

## 1. Test layers & tooling

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit | Jest | Domain rules, state machines, calculations (fees, GPA, payroll, proration), permission predicates, Money/rounding | Every PR; domain coverage ≥ 90% lines for `domain/` folders |
| Integration (DB) | Jest + **Testcontainers PostgreSQL** (real Postgres, real RLS, real migrations) | Repositories, constraints, triggers, RLS, numbering concurrency, posting | Every PR |
| API / contract | Supertest + OpenAPI schema validation | Status codes, error shapes, idempotency, pagination, permission per route | Every PR |
| Security | Dedicated suite `test/security` | Tenant breakout, campus breakout, IDOR, privilege escalation, SoD, unauthenticated routes inventory | Every PR (blocking) |
| E2E | Playwright | Critical journeys per phase, role-based UI gating | Nightly + pre-release |
| Accessibility | axe-core in Playwright | WCAG 2.2 AA checks on key screens | Pre-release |
| Performance | k6 | Attendance bulk submit, invoice run, result calc, login burst, webhook burst | Per phase exit + pre-release |
| Resilience | Fault injection (provider down, duplicate/out-of-order webhooks, queue backlog, DB failover) | Integration/staging | Phase exit |
| Migration | Dry-run on anonymised legacy samples, reconciliation reports | P10 | Sign-off |
| UAT | Institution-owned scripts | Each phase | Business owner sign-off |

## 2. Test data
Factories per module (`test/fixtures`), deterministic `Clock`, two-tenant baseline fixture (**Tenant A, Tenant B**, each with 2 campuses and users per role), and a synthetic volume dataset generator for performance tests. Never use real personal data [DOC §10].

## 3. Tenant isolation test suite (blocking, grows each phase)

For **every** tenant-scoped resource, an auto-generated test matrix:
1. Tenant-B user requests Tenant-A resource by ID: GET/PATCH/DELETE/action → **404**, no data in the body, timing not significantly different.
2. List/search/report/export as Tenant B never contains Tenant-A rows.
3. Creating a child that references a Tenant-A parent ID fails (composite FK + 404/422).
4. Raw DB check: a query with no `app.tenant_id` set returns **0 rows** (fail-closed).
5. A job enqueued without tenant context is rejected.
6. File download URL for a Tenant-A file is not obtainable by Tenant B.
7. Campus-restricted user cannot access an unassigned campus in the same tenant (403/404).
8. Schema test: every table with `tenant_id` has FORCE RLS + policy + `UNIQUE(tenant_id,id)`.

## 4. Critical acceptance scenarios (traceable)

| ID | Scenario | Source | Layer |
|---|---|---|---|
| CS-01 | Tenant A cannot read/update/export/infer Tenant B data via UI, API, reports, files, search, jobs, direct IDs | DOC §19 | Security, E2E |
| CS-02 | Campus-restricted user blocked from other campus | DOC §19 | Security |
| CS-03 | Unauthorised direct API call to a restricted action fails | Prompt §12 | API |
| CS-04 | Applicant cannot become an active student without approval + enrolment transition; duplicate admission/enrolment prevented | DOC §19 | Integration, E2E |
| CS-05 | Guardian sees nothing until the link is verified | DOC §19 | API |
| CS-06 | Duplicate device events → single attendance record | DOC §19 | Integration |
| CS-07 | Published marks cannot be silently changed; correction → new version + approval + notification | DOC §19 | Integration, E2E |
| CS-08 | Replayed/out-of-order payment webhook → exactly one settlement, receipt and journal | DOC §19 | Integration, resilience |
| CS-09 | Unbalanced or closed-period journals rejected | DOC §19 | Unit, integration |
| CS-10 | Payroll cannot be disbursed before approval; preparer ≠ approver | DOC §19 | API |
| CS-11 | GPS tracking stops per trip policy; access logged; guardian window enforced | DOC §19 | Integration |
| CS-12 | Exports contain only permitted rows/columns and are logged | DOC §19 | API |
| CS-13 | Backup restore meets RPO/RTO with reconciled data | DOC §19 | DR drill |
| CS-14 | Concurrent number allocation produces no duplicates/gaps (gapless sequences) | ENH | Integration (parallel) |
| CS-15 | Receipt total = sum of allocations; subledger = GL control account | DOC §15 | Integration |
| CS-16 | Rollover dry run = commit result; re-run is idempotent | ENH | Integration |
| CS-17 | Every route has a permission or is explicitly public | ENH | Static/API |

All 15 DOC §5 edge cases are each mapped to at least one test case ID in the module spec packs.

## 5. Traceability
Requirement IDs (FR-xxx, `<MOD>-US-nnn`, `<MOD>-BR-nnn`) appear in test names: `it('[FEE-BR-012] rejects receipt for pending payment', …)`. A script generates the traceability matrix (requirement → tests → last run status) into DEVELOPMENT_STATUS.md.

## 6. Defect severity & release gates [DOC §19]
Critical (cross-tenant exposure, financial corruption, auth bypass, data loss) → block release. High → block the module unless formally accepted with mitigation. Medium → fix by milestone. Low → backlog. **Phase exit requires:** all phase acceptance criteria passed (executed), zero open Critical/High, security suite green, docs updated, Definition of Done [DOC §24] satisfied.
