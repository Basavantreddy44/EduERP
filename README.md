# EDUErp — School & College ERP (Multi-tenant SaaS)

A comprehensive School & College ERP platform designed to digitize and streamline educational institution operations, including student admissions, academics, attendance, examinations, fees, HR, library, transport, and parent communication.

> **Status:** In development — not yet released to institutions (release once all modules are complete). The working application (NestJS API + Next.js web + PostgreSQL) covers admissions & students, fees & basic accounts, staff, attendance & leave, dashboards, the parent & student app, transport, hostel & mess, academics, exams & report cards, and school engagement; accounts, HR and payroll are being built now. Current progress: [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) · plan: [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) · decisions: [docs/DECISION_LOG.md](docs/DECISION_LOG.md).

EDUErp is a multi-tenant, multi-campus ERP for schools, higher-secondary institutions and colleges. It covers the full student lifecycle (enquiry → admission → academics → exams → certificates → alumni), integrated double-entry accounting, HR and payroll, and campus operations (hostel, transport, library, procurement, inventory), with parent/student/staff mobile journeys.

## Source of truth

| Source | Role |
|---|---|
| `School_College_ERP_Complete_Project_Documentation.pdf` (v1.0, 12 Nov 2026, 34 pp.) | Baseline specification. Referenced throughout these docs as **§n**. *Recommend copying it into `docs/source/` so it is versioned with the repo.* |
| Master project prompt (development rules, stack, phase workflow) | Engineering rules and development process |
| Documents in `docs/` | The analysed, enhanced blueprint. Kept in sync with the implementation |

## Requirement tagging convention (used in every document)

| Tag | Meaning |
|---|---|
| **[DOC §n]** | Taken directly from the specification PDF, section *n* |
| **[ENH]** | Recommended enhancement, not in the PDF. Needs approval before it enters scope |
| **[ASM]** | Assumption we are making. Needs business confirmation |
| **[DEC-nn]** | Open decision that must be closed before the affected phase. See the Decision Log |

## Documentation map

| Document | Contents |
|---|---|
| **[docs/REQUIREMENTS_DISCUSSION.md](docs/REQUIREMENTS_DISCUSSION.md)** | **Agreed v1 scope, decisions from the requirements discussion, release plan** |
| **[docs/BASIC_PHASE_DESIGN.md](docs/BASIC_PHASE_DESIGN.md)** | **Start here: basic requirements, simple architecture and table structure, phase-wise** |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Product understanding, scope, personas, release strategy |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Requirements analysis, document defects, gap analysis, enhancements, enhanced FR/NFR specification |
| [docs/MODULE_SPECIFICATIONS.md](docs/MODULE_SPECIFICATIONS.md) | 20 modules, submodules and the cross-module dependency matrix |
| [docs/BUSINESS_WORKFLOWS.md](docs/BUSINESS_WORKFLOWS.md) | End-to-end workflow catalogue, state machines and cross-module integration contracts |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Target architecture, tenancy model, stack, NFRs and repository structure |
| [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Entity/relationship plan, isolation, constraints, indexing and migrations |
| [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md) | Field-level definitions (filled phase by phase; Phase 0 tables first) |
| [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) | API architecture, conventions and the endpoint plan |
| [docs/ROLE_PERMISSION_MATRIX.md](docs/ROLE_PERMISSION_MATRIX.md) | Roles, permission catalogue, scopes, SoD rules and the matrix |
| [docs/UX_SCREEN_INVENTORY.md](docs/UX_SCREEN_INVENTORY.md) | Navigation tree, screen inventory and design-system plan |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | Threat model, security controls, DPDP/India privacy assessment |
| [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) | Test layers, critical scenarios, traceability and quality gates |
| [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md) | Phase plan, first milestone and exit criteria |
| [docs/RISKS_AND_ASSUMPTIONS.md](docs/RISKS_AND_ASSUMPTIONS.md) | Risk register and assumption register |
| [docs/DECISION_LOG.md](docs/DECISION_LOG.md) | Closed decisions, proposed ADRs and open decisions needing approval |
| [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) | Progress tracker per phase and module |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Change history |

## Stack (accepted, see DECISION_LOG CD-01…CD-13)

NestJS 11 API · Next.js 15 PWA · PostgreSQL 16 with Row Level Security · Prisma 6 (+ hand-written SQL for RLS/constraints) · Redis · pnpm + Turborepo · Jest + Supertest (Playwright from M0.2) · GitHub Actions.

## Local development

Prerequisites: Node 22+, pnpm 10 (`npm i -g pnpm@10`), Docker Desktop.

```bash
cp .env.example .env          # then set JWT_ACCESS_SECRET (command is in the file) and change the passwords
pnpm install
pnpm db:up                    # Postgres :5433 (+ runtime role + eduerp_test DB), Redis :6380, Mailpit :1025 (inbox UI http://localhost:8025)
pnpm build                    # shared → db (prisma generate) → api, web
pnpm db:migrate               # apply migrations as the owner role
pnpm db:seed                  # permissions, default templates, platform admin; then jobs:setup (pg-boss schema + queues)
pnpm dev                      # API http://localhost:4000/api/v1 · Web http://localhost:3100
pnpm worker                   # background worker (outbox, notifications, email); run alongside the API (needs a build)
```

Sign in at http://localhost:3100 as the seeded platform admin, add an institution under **Institutions**, then sign in as that institution's admin and add campuses.

Database browser (optional): `docker compose --profile tools up -d pgadmin`, then open http://localhost:5050. The **EduERP (local)** server is already listed; its password is `POSTGRES_OWNER_PASSWORD` from your `.env`. The app's data is in the `eduerp` database (`eduerp_test` is wiped by every test run). It signs in as the owner role, so it sees every institution — look, don't edit. Stop it with `docker compose stop pgadmin`.

Tests (need the Postgres container running):
- `pnpm --filter @eduerp/api test`: API integration tests. They rebuild the `eduerp_test` database from migrations on every run.
- `pnpm --filter @eduerp/e2e e2e`: browser end-to-end tests (first time: `pnpm --filter @eduerp/e2e e2e:install`). Reuses the API/web if already running, otherwise starts them. Creates uniquely named test institutions in the dev database.

API docs: http://localhost:4000/api/docs (Swagger UI, not served in production unless `API_DOCS=on`). After changing routes or schemas run `pnpm --filter @eduerp/api build && pnpm --filter @eduerp/api openapi:export` and commit `docs/api/openapi.json`; CI fails if it is stale.

| Path | What |
|---|---|
| `apps/api` | NestJS REST API, `/api/v1` |
| `apps/web` | Next.js web app (proxies `/api/v1` to the API) |
| `apps/e2e` | Playwright end-to-end tests |
| `packages/shared` | Permission codes, system roles, Zod schemas shared by API and web |
| `packages/db` | Prisma schema, migrations (with RLS SQL), seed |
| `docs/` | Requirements, table design ([docs/tables](docs/tables/)), ADRs ([docs/adr](docs/adr/)), status |
