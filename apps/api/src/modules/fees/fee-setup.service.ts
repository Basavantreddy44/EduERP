import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import {
  CopyFeeStructureInput, CreateFeeHeadInput, FeeStructureInput, LateFeeRuleInput, PERMISSIONS, PermissionCode, UpdateFeeHeadInput, UpdateFeeStructureInput,
  feeStructureSchema, fromPaise, toPaise,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { defaultIncomeKey, ensureChart } from './ledger';
import { assignToClass, moveToRevision, unassignedCount } from './assignments';

const READ = PERMISSIONS.FEE_READ;
const MANAGE = PERMISSIONS.FEE_SETUP_MANAGE;
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const paise = (d: Prisma.Decimal | string | number) => toPaise(d.toString());

/** Shift a date by whole years (29 Feb → 28 Feb). */
function shiftYears(d: Date, years: number) {
  const t = new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()));
  if (t.getUTCMonth() !== d.getUTCMonth()) t.setUTCDate(0);
  return t;
}

const structureInclude = {
  instalments: { orderBy: { instalmentNo: 'asc' } },
  items: { orderBy: [{ instalmentNo: 'asc' }] },
  campus: { select: { id: true, code: true, name: true } },
  academicYear: { select: { id: true, name: true, status: true, startDate: true } },
  level: { select: { id: true, name: true, sequence: true, program: { select: { id: true, name: true, code: true } } } },
  revisionOf: { select: { id: true, name: true, status: true } },
} satisfies Prisma.FeeStructureInclude;

/**
 * Fee set-up (M2.1): fee heads posting to income accounts, fee structures per class / year (and
 * optional fee group) with instalments, revisions instead of edits once active, copy to the next
 * year, and late-fee rules.
 */
@Injectable()
export class FeeSetupService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }

  // ───────────── Options & accounts ─────────────

  /** What the set-up screens need: years, classes, active fee heads and postable accounts. */
  async options(auth: AuthContext) {
    const scope = this.scope(auth, READ);
    return this.db.run(this.ctx(auth), async (tx) => {
      await ensureChart(tx, auth.tenantId!);
      const [years, campuses, programs, heads, accounts] = await Promise.all([
        tx.academicYear.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, isCurrent: true, status: true, startDate: true } }),
        tx.campus.findMany({ where: scope.all ? {} : { id: { in: scope.campusIds } }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
        tx.program.findMany({
          where: { status: 'ACTIVE', ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
          orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
          select: { id: true, name: true, code: true, campusId: true, levels: { orderBy: { sequence: 'asc' }, select: { id: true, name: true } } },
        }),
        tx.feeHead.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }], include: { incomeAccount: { select: { id: true, code: true, name: true } } } }),
        tx.account.findMany({ where: { isGroup: false, isActive: true, accountType: { in: ['INCOME', 'LIABILITY'] } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, accountType: true, systemKey: true } }),
      ]);
      return { years, campuses, programs, heads, accounts };
    });
  }

  // ───────────── Fee heads ─────────────

  /** Fee heads are institution-wide: only someone who manages fees for every campus may change them. */
  private wholeInstitution(auth: AuthContext) {
    if (!this.scope(auth, MANAGE).all) throw Forbidden('institution-scope', 'Fee heads apply to every campus; ask someone who manages fees for the whole institution');
  }

  async createHead(input: CreateFeeHeadInput, auth: AuthContext, client: ClientInfo) {
    this.wholeInstitution(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const chart = await ensureChart(tx, auth.tenantId!);
      const incomeAccountId = input.incomeAccountId ?? chart.get(defaultIncomeKey(input.feeType))!;
      await this.postable(tx, incomeAccountId);
      if (await tx.feeHead.findFirst({ where: { code: input.code }, select: { id: true } })) throw Conflict('code-taken', `Code ${input.code} is already used`);
      const h = await tx.feeHead.create({
        data: { tenantId: auth.tenantId!, name: input.name, code: input.code, feeType: input.feeType, incomeAccountId, isRefundable: input.isRefundable, gstApplicable: input.gstApplicable, createdBy: auth.userId },
        include: { incomeAccount: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.log(tx, { tenantId: h.tenantId, userId: auth.userId, action: 'CREATE', entityType: 'FEE_HEAD', entityId: h.id, newValues: h }, client);
      return h;
    });
  }

  async updateHead(id: string, input: UpdateFeeHeadInput, auth: AuthContext, client: ClientInfo) {
    this.wholeInstitution(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.feeHead.findUnique({ where: { id } });
      if (!before) throw NotFound('Fee head');
      if (input.incomeAccountId) await this.postable(tx, input.incomeAccountId);
      const h = await tx.feeHead.update({
        where: { id },
        data: { ...input, incomeAccountId: input.incomeAccountId ?? undefined, updatedBy: auth.userId },
        include: { incomeAccount: { select: { id: true, code: true, name: true } } },
      });
      await this.audit.log(tx, { tenantId: h.tenantId, userId: auth.userId, action: 'UPDATE', entityType: 'FEE_HEAD', entityId: id, oldValues: before, newValues: h }, client);
      return h;
    });
  }

  private async postable(tx: Tx, accountId: string) {
    const a = await tx.account.findUnique({ where: { id: accountId }, select: { isGroup: true, isActive: true, accountType: true } });
    if (!a || a.isGroup || !a.isActive || !['INCOME', 'LIABILITY'].includes(a.accountType)) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'account-not-postable', 'Choose an active income or deposit account', [{ field: 'incomeAccountId', message: 'Choose an income or deposit account' }]);
    }
  }

  // ───────────── Structures ─────────────

  async structures(auth: AuthContext, q: { campusId?: string; academicYearId?: string; programLevelId?: string; status?: string }) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.feeStructure.findMany({
        where: {
          ...(q.campusId ? { campusId: q.campusId } : scope.all ? {} : { campusId: { in: scope.campusIds } }),
          ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}),
          ...(q.programLevelId ? { programLevelId: q.programLevelId } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
        orderBy: [{ academicYear: { startDate: 'desc' } }, { level: { program: { name: 'asc' } } }, { level: { sequence: 'asc' } }, { feeGroup: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
        include: { ...structureInclude, items: false, _count: { select: { items: true } } },
      });
      return rows;
    });
  }

  async structure(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.feeStructure.findUnique({ where: { id }, include: { ...structureInclude, revisions: { select: { id: true, status: true, name: true } } } });
      if (!s || !canAccessCampus(this.scope(auth, READ), s.campusId)) throw NotFound('Fee structure');
      const [studentCount, withoutFees] = await Promise.all([
        tx.studentFeeAssignment.count({ where: { feeStructureId: id, status: 'ACTIVE' } }),
        s.status === 'ACTIVE' && !s.feeGroup ? unassignedCount(tx, s.academicYearId, s.programLevelId) : Promise.resolve(0),
      ]);
      return { ...s, studentCount, withoutFees };
    });
  }

  /** Checks placement (class of the campus, open year) and that every fee head is active. */
  private async validate(tx: Tx, input: FeeStructureInput) {
    if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
    const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { name: true, status: true } });
    if (!year) throw NotFound('Academic year');
    if (year.status === 'CLOSED') throw Conflict('academic-year-closed', `${year.name} is closed`);
    const level = await tx.programLevel.findUnique({ where: { id: input.programLevelId }, select: { program: { select: { campusId: true } } } });
    if (!level || level.program.campusId !== input.campusId) throw NotFound('Class');
    const headIds = [...new Set(input.items.map((i) => i.feeHeadId))];
    const heads = await tx.feeHead.findMany({ where: { id: { in: headIds } }, select: { id: true, status: true, name: true } });
    if (heads.length !== headIds.length) throw NotFound('Fee head');
    const off = heads.find((h) => h.status !== 'ACTIVE');
    if (off) throw Conflict('fee-head-inactive', `${off.name} is inactive`);
  }

  private async writeLines(tx: Tx, structureId: string, tenantId: string, input: Pick<FeeStructureInput, 'instalments' | 'items'>) {
    await tx.feeStructureItem.deleteMany({ where: { feeStructureId: structureId } });
    await tx.feeStructureInstalment.deleteMany({ where: { feeStructureId: structureId } });
    await tx.feeStructureInstalment.createMany({ data: input.instalments.map((i) => ({ tenantId, feeStructureId: structureId, instalmentNo: i.instalmentNo, name: i.name, dueDate: day(i.dueDate) })) });
    const items = input.items.filter((i) => toPaise(i.amount) > 0); // a blank cell is "no fee", not a ₹0 line
    if (items.length) await tx.feeStructureItem.createMany({ data: items.map((i) => ({ tenantId, feeStructureId: structureId, feeHeadId: i.feeHeadId, instalmentNo: i.instalmentNo, amount: i.amount })) });
    return fromPaise(items.reduce((a, i) => a + toPaise(i.amount), 0));
  }

  async createStructure(input: FeeStructureInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.scope(auth, MANAGE), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.validate(tx, input);
      const s = await tx.feeStructure.create({
        data: { tenantId: auth.tenantId!, campusId: input.campusId, academicYearId: input.academicYearId, programLevelId: input.programLevelId, name: input.name, feeGroup: input.feeGroup || null, createdBy: auth.userId },
      });
      const totalAmount = await this.writeLines(tx, s.id, s.tenantId, input);
      const saved = await tx.feeStructure.update({ where: { id: s.id }, data: { totalAmount }, include: structureInclude });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'FEE_STRUCTURE', entityId: s.id, newValues: { ...saved, items: input.items.length } }, client);
      return saved;
    });
  }

  private async lockDraft(tx: Tx, id: string, auth: AuthContext) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fee_structures WHERE id = ${id}::uuid FOR UPDATE`;
    const s = rows.length ? await tx.feeStructure.findUnique({ where: { id } }) : null;
    if (!s || !canAccessCampus(this.scope(auth, MANAGE), s.campusId)) throw NotFound('Fee structure');
    return s;
  }

  async updateStructure(id: string, input: UpdateFeeStructureInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await this.lockDraft(tx, id, auth);
      if (before.status !== 'DRAFT') throw Conflict('structure-locked', 'An active structure cannot be edited. Use "Revise" to make a new version.');
      const full = feeStructureSchema.safeParse({ ...input, campusId: before.campusId, academicYearId: before.academicYearId, programLevelId: before.programLevelId });
      if (!full.success) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'validation-failed', 'Some fields are invalid', full.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
      await this.validate(tx, full.data);
      const totalAmount = await this.writeLines(tx, id, before.tenantId, full.data);
      const s = await tx.feeStructure.update({ where: { id }, data: { name: full.data.name, feeGroup: full.data.feeGroup || null, totalAmount, updatedBy: auth.userId }, include: structureInclude });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'FEE_STRUCTURE', entityId: id, oldValues: { name: before.name, totalAmount: before.totalAmount }, newValues: { name: s.name, totalAmount } }, client);
      return s;
    });
  }

  /** DRAFT → ACTIVE. A revision replaces the version it revises (that one is closed). */
  async activate(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockDraft(tx, id, auth);
      if (s.status !== 'DRAFT') throw Conflict('invalid-transition', `This structure is already ${s.status.toLowerCase()}`);
      if (paise(s.totalAmount) === 0) throw Conflict('structure-empty', 'Enter at least one amount before making the structure active');
      let closed: string | null = null;
      if (s.revisionOfId) {
        const old = await tx.feeStructure.findUnique({ where: { id: s.revisionOfId }, select: { id: true, status: true } });
        if (old?.status === 'ACTIVE') {
          await tx.feeStructure.update({ where: { id: old.id }, data: { status: 'CLOSED', updatedBy: auth.userId } });
          closed = old.id;
        }
      }
      const clash = await tx.feeStructure.findFirst({
        where: { status: 'ACTIVE', academicYearId: s.academicYearId, programLevelId: s.programLevelId, feeGroup: s.feeGroup ? { equals: s.feeGroup, mode: 'insensitive' } : null },
        select: { name: true },
      });
      if (clash) throw Conflict('structure-exists', `"${clash.name}" is already active for this class${s.feeGroup ? ` and fee group ${s.feeGroup}` : ''}. Revise that one, or close it first.`);
      const a = await tx.feeStructure.update({ where: { id }, data: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: auth.userId, updatedBy: auth.userId }, include: structureInclude });
      // Students on the old version move to this one; current students with no fees get it (default structure only).
      const moved = closed ? (await moveToRevision(tx, closed, id)).count : 0;
      const assigned = await assignToClass(tx, id, auth.userId);
      await this.audit.log(tx, { tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'FEE_STRUCTURE', entityId: id, oldValues: { status: 'DRAFT' }, newValues: { status: 'ACTIVE', replaced: closed, moved, assigned } }, client);
      return { ...a, moved, assigned };
    });
  }

  /** Gives this (default) structure to current students of the class who have no fees yet. */
  async assign(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.feeStructure.findUnique({ where: { id } });
      if (!s || !canAccessCampus(this.scope(auth, MANAGE), s.campusId)) throw NotFound('Fee structure');
      if (s.status !== 'ACTIVE') throw Conflict('structure-not-active', 'Make the structure active first');
      if (s.feeGroup) throw Conflict('fee-group', 'A fee-group structure is given to students one by one, from their fee page');
      const assigned = await assignToClass(tx, id, auth.userId);
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'FEE_STRUCTURE', entityId: id, newValues: { assigned } }, client);
      return { assigned };
    });
  }

  async close(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockDraft(tx, id, auth);
      if (s.status !== 'ACTIVE') throw Conflict('invalid-transition', s.status === 'DRAFT' ? 'A draft is deleted, not closed' : 'This structure is already closed');
      const c = await tx.feeStructure.update({ where: { id }, data: { status: 'CLOSED', updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: c.tenantId, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'FEE_STRUCTURE', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'CLOSED' } }, client);
      return c;
    });
  }

  async remove(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockDraft(tx, id, auth);
      if (s.status !== 'DRAFT') throw Conflict('structure-locked', 'Only a draft can be deleted');
      await tx.feeStructure.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'DELETE', entityType: 'FEE_STRUCTURE', entityId: id, oldValues: { name: s.name, totalAmount: s.totalAmount } }, client);
      return { deleted: true };
    });
  }

  /** New DRAFT copy of an active structure; activating it closes the old version. */
  async revise(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockDraft(tx, id, auth);
      if (s.status !== 'ACTIVE') throw Conflict('invalid-transition', 'Only an active structure is revised; edit a draft directly');
      const open = await tx.feeStructure.findFirst({ where: { revisionOfId: id, status: 'DRAFT' }, select: { id: true } });
      if (open) throw new AppError(HttpStatus.CONFLICT, 'revision-exists', 'A draft revision already exists', [{ field: 'id', message: open.id }]);
      const copy = await this.copyOne(tx, id, { academicYearId: s.academicYearId, programLevelId: s.programLevelId, years: 0, revisionOfId: id, name: s.name }, auth);
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'FEE_STRUCTURE', entityId: copy.id, newValues: { revisionOf: id } }, client);
      return copy;
    });
  }

  /** Copies a structure to another year (and/or other classes of the same programme) as drafts. */
  async copy(id: string, input: CopyFeeStructureInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.feeStructure.findUnique({ where: { id }, include: { academicYear: true, level: { select: { programId: true, name: true } } } });
      if (!s || !canAccessCampus(this.scope(auth, MANAGE), s.campusId)) throw NotFound('Fee structure');
      const target = await tx.academicYear.findUnique({ where: { id: input.academicYearId } });
      if (!target) throw NotFound('Academic year');
      if (target.status === 'CLOSED') throw Conflict('academic-year-closed', `${target.name} is closed`);
      const levelIds = input.programLevelIds?.length ? input.programLevelIds : [s.programLevelId];
      const levels = await tx.programLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, programId: true, name: true } });
      if (levels.length !== levelIds.length || levels.some((l) => l.programId !== s.level.programId)) throw NotFound('Class');
      const years = target.startDate.getUTCFullYear() - s.academicYear.startDate.getUTCFullYear();
      const out = [];
      for (const l of levels) {
        // "Class 5 fees 2026-27" → "Class 6 fees 2027-28"; a name without the class gets it added.
        const base = s.name.replace(s.academicYear.name, target.name);
        const name = l.id === s.programLevelId ? base : base.includes(s.level.name) ? base.replace(s.level.name, l.name) : `${base} (${l.name})`;
        out.push(await this.copyOne(tx, id, { academicYearId: target.id, programLevelId: l.id, years, revisionOfId: null, name }, auth));
      }
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'FEE_STRUCTURE', entityId: id, newValues: { copiedTo: out.map((o) => o.id), year: target.name } }, client);
      return out;
    });
  }

  private async copyOne(tx: Tx, fromId: string, to: { academicYearId: string; programLevelId: string; years: number; revisionOfId: string | null; name: string }, auth: AuthContext) {
    const src = await tx.feeStructure.findUniqueOrThrow({ where: { id: fromId }, include: { instalments: true, items: { include: { feeHead: { select: { status: true } } } } } });
    const s = await tx.feeStructure.create({
      data: { tenantId: src.tenantId, campusId: src.campusId, academicYearId: to.academicYearId, programLevelId: to.programLevelId, name: to.name.slice(0, 150), feeGroup: src.feeGroup, revisionOfId: to.revisionOfId, createdBy: auth.userId },
    });
    const totalAmount = await this.writeLines(tx, s.id, s.tenantId, {
      instalments: src.instalments.map((i) => ({ instalmentNo: i.instalmentNo, name: i.name, dueDate: iso(shiftYears(i.dueDate, to.years)) })),
      items: src.items.filter((i) => i.feeHead.status === 'ACTIVE').map((i) => ({ feeHeadId: i.feeHeadId, instalmentNo: i.instalmentNo, amount: fromPaise(paise(i.amount)) })),
    });
    return tx.feeStructure.update({ where: { id: s.id }, data: { totalAmount }, include: structureInclude });
  }

  // ───────────── Late fee rules ─────────────

  lateFeeRules(auth: AuthContext) {
    const scope = this.scope(auth, READ);
    return this.db.run(this.ctx(auth), (tx) =>
      tx.lateFeeRule.findMany({
        where: scope.all ? {} : { OR: [{ campusId: null }, { campusId: { in: scope.campusIds } }] },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        include: { campus: { select: { code: true, name: true } }, feeHead: { select: { name: true, code: true } } },
      }),
    );
  }

  async saveLateFeeRule(id: string | null, input: LateFeeRuleInput & { status?: 'ACTIVE' | 'INACTIVE' }, auth: AuthContext, client: ClientInfo) {
    const scope = this.scope(auth, MANAGE);
    if (input.campusId ? !canAccessCampus(scope, input.campusId) : !scope.all) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (input.feeHeadId && !(await tx.feeHead.findUnique({ where: { id: input.feeHeadId }, select: { id: true } }))) throw NotFound('Fee head');
      const data = {
        name: input.name, campusId: input.campusId ?? null, feeHeadId: input.feeHeadId ?? null, graceDays: input.graceDays, fineType: input.fineType,
        fineValue: input.fineValue, maxFine: input.maxFine ?? null, ...(input.status ? { status: input.status } : {}),
      };
      const before = id ? await tx.lateFeeRule.findUnique({ where: { id } }) : null;
      if (id && (!before || (before.campusId ? !canAccessCampus(scope, before.campusId) : !scope.all))) throw NotFound('Late fee rule');
      const r = id
        ? await tx.lateFeeRule.update({ where: { id }, data })
        : await tx.lateFeeRule.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: r.tenantId, userId: auth.userId, campusId: r.campusId, action: id ? 'UPDATE' : 'CREATE', entityType: 'LATE_FEE_RULE', entityId: r.id, oldValues: before ?? undefined, newValues: r }, client);
      return r;
    });
  }
}
