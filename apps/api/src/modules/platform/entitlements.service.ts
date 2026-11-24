import { HttpStatus, Injectable } from '@nestjs/common';
import { AssignPlanInput, CORE_MODULES, CreatePlanInput, EditionCode, MODULES, ModuleCode, ModuleOverrideInput, editionModules } from '@eduerp/shared';
import { Prisma } from '@eduerp/db';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const isCore = (code: string) => (CORE_MODULES as string[]).includes(code);

/**
 * Plans and module entitlements (G-13). Platform staff define plans and assign them; each
 * institution's final on/off list is `tenant_modules` (core modules always on, platform overrides kept).
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** New institutions start on a trial with their edition's modules switched on (Standard: every module). */
  static async seedTrialModules(tx: Tx, tenantId: string, userId: string | null, edition: EditionCode = 'STANDARD'): Promise<void> {
    await tx.tenantModule.createMany({
      data: editionModules(edition).map((m) => ({ tenantId, moduleCode: m.code, isEnabled: m.isEnabled, source: isCore(m.code) ? 'CORE' : 'PLAN', updatedBy: userId })),
      skipDuplicates: true,
    });
  }

  /** For the guard and the web menu: enabled module codes of the current institution. */
  static async enabledModules(tx: Tx): Promise<Set<string>> {
    const rows = await tx.tenantModule.findMany({ where: { isEnabled: true }, select: { moduleCode: true } });
    return new Set([...CORE_MODULES, ...rows.map((r) => r.moduleCode)]);
  }

  // ───────────── Plans ─────────────

  async listPlans() {
    const plans = await this.db.run({ isPlatform: true }, (tx) =>
      tx.plan.findMany({ orderBy: [{ isActive: 'desc' }, { pricePerStudent: 'asc' }], include: { modules: { select: { moduleCode: true } }, _count: { select: { subscriptions: { where: { status: { in: ['TRIAL', 'ACTIVE'] } } } } } } }),
    );
    return plans.map(({ modules, _count, pricePerStudent, ...p }) => ({ ...p, pricePerStudent: Number(pricePerStudent), modules: modules.map((m) => m.moduleCode), activeInstitutions: _count.subscriptions }));
  }

  async createPlan(input: CreatePlanInput) {
    return this.db.run({ isPlatform: true }, async (tx) => {
      if (await tx.plan.findUnique({ where: { code: input.code }, select: { id: true } })) throw Conflict('plan-code-taken', `Plan code ${input.code} already exists`);
      const modules = [...new Set(input.modules.filter((m) => !isCore(m)))];
      const plan = await tx.plan.create({
        data: { name: input.name, code: input.code, description: input.description ?? null, pricePerStudent: input.pricePerStudent, billingCycle: input.billingCycle, maxStudents: input.maxStudents ?? null, modules: { create: modules.map((moduleCode) => ({ moduleCode })) } },
      });
      return { ...plan, pricePerStudent: Number(plan.pricePerStudent), modules };
    });
  }

  // ───────────── Institution entitlements ─────────────

  async tenantEntitlements(tenantId: string) {
    return this.db.run({ isPlatform: true }, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw NotFound('Institution');
      return this.describe(tx, tenantId);
    });
  }

  private async describe(tx: Tx, tenantId: string) {
    const [sub, rows] = await Promise.all([
      tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } }, include: { plan: { select: { name: true, code: true } } } }),
      tx.tenantModule.findMany({ where: { tenantId }, select: { moduleCode: true, isEnabled: true, source: true } }),
    ]);
    return {
      subscription: sub ? { id: sub.id, plan: sub.plan, status: sub.status, startDate: iso(sub.startDate), endDate: iso(sub.endDate), studentCount: sub.studentCount, amount: Number(sub.amount) } : null,
      modules: MODULES.map((m) => {
        const r = rows.find((x) => x.moduleCode === m.code);
        return { code: m.code, name: m.name, group: m.group, core: isCore(m.code), isEnabled: isCore(m.code) || !!r?.isEnabled, source: isCore(m.code) ? 'CORE' : r?.source ?? 'PLAN' };
      }),
    };
  }

  /** Replaces the live subscription and recomputes modules from the plan (platform overrides are kept). */
  async assignPlan(tenantId: string, input: AssignPlanInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
      if (!tenant) throw NotFound('Institution');
      const plan = await tx.plan.findUnique({ where: { id: input.planId }, include: { modules: true } });
      if (!plan || !plan.isActive) throw NotFound('Plan');
      if (plan.maxStudents !== null && input.studentCount > plan.maxStudents) {
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'plan-student-limit', `${plan.name} allows up to ${plan.maxStudents} students`);
      }
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`; // audit row belongs to this institution

      const previous = await tx.tenantSubscription.findFirst({ where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } }, include: { plan: { select: { code: true } } } });
      if (previous) await tx.tenantSubscription.update({ where: { id: previous.id }, data: { status: 'CANCELLED' } });
      const amount = new Prisma.Decimal(plan.pricePerStudent).mul(input.studentCount);
      const sub = await tx.tenantSubscription.create({
        data: { tenantId, planId: plan.id, status: input.status, startDate: day(input.startDate), endDate: day(input.endDate), studentCount: input.studentCount, amount, createdBy: auth.userId },
      });

      const inPlan = new Set(plan.modules.map((m) => m.moduleCode));
      const overrides = new Set((await tx.tenantModule.findMany({ where: { tenantId, source: 'OVERRIDE' }, select: { moduleCode: true } })).map((r) => r.moduleCode));
      for (const m of MODULES) {
        if (overrides.has(m.code)) continue;
        const enabled = isCore(m.code) || inPlan.has(m.code);
        await tx.tenantModule.upsert({
          where: { tenantId_moduleCode: { tenantId, moduleCode: m.code } },
          update: { isEnabled: enabled, source: isCore(m.code) ? 'CORE' : 'PLAN', updatedBy: auth.userId },
          create: { tenantId, moduleCode: m.code, isEnabled: enabled, source: isCore(m.code) ? 'CORE' : 'PLAN', updatedBy: auth.userId },
        });
      }
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'UPDATE', entityType: 'SUBSCRIPTION', entityId: sub.id, oldValues: previous ? { plan: previous.plan.code, status: previous.status } : null, newValues: { plan: plan.code, status: input.status, startDate: input.startDate, endDate: input.endDate, studentCount: input.studentCount } }, client);
      return this.describe(tx, tenantId);
    });
  }

  /** Switches one module on/off for an institution regardless of plan (e.g. a paid add-on, or a block). */
  async overrideModule(tenantId: string, input: ModuleOverrideInput, auth: AuthContext, client: ClientInfo) {
    if (isCore(input.moduleCode)) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'module-core', 'Core modules are always on');
    return this.db.run({ isPlatform: true, userId: auth.userId }, async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw NotFound('Institution');
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const before = await tx.tenantModule.findUnique({ where: { tenantId_moduleCode: { tenantId, moduleCode: input.moduleCode } } });
      await tx.tenantModule.upsert({
        where: { tenantId_moduleCode: { tenantId, moduleCode: input.moduleCode } },
        update: { isEnabled: input.isEnabled, source: 'OVERRIDE', updatedBy: auth.userId },
        create: { tenantId, moduleCode: input.moduleCode, isEnabled: input.isEnabled, source: 'OVERRIDE', updatedBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'UPDATE', entityType: 'TENANT_MODULE', entityId: null, oldValues: before ? { module: input.moduleCode, isEnabled: before.isEnabled } : null, newValues: { module: input.moduleCode, isEnabled: input.isEnabled } }, client);
      return this.describe(tx, tenantId);
    });
  }

  /** The current institution's view (dashboard "Your plan", web menu). */
  async mine(auth: AuthContext) {
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const [d, t] = await Promise.all([
        this.describe(tx, auth.tenantId!),
        tx.tenant.findUnique({ where: { id: auth.tenantId! }, select: { name: true, nameLocal: true, slug: true, edition: true, logoFileId: true } }),
      ]);
      return {
        subscription: d.subscription,
        enabled: d.modules.filter((m) => m.isEnabled).map((m) => m.code as ModuleCode),
        edition: (t?.edition ?? 'STANDARD') as EditionCode,
        institution: t ? { name: t.name, nameLocal: t.nameLocal, slug: t.slug, logoVersion: t.logoFileId ? t.logoFileId.slice(0, 8) : null } : null,
      };
    });
  }
}
