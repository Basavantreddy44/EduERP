# ADR-003: Tenant isolation with RLS and transaction-local context

**Status:** Accepted (2026-11-13) · **Decision:** DEC-05 → CD-08

## Decision
1. **Two DB roles.** `eduerp_owner` owns the schema and runs migrations. `eduerp_app` is the only role the API uses: `NOSUPERUSER NOBYPASSRLS`, with no DELETE on core tables and no UPDATE/DELETE on `audit_logs`.
2. **Context per transaction.** All business code goes through `Db.run(ctx, work)`. The first statement sets `app.tenant_id`, `app.user_id`, `app.is_platform` and `app.login_identifier` with `set_config(..., true)`, which lasts only for that transaction, so it can't leak through pooled connections.
3. **Policies fail closed.** Tenant tables use `tenant_id = app_current_tenant()` for both USING and WITH CHECK, and `FORCE ROW LEVEL SECURITY` is on. With no context, every tenant table returns 0 rows (tested, AC2).
4. **Special cases:**
   - `user_tenants`: a user can read their own memberships, which is needed to list institutions at login.
   - `tenants`: visible if current, if the user is a member, or for platform staff.
   - `users` (global PII): visible as self, as a member of the current tenant, through an exact login/invite lookup, or to platform staff.
5. **The tenant comes from the token only.** Request bodies never set `tenant_id` (tested).
6. **Composite FKs** stop a tenant-B row from referencing a tenant-A row, even for code that holds a B context.
7. **Campus scope is enforced in the app layer** (`AccessGuard` builds permission → campus scope; services filter and return 404 for out-of-scope ids). Moving it into RLS can be revisited later.

## Consequences
- A forgotten `WHERE tenant_id` returns nothing instead of leaking data.
- Each request is one transaction with roughly 3 context/permission queries. Caching permissions in Redis is a later optimisation, and it must keep immediate revocation.
- `refresh_tokens`, `login_history` and `permissions` are global and not under RLS. Only the auth service touches the first two.
