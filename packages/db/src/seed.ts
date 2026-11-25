/**
 * Seeds global master data. Runs as the OWNER role (migrations role), never as the app role.
 *  - permissions catalogue (from @eduerp/shared)
 *  - system roles of every existing institution get newly added permissions
 *  - platform default notification templates (English + Kannada)
 *  - first platform super admin (from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), local/dev only
 * Idempotent: safe to run repeatedly (run it after every deploy that adds permissions or templates).
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { CORE_MODULES, DEFAULT_TEMPLATES, EDITIONS, MODULES, PERMISSION_CATALOGUE, SYSTEM_ROLES } from '@eduerp/shared';

export async function seedPermissions(prisma: PrismaClient): Promise<void> {
  for (const p of PERMISSION_CATALOGUE) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { moduleCode: p.module, description: p.description },
      create: { code: p.code, moduleCode: p.module, description: p.description },
    });
  }
}

/** Adds permissions that were added to a system role's definition since the institution was created. Never removes. */
export async function syncSystemRoles(prisma: PrismaClient): Promise<number> {
  const perms = new Map((await prisma.permission.findMany({ select: { id: true, code: true } })).map((p) => [p.code, p.id]));
  let added = 0;
  // Built-in roles added since an institution was created (CD-86) are created for it — unless the
  // institution already has a role with that code or name, which is left exactly as it is.
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const def of SYSTEM_ROLES) {
    for (const t of tenants) {
      const clash = await prisma.role.findFirst({ where: { tenantId: t.id, OR: [{ code: def.code }, { name: { equals: def.name, mode: 'insensitive' } }] }, select: { id: true } });
      if (!clash) await prisma.role.create({ data: { tenantId: t.id, code: def.code, name: def.name, isSystem: true } });
    }
  }
  for (const def of SYSTEM_ROLES) {
    const roles = await prisma.role.findMany({ where: { code: def.code, isSystem: true }, select: { id: true, tenantId: true } });
    for (const role of roles) {
      const res = await prisma.rolePermission.createMany({
        data: def.permissions.map((code) => ({ tenantId: role.tenantId, roleId: role.id, permissionId: perms.get(code)! })),
        skipDuplicates: true,
      });
      added += res.count;
    }
  }
  // Edition roles (CD-127) of institutions in that edition get rights added to their definition since.
  for (const ed of Object.values(EDITIONS)) {
    for (const def of ed.roles) {
      const roles = await prisma.role.findMany({ where: { code: def.code, isSystem: true, tenant: { edition: ed.code } }, select: { id: true, tenantId: true } });
      for (const role of roles) {
        const res = await prisma.rolePermission.createMany({
          data: def.permissions.filter((code) => perms.has(code)).map((code) => ({ tenantId: role.tenantId, roleId: role.id, permissionId: perms.get(code)! })),
          skipDuplicates: true,
        });
        added += res.count;
      }
    }
  }
  return added;
}

/** Platform default templates (tenant_id NULL). Updates text in place; institution overrides are untouched. */
export async function seedTemplates(prisma: PrismaClient): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findFirst({
      where: { tenantId: null, eventCode: t.eventCode, channel: t.channel, language: t.language },
      select: { id: true },
    });
    if (existing) {
      await prisma.notificationTemplate.update({ where: { id: existing.id }, data: { subject: t.subject, body: t.body, isActive: true } });
    } else {
      await prisma.notificationTemplate.create({ data: { tenantId: null, eventCode: t.eventCode, channel: t.channel, language: t.language, subject: t.subject, body: t.body } });
    }
  }
}

/**
 * Institutions created before entitlements existed get the trial set (every module on), and every
 * institution gets rows for modules added to the catalogue since. Existing switches are never changed.
 */
export async function syncTenantModules(prisma: PrismaClient): Promise<number> {
  const core = new Set<string>(CORE_MODULES);
  const tenants = await prisma.tenant.findMany({ select: { id: true, _count: { select: { modules: true } } } });
  let added = 0;
  for (const t of tenants) {
    const fresh = t._count.modules === 0;
    const res = await prisma.tenantModule.createMany({
      // Fresh institutions: trial = all on. New catalogue entries for configured institutions: on only if core.
      data: MODULES.map((m) => ({ tenantId: t.id, moduleCode: m.code, isEnabled: fresh || core.has(m.code), source: core.has(m.code) ? 'CORE' : 'PLAN' })),
      skipDuplicates: true,
    });
    added += res.count;
  }
  return added;
}

/** Everything a fresh or upgraded database needs before the app runs. */
export async function seedMasters(prisma: PrismaClient): Promise<{ rolePermissionsAdded: number; moduleRowsAdded: number }> {
  await seedPermissions(prisma);
  const rolePermissionsAdded = await syncSystemRoles(prisma);
  await seedTemplates(prisma);
  const moduleRowsAdded = await syncTenantModules(prisma);
  return { rolePermissionsAdded, moduleRowsAdded };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is not set');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const { rolePermissionsAdded, moduleRowsAdded } = await seedMasters(prisma);
    const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (email && password) {
      await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, fullName: 'Platform Admin', passwordHash: await hash(password), platformRole: 'SUPER_ADMIN' },
      });
      console.log(`Seed: platform admin ${email} ready`);
    }
    console.log(`Seed: ${PERMISSION_CATALOGUE.length} permissions, ${DEFAULT_TEMPLATES.length} default templates ready; ${rolePermissionsAdded} permission(s) added to existing system roles; ${moduleRowsAdded} module switch(es) added`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
