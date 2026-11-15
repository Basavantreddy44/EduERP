# Project Overview

## 1. Our understanding of the product

EDUErp is a **commercial multi-tenant SaaS ERP** for education institutions **[DOC §1]**.

- A **tenant** is one customer: an institution, or in India often a *trust or society* that runs several institutions.
- A tenant has **many campuses**. Each campus has departments, academic units, programmes or classes, sections and operating locations.
- The platform serves **schools** (class/section/board model) and **colleges** (programme/semester/course/credit model) side by side. It must not force one academic hierarchy on both **[DOC §4.5]**.
- It is the **single system of record** for students, guardians, employees, suppliers and money **[DOC §1]**. Fee collection is a source transaction for a real double-entry ledger, not a separate accounting world **[DOC §15]**.
- **Configuration over code.** Calendars, grading, fee rules, attendance rules, approval chains, numbering and tax treatment are tenant/campus configuration, effective-dated where law or policy changes **[DOC §1, §15]**.
- Every high-risk change follows the same lifecycle: **controlled, approved, audited and reversible-by-reversal**. Nothing that has been posted or published is deleted **[DOC §1, §9, §15]**.

### Who uses it

| Audience | Primary surface | Core value |
|---|---|---|
| Platform operator (us) | SaaS console | Onboard, bill, support and monitor tenants without seeing tenant business data by default |
| Institution leadership | Web dashboard | Cross-campus visibility, approvals, governance |
| Office staff (admissions, accounts, HR, exam cell, store, library) | Web back-office | Fast, validated, auditable daily operations |
| Teachers / lecturers | Web + mobile | Timetable, attendance, assignments, marks |
| Parents / guardians | Mobile / PWA | Child's attendance, fees and payments, results, notices, bus status |
| Students | Mobile / PWA / web | Own timetable, attendance, assignments, results, dues |
| Field staff (drivers, wardens) | Mobile | Trips, pickup/drop, hostel roster, outpasses |
| Auditors | Read-only web | Evidence and audit reports for a granted scope and period |

### What the product is *not* **[DOC §2]**
- Not a replacement for mandated university/board/government systems. It integrates with them.
- Not a payment network, bank, telecom or biometric hardware vendor.
- Not an automated decision-maker for admission, discipline, grading or risk. A human always decides.
- Not a legal or tax compliance guarantee. Specialists validate each deployment.

## 2. Scope summary

| Area | Modules | Release (see Roadmap) |
|---|---|---|
| Platform foundation | SaaS admin, institution/campus, identity/RBAC/ABAC, audit, settings, numbering, approvals engine, files, notifications core, import/export | Phase 0 |
| Student core | Academic structure, admissions CRM, SIS and guardians | Phase 1 |
| Daily academics | Timetable, attendance (student + staff) | Phase 2 |
| Finance core | Fees, payments, receipts, double-entry accounting, bank reconciliation | Phase 3 |
| Academic outcomes | Learning/assignments, examinations, results, certificates | Phase 4 |
| People | HR, leave, payroll | Phase 5 |
| Campus operations | Hostel, transport (without live GPS), library | Phase 6 |
| Supply chain | Procurement, inventory, fixed assets, budgets | Phase 7 |
| Experience | Communication channels, parent/student portal, Flutter apps, GPS, devices | Phase 8 |
| Insight | Analytics, governed AI, compliance tooling completion | Phase 9 |
| Go-live | Migration, pilot, security assessment, DR test, rollout | Phase 10 |

All 20 modules in [MODULE_SPECIFICATIONS.md](MODULE_SPECIFICATIONS.md) remain in scope **[DOC §4]**. They are built and released in phases, not launched at once **[DOC "How to use"]**.

## 3. Product principles we will enforce in code

1. **Tenant isolation is a database guarantee, not a convention.** RLS, tenant-composite foreign keys and automated breakout tests **[DOC §7]**.
2. **Server is the authority.** All business rules, state transitions and permissions are enforced in the backend. The UI only reflects them.
3. **State machines over free-text status.** Every lifecycle entity has an explicit, server-validated transition table.
4. **Immutable financial, academic and audit evidence.** Corrections are reversals or new versions.
5. **Idempotent integrations.** Payments, webhooks, device events, imports and journal posting.
6. **Configuration is data.** Typed, validated, versioned, effective-dated where needed, and auditable.
7. **Modular monolith.** Strict module boundaries now. Extraction into services only when it is justified **[DOC §7]**.
8. **Human-in-the-loop AI.** Explainable, audited, never the final decision on people **[DOC §17]**.

## 4. Success measures [DOC §2]

Admissions cycle time, attendance capture completeness, receipt reconciliation accuracy, result turnaround, month-end close duration, workflow SLA compliance, uptime, and monthly active users by role. **Targets are set during discovery against measured baselines. We do not invent them.** Each measure needs instrumentation (events and timestamps), which is built into the relevant phase.
