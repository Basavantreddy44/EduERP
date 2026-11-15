# EDUErp: Design Overview (Architecture + Table Structure Index)

Based on the **agreed v1 scope** in [REQUIREMENTS_DISCUSSION.md](REQUIREMENTS_DISCUSSION.md):
- SaaS sold to many institutions; school + PU + UG/PG; 5k–20k+ students per institution.
- Web-first PWA; English + Kannada; in-app, push, SMS, WhatsApp and email; Razorpay; full accounting.
- **32 modules, one launch to clients.** Built internally in steps B1–B7.

Table structures are in [docs/tables/](tables/), one file per build step.

---

## Part A: Architecture

### A1. System layout

```
 Users: Admin · Office · Accounts · Teachers · Wardens · Parents · Students · Security …
            │  Browser / installed PWA on phone (English | ಕನ್ನಡ)
 ┌──────────▼────────────────────┐
 │  Web app — Next.js (PWA)      │  screens, forms, tables, web push
 └──────────┬────────────────────┘
            │ REST API /api/v1 (JWT)
 ┌──────────▼───────────────────────────────────────────────┐
 │  Backend API — NestJS (one app, 32 modules)               │
 │  business rules · validation · permissions · audit        │
 └───┬──────────────┬───────────────┬───────────────┬────────┘
     │              │               │               │
 PostgreSQL       Redis        File storage     Worker (NestJS, same code)
 (all data,      (cache,       (S3/MinIO:       background jobs: SMS, WhatsApp,
  RLS per         OTP, rate     photos, docs,    push, email, invoice runs,
  tenant)         limits)       feed media)      reports, imports, reminders
                                                       │
                       External: Razorpay · SMS provider · WhatsApp BSP · FCM (push) · Email
```

### A2. Core rules
1. **Tenant isolation:** every business table has `tenant_id`. The tenant comes from the login token. PostgreSQL Row Level Security blocks other tenants' data.
2. **Campus scope:** campus tables have `campus_id`. Users can be limited to campuses.
3. **Permissions:** role → permissions. Menus and buttons come from permissions, and the API checks again.
4. **Audit:** create/update/approve/delete-type actions are logged in `audit_logs`.
5. **Money:** `NUMERIC(14,2)`. Never float.
6. **No hard delete** for students, staff, receipts, journals, results or attendance. Status changes or reversal are used instead.
7. **Numbers** (admission no, receipt no, invoice no …) come from `number_sequences`, allocated inside the same transaction.
8. **Approvals** for concessions, refunds, leave, outpass, purchase and so on use **one shared approval engine** (`approval_rules`, `approval_requests`, `approval_actions`).
9. **Language:** UI text lives in translation files (en, kn). Data has optional `*_local` columns (Kannada name) where printed on report cards and certificates. Message templates are stored per language.
10. **Scale (20k+ students):** tenant-leading indexes; monthly partitions for high-volume tables (attendance_records, audit_logs, notification_deliveries, hostel_attendance, feed_reactions); heavy work runs in background jobs.

### A3. Project folders

```
EDUErp/
├─ apps/
│  ├─ api/      NestJS backend — src/modules/<module>/{controller, service, dto, rules}
│  ├─ worker/   background jobs (same code base)
│  └─ web/      Next.js PWA — app/(auth), app/(admin)/<module>, app/(portal) parent/student
├─ packages/shared/   Zod schemas, enums, permission codes, types
├─ packages/db/       Prisma schema + migrations (+ SQL for RLS), seed  (ADR-001)
├─ locales/{en,kn}/   translations
├─ docker-compose.yml postgres, redis, minio, mailpit
└─ docs/
```

### A4. Common columns (in every tenant table, **not repeated** in the table files)
```
id          UUID PK
tenant_id   UUID NOT NULL  FK → tenants        (RLS key)
created_at  TIMESTAMPTZ   default now()
updated_at  TIMESTAMPTZ
created_by  UUID FK → users
updated_by  UUID FK → users
```
`campus_id` is shown in a table only where that table is campus-specific.

---

## Part B: Build steps & table files

| Step | File | Modules | Tables |
|---|---|---|---|
| **B1 Core** | [tables/B1_core.md](tables/B1_core.md) | SaaS & subscriptions · institution setup · users/roles · shared services (numbering, files, audit, approvals, settings) · academic structure · basic staff · admissions · students & parents · attendance & leave · fees + Razorpay · accounts posting (basic) · communication | 76 |
| **B2 Academics** | [tables/B2_academics.md](tables/B2_academics.md) | Timetable · homework · class diary · lesson plans & syllabus · study material/LMS · exams (CBSE / State / PU / CBCS) · report cards · certificates · promotion | 33 |
| **B3 Engagement** | [tables/B3_engagement.md](tables/B3_engagement.md) | News feed · events & calendar · PTM · staff/committee meetings & minutes · complaints · front office · department requests | 29 |
| **B4 Finance & HR** | [tables/B4_finance_hr.md](tables/B4_finance_hr.md) | Full accounting (vendors, bills, expenses, bank, GST, TDS, statements) · HR · payroll | 30 |
| **B5 Campus life** | [tables/B5_campus_life.md](tables/B5_campus_life.md) | Hostel (rooms, beds, allotment, inventory, deposits, roll-call, outpass, home-going, visitors, maintenance) · mess · transport · library · health · discipline & counselling | 37 |
| **B6 Operations** | [tables/B6_operations.md](tables/B6_operations.md) | Inventory & purchase · labs · sports & activities · placements · saved reports/exports | 32 |
| B7 Final testing | — | No new tables | — |
| | | **Total** | **237** |

## Part C: How modules connect (main links)

```
admission_applications ──enrol──► students ──► student_enrollments ──► sections ──► program_levels ──► programs
        │                            │
        │                            ├─► student_guardians ◄── guardians ──► users (parent login)
        │                            ├─► attendance_records · exam_marks · homework_submissions
        │                            ├─► student_fee_assignments ──► fee_invoices ──► payments ──► journal_entries
        │                            ├─► hostel_allotments · mess_subscriptions · student_transport   ──► fee charges
        │                            ├─► library_issues · infirmary_visits · discipline_incidents
        │                            └─► placement applications · achievements · feed (class feed)
employees ──► users (staff login) ──► timetable_entries · attendance_sessions · payslips ──► journal_entries
vendors ──► purchase_orders ──► goods_receipts ──► stock_transactions ;  vendor_bills ──► journal_entries
Every module ──► notifications (SMS/WhatsApp/push/in-app) ;  audit_logs ;  approval_requests ;  files
```

**Rule:** a module never inserts into another module's tables directly. It calls that module's service. For example, hostel calls **FeeService.addCharge()** and does not insert into fee_invoices itself. This keeps every connection traceable and testable.
