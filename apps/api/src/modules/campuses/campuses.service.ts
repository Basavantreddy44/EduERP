import { Injectable } from '@nestjs/common';
import { PERMISSIONS, CreateCampusInput, UpdateCampusInput } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, campusFilter, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

@Injectable()
export class CampusesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  list(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_CAMPUS_READ)!;
    return this.db.run(this.ctx(auth), (tx) => tx.campus.findMany({ where: campusFilter(scope), orderBy: { code: 'asc' } }));
  }

  /** Out-of-scope and other-tenant campuses both return 404, so their existence is not revealed. */
  async get(id: string, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_CAMPUS_READ)!;
    if (!canAccessCampus(scope, id)) throw NotFound('Campus');
    const campus = await this.db.run(this.ctx(auth), (tx) => tx.campus.findUnique({ where: { id } }));
    if (!campus) throw NotFound('Campus');
    return campus;
  }

  async create(input: CreateCampusInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_CAMPUS_CREATE)!;
    if (!scope.all) throw Forbidden('scope-insufficient', 'Only institution-wide users can add campuses');
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      if (await tx.campus.findUnique({ where: { tenantId_code: { tenantId, code: input.code } }, select: { id: true } })) {
        throw Conflict('campus-code-taken', `Campus code ${input.code} already exists`);
      }
      const campus = await tx.campus.create({ data: { ...input, tenantId, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId: campus.id, action: 'CREATE', entityType: 'CAMPUS', entityId: campus.id, newValues: campus }, client);
      return campus;
    });
  }

  async update(id: string, input: UpdateCampusInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_CAMPUS_UPDATE)!;
    if (!canAccessCampus(scope, id)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.campus.findUnique({ where: { id } });
      if (!before) throw NotFound('Campus');
      const after = await tx.campus.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      const changed = Object.keys(input) as (keyof UpdateCampusInput)[];
      await this.audit.log(tx, {
        tenantId: auth.tenantId!, userId: auth.userId, campusId: id, action: 'UPDATE', entityType: 'CAMPUS', entityId: id,
        oldValues: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])),
        newValues: Object.fromEntries(changed.map((k) => [k, after[k as keyof typeof after]])),
      }, client);
      return after;
    });
  }
}
