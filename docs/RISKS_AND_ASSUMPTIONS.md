# Risk & Assumption Register

## 1. Risks

DOC = from §22. ENH = newly identified. Score = Likelihood × Impact (1–5 each).

| ID | Risk | Src | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|---|
| R-01 | Cross-tenant data leak | DOC | 2 | 5 | 10 | RLS + composite FKs + tenant-bound tokens + blocking breakout suite (M0.1 first) | Architect |
| R-02 | Unclear institution-specific rules → rework | DOC | 4 | 4 | 16 | Discovery workshops, signed policy catalogue per pilot tenant, configuration-first design | Product owner |
| R-03 | Academic structure model fails for a real institution type | ENH | 3 | 5 | 15 | Validate the G-14 model against ≥1 CBSE/State school and ≥1 autonomous/affiliated college **before P1 build** | Architect + academic SME |
| R-04 | Accounting model incomplete (entities, deferral, GST) | DOC | 3 | 5 | 15 | Legal-entity model in P0; finance SME designs COA/posting rules; tax expert sign-off | Finance lead |
| R-05 | Scope expansion / "build all 20 at once" | DOC | 4 | 4 | 16 | Phase gates, change control, backlog prioritisation | Sponsor |
| R-06 | AI-generated code quality drift (inconsistent patterns, hidden shortcuts, fake completeness) | ENH | 4 | 4 | 16 | Module templates, boundary lint, mandatory tests per story, code review checklist, "no mock in done" rule, DEVELOPMENT_STATUS evidence | Eng lead |
| R-07 | Prisma limitations (RLS context per tx, composite FKs, partial/exclusion indexes) | ENH | 3 | 3 | 9 | Spike in M0.1; raw-SQL migrations; fallback Kysely for hot paths (DEC-02) | Architect |
| R-08 | Poor legacy data quality | DOC | 4 | 4 | 16 | Import framework with dry-run early (P0); profiling in discovery | Migration lead |
| R-09 | Provider instability (payments, SMS, WhatsApp, GPS) | DOC | 3 | 3 | 9 | Adapters, retries, failover, manual reconciliation | Integration lead |
| R-10 | DPDP children's-data obligations restrict features (tracking, AI) | ENH | 3 | 4 | 12 | Early legal review; consent + purpose checks; AI on minors gated | Compliance owner |
| R-11 | Biometric privacy | DOC | 2 | 4 | 8 | Device-side matching, store event IDs only | Security lead |
| R-12 | GPS battery/network issues | DOC | 4 | 2 | 8 | Trip-only tracking, stale markers, driver procedures | Transport lead |
| R-13 | Low user adoption | DOC | 3 | 4 | 12 | Usability testing, training, champions, parent PWA early | Change lead |
| R-14 | Legal/tax rule changes | DOC | 3 | 3 | 9 | Effective-dated config, periodic review | Compliance |
| R-15 | Peak-load failures (fee deadline, result day) | ENH | 3 | 4 | 12 | k6 tests at 5× load per phase; async heavy work; CDN for static | SRE |
| R-16 | Gapless numbering contention under concurrent collection | ENH | 2 | 3 | 6 | Per-counter row lock, short transactions, non-gapless for non-tax docs | Architect |
| R-17 | Team/skill availability for Flutter + TS split stacks | ENH | 3 | 3 | 9 | DEC-06; parent PWA first | Sponsor |

## 2. Assumptions (need confirmation)

| ID | Assumption | Impact if wrong |
|---|---|---|
| ASM-01 | India-first launch: INR, IST, GST, Indian payroll statutes, English UI first | Currency/tax/localisation rework |
| ASM-02 | One currency per legal entity; no multi-currency in v1 [DOC §22 lists it as needing confirmation] | FX accounting needed |
| ASM-03 | Pilot = one tenant, 1–3 campuses, ≤ 5,000 students | Infra sizing, migration effort |
| ASM-04 | Institution type templates for v1: CBSE/State-board K-12 school and a semester/credit-based UG college | Additional templates needed |
| ASM-05 | Tenant = Data Fiduciary; platform = Data Processor; legal counsel reviews before pilot | Contract/consent design changes |
| ASM-06 | Hosting on a managed cloud India region (AWS ap-south-1 or Azure Central India) | DEC-04/10 |
| ASM-07 | Greenfield: no existing code to preserve (repository was empty on 2026-11-13) | — |
| ASM-08 | GitHub is used for source control and CI | CI config differs |
| ASM-09 | Single payment gateway per tenant in v1 (multi-gateway later) | Adapter routing |
| ASM-10 | Parent/student access starts as a responsive PWA; native apps in P8 | Mobile timeline |
| ASM-11 | Inventory valuation: weighted moving average | Costing logic |
| ASM-12 | Fee revenue recognition default: recognise on invoice for the term; deferral configurable | Posting rules |
| ASM-13 | Staff use email+password+MFA; guardians/students use mobile OTP | Auth design |
| ASM-14 | Institutions provide policies, forms and sample data, and nominate domain owners [DOC §22] | Schedule slip |
