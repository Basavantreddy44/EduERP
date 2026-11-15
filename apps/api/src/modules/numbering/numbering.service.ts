import { HttpStatus, Injectable } from '@nestjs/common';
import { CreateSequenceInput, DocType, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, campusFilter, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

export interface AllocateRequest {
  docType: DocType;
  campusId?: string | null;
  yearLabel?: string;
}

/**
 * Document numbering (G-05). `allocate` must be called with the business transaction: it takes a
 * row lock on the series and increments it, so the number is consumed only if that transaction
 * commits (no gaps), and concurrent callers queue on the lock (no duplicates).
 */
@Injectable()
export class NumberingService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Campus series first, then the institution-wide series. Runs inside the caller's tenant transaction. */
  async allocate(tx: Tx, req: AllocateRequest): Promise<string> {
    const yearLabel = req.yearLabel ?? '';
    const candidates = req.campusId ? [req.campusId, null] : [null];
    for (const campusId of candidates) {
      const rows = await tx.$queryRaw<{ n: number; prefix: string; padding: number }[]>`
        UPDATE number_sequences
           SET next_number = next_number + 1, updated_at = now()
         WHERE tenant_id = app_current_tenant()
           AND doc_type = ${req.docType}
           AND year_label = ${yearLabel}
           AND campus_id IS NOT DISTINCT FROM ${campusId}::uuid
        RETURNING next_number - 1 AS n, prefix, padding`;
      if (rows.length) {
        const { n, prefix, padding } = rows[0];
        return `${prefix}${String(n).padStart(padding, '0')}`;
      }
    }
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'numbering-not-configured', `No number series is set up for ${req.docType}${yearLabel ? ` (${yearLabel})` : ''}`);
  }

  list(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_NUMBERING_MANAGE)!;
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, (tx) =>
      tx.numberSequence.findMany({
        where: scope.all ? {} : { OR: [{ campusId: null }, campusFilter(scope, 'campusId')] },
        orderBy: [{ docType: 'asc' }, { yearLabel: 'desc' }],
      }),
    );
  }

  async create(input: CreateSequenceInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_NUMBERING_MANAGE)!;
    const campusId = input.campusId ?? null;
    if (campusId ? !canAccessCampus(scope, campusId) : !scope.all) {
      if (campusId) throw NotFound('Campus');
      throw Forbidden('scope-insufficient', 'Only institution-wide users can create institution-wide series');
    }
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const tenantId = auth.tenantId!;
      if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
      const dup = await tx.numberSequence.findFirst({ where: { docType: input.docType, yearLabel: input.yearLabel, campusId }, select: { id: true } });
      if (dup) throw Conflict('sequence-exists', 'A number series already exists for this document type, campus and year');
      const seq = await tx.numberSequence.create({
        data: { tenantId, campusId, docType: input.docType, prefix: input.prefix, yearLabel: input.yearLabel, nextNumber: input.startAt, padding: input.padding, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId, action: 'CREATE', entityType: 'NUMBER_SEQUENCE', entityId: seq.id, newValues: seq }, client);
      return seq;
    });
  }
}
