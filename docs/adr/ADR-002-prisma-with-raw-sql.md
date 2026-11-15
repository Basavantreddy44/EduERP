# ADR-002: Prisma, with hand-written SQL in every migration that needs it

**Status:** Accepted (2026-11-13) · **Decision:** DEC-02 → CD-07

## Context
Prisma gives typed queries and migrations, but it cannot express RLS policies, CHECK constraints, grants, partial unique indexes or `NULLS NOT DISTINCT`. Our safety rules depend on exactly those features.

## Decision
- `schema.prisma` describes tables, columns, FKs (including **composite tenant FKs** such as `(tenant_id, role_id) → roles(tenant_id, id)`) and plain indexes.
- Each migration is created with `pnpm --filter @eduerp/db migrate:new <name>`. Since M0.2 this runs `prisma migrate diff` between the (up-to-date) dev database and `schema.prisma`, because the shadow database used by `migrate dev` cannot replay our hand-written grants. The script removes Prisma's proposals to drop hand-written indexes, lists any other drops for review, and appends the marked hand-written section header.
- **Review rule:** if Prisma proposes `DROP POLICY`, `DROP INDEX` or `DROP CONSTRAINT` for something created in a hand-written section, delete that line.
- Pinned to Prisma **6.19.x**. Prisma 7 changes configuration and driver loading, so upgrading will get its own ADR.

## Consequences
- The database enforces isolation and integrity even if application code has a bug.
- Every migration needs reviewer discipline. The integration tests rebuild the test DB from migrations, so a lost policy fails CI.
