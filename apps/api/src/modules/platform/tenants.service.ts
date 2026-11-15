import { EntitlementsService } from './entitlements.service';
import { Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { SYSTEM_ROLES, CreateTenantInput } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { Conflict, NotFound } from '../../common/problem';
import type { AuthContext } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';

const TENANT_FIELDS = {
  id: true, name: true, nameLocal: true, slug: true, institutionType: true, email: true, phone: true,
  city: true, state: true, defaultLanguage: true, status: true, createdAt: true,
} as const;

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ select: TENANT_FIELDS, orderBy: { createdAt: 'desc' } }));
  }

  /**
   * Provisions a new institution in ONE transaction: tenant row, system roles with permissions,
   * the institution admin (new or existing user), membership, all-campus admin role, audit.
   */
  async create(input: CreateTenantInput, auth: AuthContext, client: ClientInfo) {
    const { admin, ...t } = input;
    const passwordHash = await hash(admin.password);

    return this.db.run({ isPlatform: true, loginIdentifier: admin.email }, async (tx) => {
      if (await tx.tenant.findUnique({ where: { slug: t.slug }, select: { id: true } })) {
        throw Conflict('slug-taken', `The address "${t.slug}" is already used by another institution`);
      }
      const tenant = await tx.tenant.create({ data: { ...t, status: 'TRIAL', createdBy: auth.userId }, select: TENANT_FIELDS });

      // From here on, RLS must accept rows for the new tenant.
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      const perms = await tx.permission.findMany({ select: { id: true, code: true } });
      const permId = new Map(perms.map((p) => [p.code, p.id]));
      const roleIds: Record<string, string> = {};
      for (const r of SYSTEM_ROLES) {
        const role = await tx.role.create({ data: { tenantId: tenant.id, code: r.code, name: r.name, isSystem: true, createdBy: auth.userId } });
        roleIds[r.code] = role.id;
        await tx.rolePermission.createMany({
          data: r.permissions.filter((c) => permId.has(c)).map((c) => ({ tenantId: tenant.id, roleId: role.id, permissionId: permId.get(c)!, createdBy: auth.userId })),
        });
      }

      const existing = await tx.user.findUnique({ where: { email: admin.email }, select: { id: true } });
      const adminUser = existing ?? (await tx.user.create({ data: { email: admin.email, fullName: admin.fullName, passwordHash }, select: { id: true } }));
      await tx.userTenant.create({ data: { tenantId: tenant.id, userId: adminUser.id, userType: 'STAFF', status: 'ACTIVE', createdBy: auth.userId } });
      await tx.userRole.create({ data: { tenantId: tenant.id, userId: adminUser.id, roleId: roleIds.INSTITUTION_ADMIN, campusId: null, createdBy: auth.userId } });
      await EntitlementsService.seedTrialModules(tx, tenant.id, auth.userId);

      await this.audit.log(tx, { tenantId: tenant.id, userId: auth.userId, action: 'CREATE', entityType: 'TENANT', entityId: tenant.id, newValues: { ...tenant, adminEmail: admin.email } }, client);
      return { ...tenant, adminUserId: adminUser.id, adminExisted: !!existing };
    });
  }

  async setStatus(id: string, status: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, tenantId: id }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id }, select: TENANT_FIELDS });
      if (!before) throw NotFound('Institution');
      const after = await tx.tenant.update({ where: { id }, data: { status, updatedBy: auth.userId }, select: TENANT_FIELDS });
      await this.audit.log(tx, { tenantId: id, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'TENANT', entityId: id, oldValues: { status: before.status }, newValues: { status }, reason }, client);
      return after;
    });
  }
}
