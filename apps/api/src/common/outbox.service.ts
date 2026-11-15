import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@eduerp/db';
import type { Tx } from './prisma.service';

/** Event types. Consumers subscribe to these in src/worker/consumers.ts. */
export const EVENTS = {
  APPROVAL_PENDING: 'approval.pending',
  APPROVAL_COMPLETED: 'approval.completed',
  NOTIFICATION_EMAIL: 'notification.email',
  STUDENT_ENROLLED: 'student.enrolled',
  STUDENT_STATUS_CHANGED: 'student.status_changed',
} as const;

export interface OutboxEntry {
  /** null = platform-level event (only auth.* types; see migration m03). */
  tenantId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  /** Optional: the same key twice is stored once (e.g. "approval:<id>:level:2"). */
  dedupeKey?: string;
}

/**
 * Transactional outbox (G-06). `add` writes the event with the caller's transaction: if the
 * business change rolls back, the event never existed; if it commits, the worker will deliver it.
 */
@Injectable()
export class OutboxService {
  async add(tx: Tx, e: OutboxEntry): Promise<void> {
    if (e.tenantId) {
      await tx.outboxEvent.create({
        data: {
          tenantId: e.tenantId,
          eventType: e.eventType,
          aggregateType: e.aggregateType,
          aggregateId: e.aggregateId ?? null,
          payload: e.payload as Prisma.InputJsonValue,
          dedupeKey: e.dedupeKey ?? null,
        },
      });
      return;
    }
    // Platform-level event: plain INSERT without RETURNING, because the caller (deliberately) cannot
    // read NULL-tenant rows back under RLS — only the system relay can.
    await tx.$executeRaw`
      INSERT INTO outbox_events (id, tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES (${randomUUID()}::uuid, NULL, ${e.eventType}, ${e.aggregateType}, ${e.aggregateId ?? null}::uuid, ${JSON.stringify(e.payload)}::jsonb, ${e.dedupeKey ?? null})`;
  }
}
