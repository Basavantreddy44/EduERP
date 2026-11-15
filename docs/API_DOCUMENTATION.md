# API Architecture & Endpoint Plan

Baseline **[DOC §11]**. The live contract is the generated OpenAPI document (`/api/docs`, `/api/openapi.json`), produced from `packages/contracts` Zod schemas. This file defines the conventions and the endpoint plan.

## 1. Conventions

| Topic | Standard |
|---|---|
| Base path | `/api/v1` over HTTPS only |
| Tenant | **From the access token** (`tid` claim), never from the body. A `/tenants/{id}` path appears only in platform-admin APIs |
| Campus | `X-Campus-ID` header selects the active campus context (validated). List endpoints also accept a `campusId` filter within the allowed scope |
| Auth | `Authorization: Bearer <JWT>`. Web uses an httpOnly refresh cookie + CSRF token on `/auth/refresh` |
| Correlation | `X-Request-ID` accepted/generated, echoed, logged and propagated to jobs |
| Idempotency | `Idempotency-Key` **required** on payment, refund, journal post, import commit and bulk create. Optional elsewhere |
| Concurrency | `ETag`/`If-Match` (or `version` in the body) on updates to high-value records. Mismatch → 412 / 409 |
| Resources | Plural nouns, kebab-case: `/fee-invoices`, `/student-groups` |
| State changes | `POST /{resource}/{id}/actions/{action}` (for example `/admission-applications/{id}/actions/approve`) with an optional `{ reason, comment }`. Normalises the DOC's mixed patterns (defect D-04) |
| Pagination | Cursor-based: `?limit=50&cursor=…` → `{ data, page: { nextCursor, hasMore } }`. `?includeTotal=true` where cheap |
| Filtering/sorting | `?filter[status]=ACTIVE&sort=-createdAt` (allow-listed fields only) |
| Response | Success: resource or `{ data, page }`. Async: `202 { jobId, statusUrl }` |
| Errors | RFC 9457 Problem Details: `{ type, title, status, code, detail, errors:[{path, code, message}], requestId }` |
| Status codes | 200/201/202/204 · 400 malformed · 401 · 403 (incl. `ENTITLEMENT_DISABLED`) · **404 for anything outside the authorised scope (never reveal existence)** · 409 state/version conflict · 412 precondition · 422 validation/business rule · 429 · 5xx [DOC §11] |
| Money | Strings in JSON (`"1250.00"`) + `currency`. Never JSON numbers |
| Dates | ISO-8601. Instants in UTC (`…Z`). Business dates `YYYY-MM-DD` |
| Versioning | URI major version. Additive changes only within v1. Deprecation headers |
| Rate limits | Per user + per tenant + per IP for auth/OTP. `RateLimit-*` headers |

## 2. Per-endpoint specification template

Every endpoint in a module spec pack defines: method · path · summary · auth · permission code(s) · scope rule (tenant/campus/relationship) · request schema · response schema · validation rules · error codes (domain codes such as `FEE_INVOICE_ALREADY_PAID`) · idempotency · transaction behaviour · audit event · emitted events · rate-limit class.

## 3. Endpoint plan (by phase)

Paths are relative to `/api/v1`. **(P)** = platform-admin API using the platform role.

**Phase 0 — Platform**
- Auth: `POST /auth/login` · `POST /auth/otp/request` · `POST /auth/otp/verify` · `POST /auth/mfa/verify` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/switch-tenant` · `POST /auth/password/forgot|reset` · `GET /me` · `GET /me/memberships` · `GET /me/permissions` (effective permissions + scopes for UI gating)
- Platform (P): `GET|POST /platform/tenants` · `GET|PATCH /platform/tenants/{id}` · `POST /platform/tenants/{id}/actions/{activate|suspend|reactivate|start-offboarding}` · `GET|POST /platform/plans` · `GET|POST /platform/subscriptions` · `GET /platform/usage` · `POST /platform/support-access-requests`
- Org: `GET|POST /legal-entities` · `GET|POST /campuses` · `GET|PATCH /campuses/{id}` · `GET|POST /departments` · `GET|POST /academic-units` · `GET|POST /cost-centres` · `GET|POST /holidays`
- Access: `GET|POST /users` · `POST /users/{id}/actions/{invite|deactivate|reactivate}` · `GET|POST /roles` · `PUT /roles/{id}/permissions` · `GET|POST /users/{id}/role-assignments` · `GET /permissions`
- Settings: `GET /settings?scope=…` · `PUT /settings/{key}`
- Numbering: `GET|POST /number-sequences`
- Approvals: `GET|POST /approval-policies` · `GET /approval-requests?assignedToMe=true` · `POST /approval-requests/{id}/actions/{approve|reject|return|delegate}`
- Files: `POST /files/upload-urls` · `POST /files/{id}/actions/confirm` · `GET /files/{id}/download-url`
- Import/export: `POST /imports` · `GET /imports/{id}` · `GET /imports/{id}/errors` · `POST /imports/{id}/actions/{validate|commit}` · `POST /exports` · `GET /exports/{id}`
- Audit: `GET /audit-logs` · Notifications (in-app): `GET /notifications/me` · `POST /notifications/{id}/actions/read`
- Health: `GET /health/live|ready` (unauthenticated, no tenant data)

**Phase 1 — Academic structure, admissions, SIS**
`/academic-years` · `/academic-terms` · `/programs` · `/program-levels` · `/courses` · `/curriculum-items` · `/student-groups` · `/course-offerings` · `/faculty-assignments` · `/admission-cycles` · `/admission-enquiries` (+ `/followups`) · `/admission-applications` (+ actions `submit|return|shortlist|approve|reject|waitlist|offer|withdraw`) · `/admission-offers/{id}/actions/{accept|decline}` · public: `POST /public/{tenantSlug}/applications` (OTP-verified, captcha) · `/students` · `/students/{id}/guardians` · `/students/{id}/enrollments` · `/students/{id}/transfers` · `/students/{id}/timeline` · `/guardians` · `/student-guardians/{id}/actions/verify` · `/students/{id}/documents`

**Phase 2 — Timetable, attendance**
`/rooms` · `/bell-schedules` · `/timetables` (+ `/versions`, actions `validate|publish`) · `/timetable-entries` · `/substitutions` · `/attendance-sessions` (+ actions `submit|approve|publish`) · `POST /attendance-sessions/{id}/records:bulk` · `GET /attendance-records` · `/attendance-corrections` (+ approve) · `/leave-requests` (+ approve) · `/attendance-devices` · `POST /device-ingest/attendance-events` (device-authenticated, batched, idempotent) · `/staff-attendance`

**Phase 3 — Fees, accounting**
`/fee-heads` · `/fee-structures` · `/student-fee-assignments` · `/concessions` (+ approve) · `POST /fee-invoice-runs` (202) · `/fee-invoices` · `/payment-orders` · `POST /webhooks/payments/{provider}` (signature-verified, no JWT) · `/cashier-sessions` (+ actions `open|close`) · `/fee-payments` (offline) · `/receipts` · `/refunds` (+ approve) · `/credit-notes` · `/chart-of-accounts` · `/fiscal-years` · `/accounting-periods/{id}/actions/{soft-close|close|reopen}` · `/journal-entries` (+ actions `submit|approve|post|reverse`) · `/posting-rules` · `GET /reports/trial-balance|general-ledger|profit-and-loss|balance-sheet` · `/bank-accounts` · `/bank-statements` (import) · `/bank-reconciliations` (+ match/unmatch)

**Phase 4 — Learning, exams**: `/lesson-plans` · `/assignments` · `/assignment-submissions` · `/rubrics` · `/assessment-schemes` · `/grading-scales` · `/examinations` · `/exam-schedules` · `/exam-registrations` · `/hall-tickets` · `/seating-plans` · `/marks` (grid get/put, `:import`) · `/marks-verifications` · `/result-calculations` · `/results/{id}/actions/{approve|schedule|publish}` · `/revaluation-requests` · `/certificates` (+ issue/revoke) · public `GET /public/verify/{code}`

**Phase 5 — HR/payroll**: `/employees` · `/designations` · `/employee-contracts` · `/salary-structures` · `/salary-components` · `/payroll-periods` · `/payroll-runs` (+ actions `freeze-inputs|calculate|review|approve|disburse|post`) · `/payslips` · `/employee-loans` · `/exit-settlements`

**Phase 6–7 — Operations**: `/hostels/**`, `/hostel-applications`, `/hostel-allotments` (+ `check-in|check-out`), `/outpasses`, `/hostel-visitors` · `/vehicles`, `/drivers`, `/transport-routes`, `/route-stops`, `/transport-assignments`, `/trips` (+ `start|end`), `/trips/{id}/events` · `/library/titles|copies|members|issues|reservations|fines` · `/inventory-items`, `/warehouses`, `/stock-movements`, `/purchase-requests`, `/quotations`, `/comparative-statements`, `/purchase-orders`, `/goods-receipts`, `/vendor-bills`, `/vendor-payments`, `/fixed-assets`, `/budgets`

**Phase 8–9**: `/announcements` · `/notification-templates` · `/notifications/{id}/deliveries` · `POST /webhooks/comms/{provider}` · `POST /device-ingest/gps` · `GET /vehicles/{id}/location` (guardian: only within the tracking window and for linked routes) · `/dashboards/{key}` · `/reports` · `/analytics/predictions` · `/data-subject-requests` · `/retention-policies` · `/legal-holds` · `/incidents` · `/access-reviews`

## 4. Webhook rules [DOC §11]
Verify the signature over the raw body → persist the event with a unique provider event ID → return 2xx fast → process asynchronously with retries/DLQ → state-machine transitions tolerate out-of-order delivery → replay tool (audited).
