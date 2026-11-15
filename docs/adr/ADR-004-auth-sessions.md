# ADR-004: Authentication and sessions

**Status:** Accepted (2026-11-13) · **Decision:** DEC-08 → CD-09

## Decision
- **Passwords:** argon2id (`@node-rs/argon2`). Unknown users are checked against a dummy hash so response time doesn't reveal which accounts exist. After 5 failures the account locks for 15 minutes (configurable). Every attempt is written to `login_history`.
- **Access token:** HS256 JWT with a 15-minute lifetime, claims `sub` (user), `tid` (tenant or null) and `sid` (session family). It is kept only in browser memory.
- **Refresh token:** 32 random bytes; only its SHA-256 hash is stored. It is sent as an `httpOnly; SameSite=Strict` cookie limited to `/api/v1/auth`, and `Secure` in production.
  - Each refresh rotates the token.
  - **Reusing a rotated token revokes the whole session family.** Exception: within a 10-second grace window it gets `refresh-stale` instead, so two tabs refreshing at once don't log the user out.
- **Every request re-checks** the session family, user status, membership and tenant status in the DB. Logout, membership removal and suspension take effect immediately (tested).
- **Multiple institutions:** a user with several memberships logs in with no tenant and must choose one. `switch-tenant` ends the old session and starts a new one.
- **Not built yet (later in B1):** mobile OTP login for parents/students, TOTP for admins, password reset and invite emails. These need the notifications core.
