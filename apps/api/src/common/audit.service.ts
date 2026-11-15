import { Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import type { Tx } from './prisma.service';
import type { ClientInfo } from './decorators';

export interface AuditEntry {
  tenantId: string;
  userId: string | null;
  campusId?: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'INVITE' | 'REMOVE' | 'LOGIN' | 'EXPORT' | 'UPLOAD' | 'SUBMIT' | 'APPROVE' | 'REJECT';
  entityType: string;
  entityId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
}

/**
 * Writes audit rows INSIDE the caller's transaction: if the business change rolls back, so does
 * its audit row, and a business change cannot commit without its audit row (AC5).
 */
@Injectable()
export class AuditService {
  async log(tx: Tx, entry: AuditEntry, client?: ClientInfo): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId,
        campusId: entry.campusId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValues: toJson(entry.oldValues),
        newValues: toJson(entry.newValues),
        reason: entry.reason ?? null,
        ipAddress: client?.ip ?? null,
        requestId: client?.requestId ?? null,
      },
    });
  }
}

const SECRET_KEYS = new Set(['passwordHash', 'password', 'tokenHash']);

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(v, (k, val) => (SECRET_KEYS.has(k) ? undefined : typeof val === 'bigint' ? Number(val) : val)));
}
