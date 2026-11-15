# ADR-005: Explicit access rule on every route; audit inside the business transaction

**Status:** Accepted (2026-11-13)

## Decision
- One global `AccessGuard`. Every handler must carry exactly one of `@Public()`, `@Authenticated()`, `@PlatformRoute(roles)` or `@RequirePermission(code)`. A route with none is refused at runtime, and a static test fails the build (AC6).
- Permission codes exist only in `packages/shared/src/permissions.ts`, and the DB catalogue is seeded from that file. New institutions get the system roles from the same file.
- Errors are returned as RFC 9457 `application/problem+json` with a stable `type` code and the request id. Internal errors never expose stack traces or SQL.
- `AuditService.log(tx, …)` takes the caller's transaction. A change and its audit row commit or roll back together (AC5, tested by forced failure). Secret fields (`password`, `passwordHash`, `tokenHash`) are removed from audit snapshots.
