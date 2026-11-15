# Architecture

Status: **Proposed**. Items marked DEC-nn need approval ([DECISION_LOG.md](DECISION_LOG.md)).

## 1. Architecture summary

A **modular monolith** [DOC §7] in a TypeScript monorepo:

```
            ┌──────────────────────── Clients ─────────────────────────┐
            │ Next.js web (admin/staff/parent PWA)   Flutter apps (P8) │
            └───────────────┬──────────────────────────┬───────────────┘
                            │ HTTPS (REST /api/v1)      │
                 ┌──────────▼──────────────────────────▼──────────┐
                 │ Edge: CDN/WAF · TLS · rate limit · tenant host │
                 └──────────┬─────────────────────────────────────┘
       ┌────────────────────▼───────────────────────┐   ┌──────────────────────┐
       │ API (NestJS, stateless, N replicas)         │   │ Worker (NestJS, same │
       │  Guards: AuthN → TenantContext → Entitle-   │   │ codebase, separate   │
       │  ment → Permission(RBAC) → Scope(ABAC)      │   │ process): jobs,      │
       │  Domain modules M00–M20 (strict boundaries) │   │ outbox dispatch,     │
       │  PostingService · ApprovalService · Audit   │   │ schedulers, imports, │
       └───────┬───────────────┬──────────────┬──────┘   │ notifications, GPS*  │
               │               │              │          └─────────┬────────────┘
     ┌─────────▼──────┐ ┌──────▼─────┐ ┌──────▼────────┐           │
     │ PostgreSQL 16  │ │ Redis      │ │ S3-compatible │◄──────────┘
     │ RLS · outbox · │ │ cache, rate│ │ private files │
     │ job queue      │ │ limit, lock│ │ signed URLs   │
     └────────────────┘ └────────────┘ └───────────────┘
     External adapters: payment gateways · SMS/WhatsApp/email · FCM/APNs · GPS · biometric · SSO · banks
```

\* GPS ingestion may be extracted into its own service in P8 if throughput requires it [DOC §7].

## 2. Technology decisions

| Layer | Choice | Notes |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | One install and shared packages. Build caching |
| Web | Next.js (App Router) + React + TypeScript + Tailwind + **shadcn/ui (Radix)**-based internal component library + React Hook Form + Zod + TanStack Query + TanStack Table | The web app is a client of the API. **No business logic in Next.js server actions** — only BFF concerns (cookies, SSR of shell) |
| API | NestJS + TypeScript, REST, OpenAPI via `@nestjs/swagger` | One backend stack [DOC §22 decision closed by master prompt] |
| Validation contracts | **Zod schemas in `packages/contracts`** shared by web and API (via `nestjs-zod`), generating OpenAPI | A single definition prevents drift between client and server validation |
| ORM | **Prisma** + hand-written SQL in migrations for RLS policies, composite FKs, partial/exclusion indexes and triggers | DEC-02. Kysely is the alternative if Prisma limits bite |
| DB | PostgreSQL 16 (managed, HA, PITR) | RLS, NUMERIC, exclusion constraints, partitioning |
| Jobs / events | **Transactional outbox + pg-boss** (Postgres-backed queue) | Jobs are enqueued in the same transaction as business writes, with no dual-write. Redis/BullMQ is optional later for very high throughput. DEC-03 |
| Cache / coordination | Redis | Cache, rate limits, short locks, OTP throttling. **Never a source of truth** [DOC §7] |
| Files | S3-compatible (AWS S3 / MinIO local) | Presigned upload/download, malware scanning (ClamAV worker) |
| Auth | In-house on NestJS: argon2id, JWT access (≈10 min) + rotating opaque refresh token (httpOnly cookie for web; secure storage for mobile), TOTP MFA, SMS OTP | OIDC/SAML SSO for staff later via adapter. DEC-08 |
| Observability | OpenTelemetry → logs/metrics/traces backend (Grafana stack or cloud-native), pino structured logs with PII redaction | Correlation IDs end to end |
| Mobile | Flutter (per DOC §8) | DEC-06 (alternative: React Native/Expo to share TypeScript) |
| Infra | Docker, IaC (Terraform), managed cloud in an India region | DEC-04, DEC-10 |
| Testing | Jest (unit), Supertest + Testcontainers Postgres (integration/API), Playwright (E2E), k6 (performance) | |

## 3. Multi-tenancy & isolation model [DOC §7]

**Shared database, shared schema, `tenant_id` on every tenant-owned row, RLS as defence in depth** (DEC-05 confirms; a migration path to a dedicated DB per large tenant is preserved because all access goes through the tenant context).

1. **Request pipeline:** `AuthGuard` validates the JWT. The JWT is **issued for one tenant membership** (claim `tid`, `mid`). `TenantContextGuard` loads the membership (cached), checks it is active and the tenant is not suspended (or applies the grace policy). `X-Campus-ID` is only a *selector*, validated against the user's campus scopes [DOC §7].
2. **DB binding:** every request's DB work runs in a transaction that first executes `SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)` — transaction-local, so pooled connections cannot leak context (works with PgBouncer transaction mode).
3. **RLS policies:** `ENABLE` + `FORCE ROW LEVEL SECURITY` on every tenant table. Policy `tenant_id = current_setting('app.tenant_id', true)::uuid` for USING and WITH CHECK. A missing setting means NULL means **zero rows (fail closed)**.
4. **DB roles:** `app_migrator` (owner, used only by migrations), `app_runtime` (no BYPASSRLS, DML only), `app_platform` (platform tables + controlled cross-tenant ops for SaaS admin jobs, audited), `app_readonly_analytics`.
5. **Tenant-composite FKs:** every tenant table has `UNIQUE (tenant_id, id)`. Child FKs are `(tenant_id, parent_id) → parent(tenant_id, id)`, so cross-tenant references are impossible at the DB level.
6. **Campus scope (ABAC)** is enforced in the application layer via a reusable `ScopeFilter` applied by repositories (not RLS initially. DEC-05b).
7. **Jobs, exports and reports** carry `tenantId` in the payload. The worker binds the same context before touching data. Jobs without tenant context are rejected unless they are registered as platform jobs.
8. **Automated breakout tests** (TEST_STRATEGY §3) run on every PR.

## 4. Backend module structure (inside `apps/api`)

```
src/modules/<module>/
  <module>.module.ts
  api/            controllers + request/response DTOs (from packages/contracts)
  application/    use-case services (commands/queries), transaction orchestration
  domain/         entities/value objects, state machines, policies, pure rules (unit-tested)
  infrastructure/ repositories (Prisma), adapters, outbox publishers
  events/         published event types (module's public contract)
  index.ts        public API of the module (only this may be imported by other modules)
```
Rules: modules talk only via the `index.ts` public services or events. An ESLint boundary rule (`eslint-plugin-boundaries`) enforces this in CI. Each module owns its tables. Cross-module reads use the public query services, or read models for analytics.

Cross-cutting platform services: `TenantContext`, `PermissionService` (RBAC+ABAC), `AuditService`, `ApprovalService`, `NumberingService`, `SettingsService`, `PostingService` (accounting gateway), `OutboxService`, `FileService`, `NotificationService`, `ImportService`, `ExportService`, `Clock` (testable time), `IdempotencyService`.

## 5. Standard request / transaction pattern

```
Controller → validates DTO (Zod) → UseCase.execute(cmd, ctx)
  └ withTenantTx(ctx, async tx => {
       authorize(ctx, permission, resourceScope)
       load aggregate FOR UPDATE (if state change); check version (optimistic lock / If-Match)
       domain.transition(...)  // throws DomainError → 409/422
       repository.save(tx); numbering.next(tx) if needed; posting.post(tx) if financial
       audit.record(tx, ...); outbox.add(tx, event)
     })
  → map to response DTO (never return Prisma entities)
Idempotency-Key (financial/import/webhook): stored with request hash + response; replay returns the stored response.
```

## 6. Non-functional design

| Concern | Approach |
|---|---|
| Performance | Tenant-leading composite indexes; cursor pagination; bulk endpoints for attendance/marks; async jobs for invoice runs, reports, exports |
| Scalability | Stateless API/worker replicas; read replica for reporting when needed; partition append-only high-volume tables (audit, GPS, notification deliveries, device events) by month |
| Reliability | Outbox + retry with backoff + dead letters + replay tools; circuit breakers on providers; graceful degradation (for example "payment provider unavailable" state) |
| Recoverability | PITR, daily snapshots, quarterly restore drills, per-tenant logical export |
| Observability | Correlation ID per request/job, tenant ID as a log field (no PII), RED metrics, queue age, webhook failure, posting failure alerts |
| Security | See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) |
| Maintainability | Module boundaries, ADRs, contracts package, generated API client, migrations reviewed |
| Localisation | `next-intl`/ICU messages; dates stored UTC + institution TZ for display; academic dates as DATE |
| Noisy neighbour | Per-tenant rate limits and job concurrency caps |

## 7. Environments & delivery [DOC §21]

local (docker compose: postgres, redis, minio, mailpit, clamav optional) → dev → QA → staging (production-like, anonymised data) → production. CI: lint, typecheck, unit, integration (Testcontainers), boundary check, migration check (apply to an empty DB and to the previous schema), SAST/dependency/secret scan, image build and scan. CD: migrations as a gated step, health checks, smoke tests, feature flags per tenant/campus.

## 8. Initial repository structure (proposed)

```
EDUErp/
├─ apps/
│  ├─ api/                    # NestJS modular monolith (HTTP)
│  │  ├─ src/{main.ts, app.module.ts, platform/, modules/<m>/, common/}
│  │  ├─ prisma/{schema.prisma, migrations/, sql/ (RLS & constraint snippets), seed/}
│  │  └─ test/{integration/, security/ (tenant breakout), fixtures/}
│  ├─ worker/                 # NestJS standalone app: jobs, outbox, schedulers (imports api modules)
│  ├─ web/                    # Next.js (App Router): (auth)/, (app)/[module]/..., (platform)/ console
│  └─ mobile/                 # Flutter (Phase 8)
├─ packages/
│  ├─ contracts/              # Zod schemas, DTO types, enums, error codes, permission codes
│  ├─ ui/                     # design system (tokens, components, DataTable, Form, StatusBadge…)
│  ├─ api-client/             # generated typed client from OpenAPI
│  ├─ domain-kit/             # shared pure utilities: Money (decimal.js), dates, state-machine helper
│  ├─ eslint-config/ tsconfig/
├─ e2e/                       # Playwright suites
├─ infra/{docker/, terraform/, k6/}
├─ docs/                      # this documentation set (+ adr/, modules/, source/)
├─ .github/workflows/         # CI/CD (if GitHub)  — DEC-16
├─ docker-compose.yml, turbo.json, pnpm-workspace.yaml, package.json, .env.example
└─ README.md
```
