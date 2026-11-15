# ADR-001: Monorepo with pnpm workspaces + Turborepo

**Status:** Accepted (2026-11-13) · **Decision:** DEC-01 → CD-06

## Context
The API, the web app and a later worker all share permission codes, validation schemas and the database client. Keeping them in separate repos would let them drift apart.

## Decision
One repository:
```
apps/api        NestJS REST API (/api/v1)
apps/web        Next.js PWA (proxies /api/v1 to the API, so cookies stay first-party)
packages/shared permission catalogue, system roles, Zod schemas (used by API *and* web forms)
packages/db     Prisma schema, migrations, seed, generated client
```
The background worker is a second entry point of `apps/api` (`src/worker/main.ts`, `pnpm worker`) because it reuses the API's services ([ADR-006](ADR-006-outbox-and-jobs.md)). `apps/e2e` holds the Playwright tests. Turborepo builds packages in dependency order.

## Consequences
- One change can update a schema, the API and the form together.
- `packages/db` replaces the root `prisma/` folder sketched in BASIC_PHASE_DESIGN A3. It is a workspace package, so every app imports the same generated client.
