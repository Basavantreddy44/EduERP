import { EntitlementsService } from './entitlements.service';
import { Injectable } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { CORE_MODULES, EDITIONS, EditionCode, MODULES, SYSTEM_ROLES, ChangeEditionInput, CreateTenantInput, editionModules } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { Conflict, NotFound } from '../../common/problem';
import type { AuthContext } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';

const TENANT_FIELDS = {
  id: true, name: true, nameLocal: true, slug: true, institutionType: true, email: true, phone: true,
  city: true, state: true, defaultLanguage: true, status: true, edition: true, createdAt: true,
} as const;

@Injectable()
export class TenantsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(edition?: string) {
    return this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: edition ? { edition } : {}, select: TENANT_FIELDS, orderBy: { createdAt: 'desc' } }));
  }

  /**
   * What changing the edition would do (E2). Modules follow the new edition only while the institution
   * has no live plan (with a plan, the plan decides); platform overrides and core modules never change;
   * the new edition's roles are added when missing; nothing is deleted.
   */
  private async editionChanges(tx: Tx, tenantId: string, to: EditionCode) {
    const [sub, rows, roles] = await Promise.all([
      tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true } }),
      tx.tenantModule.findMany({ where: { tenantId }, select: { moduleCode: true, isEnabled: true, source: true } }),
      tx.role.findMany({ where: { tenantId }, select: { code: true } }),
    ]);
    const followsPlan = !!sub;
    const switchOn: string[] = [];
    const switchOff: string[] = [];
    if (!followsPlan) {
      for (const m of editionModules(to)) {
        if ((CORE_MODULES as string[]).includes(m.code)) continue;
        const r = rows.find((x) => x.moduleCode === m.code);
        if (r?.source === 'OVERRIDE') continue;
        const now = !!r?.isEnabled;
        if (m.isEnabled && !now) switchOn.push(m.code);
        if (!m.isEnabled && now) switchOff.push(m.code);
      }
    }
    const have = new Set(roles.map((r) => r.code));
    const rolesAdded = EDITIONS[to].roles.filter((r) => !have.has(r.code));
    return { followsPlan, switchOn, switchOff, rolesAdded };
  }

  async editionPreview(id: string, to: EditionCode) {
    return this.db.run({ isPlatform: true, tenantId: id }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id }, select: { edition: true } });
      if (!t) throw NotFound('Institution');
      const c = await this.editionChanges(tx, id, to);
      const name = (code: string) => MODULES.find((m) => m.code === code)?.name ?? code;
      return {
        from: t.edition, to, followsPlan: c.followsPlan,
        switchOn: c.switchOn.map((code) => ({ code, name: name(code) })),
        switchOff: c.switchOff.map((code) => ({ code, name: name(code) })),
        rolesAdded: c.rolesAdded.map((r) => ({ code: r.code, name: r.name })),
      };
    });
  }

  async changeEdition(id: string, input: ChangeEditionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, tenantId: id }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id }, select: { edition: true } });
      if (!before) throw NotFound('Institution');
      if (before.edition === input.edition) throw Conflict('edition-same', 'The institution already has this edition');
      const c = await this.editionChanges(tx, id, input.edition);
      for (const code of [...c.switchOn, ...c.switchOff]) {
        const isEnabled = c.switchOn.includes(code);
        await tx.tenantModule.upsert({
          where: { tenantId_moduleCode: { tenantId: id, moduleCode: code } },
          update: { isEnabled, source: 'PLAN', updatedBy: auth.userId },
          create: { tenantId: id, moduleCode: code, isEnabled, source: 'PLAN', updatedBy: auth.userId },
        });
      }
      if (c.rolesAdded.length) {
        const perms = await tx.permission.findMany({ select: { id: true, code: true } });
        const permId = new Map(perms.map((p) => [p.code, p.id]));
        for (const r of c.rolesAdded) {
          const role = await tx.role.create({ data: { tenantId: id, code: r.code, name: r.name, isSystem: true, createdBy: auth.userId } });
          await tx.rolePermission.createMany({ data: r.permissions.filter((p) => permId.has(p)).map((p) => ({ tenantId: id, roleId: role.id, permissionId: permId.get(p)!, createdBy: auth.userId })) });
        }
      }
      const after = await tx.tenant.update({ where: { id }, data: { edition: input.edition, updatedBy: auth.userId }, select: TENANT_FIELDS });
      await this.audit.log(tx, {
        tenantId: id, userId: auth.userId, action: 'UPDATE', entityType: 'TENANT_EDITION', entityId: id,
        oldValues: { edition: before.edition },
        newValues: { edition: input.edition, switchedOn: c.switchOn, switchedOff: c.switchOff, rolesAdded: c.rolesAdded.map((r) => r.code) },
        reason: input.reason,
      }, client);
      return after;
    });
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
      for (const r of [...SYSTEM_ROLES, ...EDITIONS[t.edition as EditionCode].roles]) {
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
      await EntitlementsService.seedTrialModules(tx, tenant.id, auth.userId, t.edition as EditionCode);

      await this.audit.log(tx, { tenantId: tenant.id, userId: auth.userId, action: 'CREATE', entityType: 'TENANT', entityId: tenant.id, newValues: { ...tenant, adminEmail: admin.email } }, client);
      return { ...tenant, adminUserId: adminUser.id, adminExisted: !!existing };
    });
  }

  async setStatus(id: string, status: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, tenantId: id }, async (tx) => {
      const before = await tx.tenant.findUnique({ where: { id }, select: TENANT_FIELDS });
      if (!before) throw NotFound('Institution');
      const after = await tx.tenant.update({ where: { id }, data: { status, billingHold: false, updatedBy: auth.userId }, select: TENANT_FIELDS });
      await this.audit.log(tx, { tenantId: id, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'TENANT', entityId: id, oldValues: { status: before.status }, newValues: { status }, reason }, client);
      return after;
    });
  }
}
