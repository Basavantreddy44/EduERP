# ADR-006: Transactional outbox + pg-boss worker

**Status:** Accepted (2026-11-14) · **Decision:** DEC-03 → CD-11, CD-16

## Context
Modules must react to each other's changes (approval decided → notify; later: fee paid → journal, admission → enrolment) without dual writes, lost events or duplicate effects.

## Decision
1. **Outbox in the business transaction.** `OutboxService.add(tx, …)` inserts into `outbox_events` with the caller's transaction. Rollback → the event never existed (AC11). Optional `dedupe_key` (unique) stops the same logical event being stored twice.
2. **Separate worker process** (`pnpm worker`, entry `apps/api/src/worker/main.ts`). It reuses the API's services, so it lives in the `apps/api` package as a second entry point rather than a separate `apps/worker` package (ADR-001 is adjusted accordingly).
3. **Relay.** Every `OUTBOX_POLL_MS` the worker reads PENDING rows (`FOR UPDATE SKIP LOCKED`, so several workers can run), sends one pg-boss job per subscribed consumer, and marks the row DISPATCHED. Job ids are deterministic (UUIDv5 of consumer + event), so a re-send after a crash creates no second job.
4. **Consumers are idempotent.** Each consumer has its own queue. A job runs in a **tenant** transaction that checks and then writes `processed_events (consumer, event_id)` together with the handler's database effects, so those effects happen exactly once. External side effects (an email) are at-least-once: a crash after sending but before commit can resend.
5. **Failures.** pg-boss retries with exponential backoff (`JOBS_RETRY_LIMIT`, `JOBS_RETRY_DELAY_SECONDS`). Each failure is recorded on the outbox row (`attempts`, `last_error`). After the last retry the job goes to the `dead-letter` queue, which marks the row FAILED and calls the consumer's `onFailed` (e.g. the email delivery becomes FAILED).
6. **Tenant safety.** Only the relay reads across tenants. It uses `app.is_system = 'on'`, which allows SELECT/UPDATE on `outbox_events` and nothing else. Every handler runs in a normal tenant context under RLS.
7. **Least privilege.** The runtime role cannot create tables, so `jobs:setup` (run as the owner after migrations, idempotent) installs or upgrades the pg-boss schema, creates the queues with their retry policy, and grants the runtime role row access only. The worker then runs pg-boss with `migrate: false`.

## Consequences
- No Redis needed for jobs; Postgres backups cover queued work.
- One extra process to deploy and monitor (`worker`). Outbox rows with status FAILED are the alerting signal; a replay tool comes with the ops console.
- At very high volume the queue can move to BullMQ/SQS behind the same `Consumer` interface.
