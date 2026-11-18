import { HttpStatus, Injectable } from '@nestjs/common';
import { GradeScaleInput, PERMISSIONS, PRESET_SCALES, PRESET_SCHEMES, SchemeInput, schemeSchema } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/** The user's campus scope for exams (read falls back to any exams permission). */
export function examScope(auth: AuthContext, code = PERMISSIONS.EXAM_READ): CampusScope {
  return scopeFor(auth, code) ?? scopeFor(auth, PERMISSIONS.EXAM_SETUP) ?? scopeFor(auth, PERMISSIONS.EXAM_PUBLISH) ?? scopeFor(auth, PERMISSIONS.EXAM_VERIFY) ?? scopeFor(auth, PERMISSIONS.EXAM_MARKS) ?? { all: false, campusIds: [] };
}

/**
 * Exams set-up (M9.1): grade scales and assessment schemes. A board's pattern is data — a ready-made
 * pattern is copied in as an ordinary, editable scheme. A scheme's terms and components cannot be
 * changed once an exam uses it (results would no longer match the marks).
 */
@Injectable()
export class ExamSetupService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Grade scales ─────────────

  scales(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.gradeScale.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, include: { items: { orderBy: { minPercent: 'desc' } } } });
      return rows.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, minPercent: Number(i.minPercent), gradePoint: num(i.gradePoint) })) }));
    });
  }

  private async createScaleTx(tx: Tx, input: GradeScaleInput, auth: AuthContext, presetCode: string | null = null) {
    if (await tx.gradeScale.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } })) throw Conflict('scale-name-taken', `${input.name} already exists`);
    const sorted = [...input.items].sort((a, b) => b.minPercent - a.minPercent);
    const scale = await tx.gradeScale.create({ data: { tenantId: auth.tenantId!, name: input.name, presetCode, createdBy: auth.userId } });
    await tx.gradeScaleItem.createMany({ data: sorted.map((i, k) => ({ tenantId: auth.tenantId!, gradeScaleId: scale.id, grade: i.grade.toUpperCase(), minPercent: i.minPercent, gradePoint: i.gradePoint ?? null, description: i.description ?? null, isFail: i.isFail, sortOrder: k })) });
    return scale;
  }

  createScale(input: GradeScaleInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.createScaleTx(tx, input, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'GRADE_SCALE', entityId: s.id, newValues: input }, client);
      return s;
    });
  }

  // ───────────── Schemes ─────────────

  schemes(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.assessmentScheme.findMany({
        where: { status: 'ACTIVE' }, orderBy: { name: 'asc' },
        include: { terms: { orderBy: { sortOrder: 'asc' } }, components: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } }, levels: true, coAreas: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } }, _count: { select: { exams: true } } },
      });
      const levelIds = rows.flatMap((r) => r.levels.map((l) => l.programLevelId));
      const levels = new Map((await tx.programLevel.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true, program: { select: { name: true } } } })).map((l) => [l.id, `${l.program.name} · ${l.name}`]));
      return rows.map(({ _count, ...s }) => ({
        ...s, passPercent: Number(s.passPercent), subjectPassPercent: Number(s.subjectPassPercent), exams: _count.exams,
        terms: s.terms.map((t) => ({ ...t, finalWeight: Number(t.finalWeight) })),
        components: s.components.map((c) => ({ ...c, maxMarks: Number(c.maxMarks), weightage: Number(c.weightage) })),
        levels: s.levels.map((l) => ({ id: l.programLevelId, name: levels.get(l.programLevelId) ?? '' })),
      }));
    });
  }

  private async checkRefs(tx: Tx, input: SchemeInput, schemeId: string | null) {
    const scales = await tx.gradeScale.count({ where: { id: { in: [input.gradeScaleId, ...(input.coScaleId ? [input.coScaleId] : [])] } } });
    if (scales !== (input.coScaleId && input.coScaleId !== input.gradeScaleId ? 2 : 1)) throw NotFound('Grade scale');
    if (input.programLevelIds.length) {
      if ((await tx.programLevel.count({ where: { id: { in: input.programLevelIds } } })) !== input.programLevelIds.length) throw NotFound('Class');
      const taken = await tx.schemeLevel.findFirst({ where: { programLevelId: { in: input.programLevelIds }, ...(schemeId ? { schemeId: { not: schemeId } } : {}) }, include: { scheme: { select: { name: true } } } });
      if (taken) throw Conflict('class-has-scheme', `A chosen class already uses ${taken.scheme.name}`);
    }
  }

  private async writeParts(tx: Tx, schemeId: string, input: SchemeInput, auth: AuthContext) {
    await tx.schemeTerm.createMany({ data: input.terms.map((t, i) => ({ tenantId: auth.tenantId!, schemeId, code: t.code, name: t.name, finalWeight: input.terms.length === 1 ? 100 : t.finalWeight, sortOrder: i })) });
    await tx.assessmentComponent.createMany({ data: input.components.map((c, i) => ({ tenantId: auth.tenantId!, schemeId, termCode: c.termCode, code: c.code, name: c.name, maxMarks: c.maxMarks, weightage: c.weightage, isInternal: c.isInternal, sortOrder: i })) });
    if (input.coAreas.length) await tx.coScholasticArea.createMany({ data: input.coAreas.map((name, i) => ({ tenantId: auth.tenantId!, schemeId, name, sortOrder: i })) });
  }

  private async setLevels(tx: Tx, schemeId: string, levelIds: string[], auth: AuthContext) {
    await tx.$executeRaw`DELETE FROM scheme_levels WHERE scheme_id = ${schemeId}::uuid`;
    if (levelIds.length) await tx.schemeLevel.createMany({ data: levelIds.map((programLevelId) => ({ tenantId: auth.tenantId!, schemeId, programLevelId })) });
  }

  private async createSchemeTx(tx: Tx, input: SchemeInput, auth: AuthContext, presetCode: string | null = null) {
    if (await tx.assessmentScheme.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } })) throw Conflict('scheme-name-taken', `${input.name} already exists`);
    await this.checkRefs(tx, input, null);
    const s = await tx.assessmentScheme.create({
      data: { tenantId: auth.tenantId!, name: input.name, boardId: input.boardId ?? null, presetCode, resultMethod: input.resultMethod, gradeScaleId: input.gradeScaleId, coScaleId: input.coScaleId ?? null, passPercent: input.passPercent, subjectPassPercent: input.subjectPassPercent, roundingRule: input.roundingRule, createdBy: auth.userId },
    });
    await this.writeParts(tx, s.id, input, auth);
    await this.setLevels(tx, s.id, input.programLevelIds, auth);
    return s;
  }

  createScheme(input: SchemeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.createSchemeTx(tx, input, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'ASSESSMENT_SCHEME', entityId: s.id, newValues: input }, client);
      return { id: s.id };
    });
  }

  /** Updates a scheme. Terms, components and areas can only change while no exam uses the scheme. */
  updateScheme(id: string, input: SchemeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.assessmentScheme.findUnique({ where: { id }, include: { terms: true, components: { where: { status: 'ACTIVE' } }, coAreas: { where: { status: 'ACTIVE' } }, _count: { select: { exams: true } } } });
      if (!s) throw NotFound('Scheme');
      if (input.name !== s.name && (await tx.assessmentScheme.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } }))) throw Conflict('scheme-name-taken', `${input.name} already exists`);
      await this.checkRefs(tx, input, id);
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const partsBefore = { terms: s.terms.sort((a, b) => a.sortOrder - b.sortOrder).map((t) => [t.code, t.name, Number(t.finalWeight)]), comps: s.components.sort((a, b) => a.sortOrder - b.sortOrder).map((c) => [c.termCode, c.code, c.name, Number(c.maxMarks), Number(c.weightage), c.isInternal]), areas: s.coAreas.sort((a, b) => a.sortOrder - b.sortOrder).map((a) => a.name) };
      const partsAfter = { terms: input.terms.map((t) => [t.code, t.name, input.terms.length === 1 ? 100 : t.finalWeight]), comps: input.components.map((c) => [c.termCode, c.code, c.name, c.maxMarks, c.weightage, c.isInternal]), areas: input.coAreas };
      const partsChanged = !same(partsBefore, partsAfter);
      if (partsChanged && s._count.exams) throw Conflict('scheme-in-use', 'Exams already use this scheme — its terms and components cannot change now (make a new scheme for next year)');
      await tx.assessmentScheme.update({ where: { id }, data: { name: input.name, boardId: input.boardId ?? null, resultMethod: input.resultMethod, gradeScaleId: input.gradeScaleId, coScaleId: input.coScaleId ?? null, passPercent: input.passPercent, subjectPassPercent: input.subjectPassPercent, roundingRule: input.roundingRule } });
      if (partsChanged) {
        // No exam refers to the old parts: they are replaced (the audit log keeps the old ones).
        if (await tx.coScholasticGrade.count({ where: { area: { schemeId: id } } })) throw Conflict('scheme-in-use', 'Co-scholastic grades are recorded on this scheme — its areas cannot change now');
        await tx.$executeRaw`DELETE FROM scheme_terms WHERE scheme_id = ${id}::uuid`;
        // Old components are kept (retired, code freed) — nothing refers to them since no exam uses the scheme.
        await tx.$executeRaw`UPDATE assessment_components SET status = 'REPLACED', code = left(code, 10) || '~' || left(id::text, 8) WHERE scheme_id = ${id}::uuid AND status = 'ACTIVE'`;
        await tx.coScholasticArea.updateMany({ where: { schemeId: id, status: 'ACTIVE' }, data: { status: 'REPLACED' } });
        await this.writeParts(tx, id, input, auth);
      }
      await this.setLevels(tx, id, input.programLevelIds, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'ASSESSMENT_SCHEME', entityId: id, oldValues: partsBefore, newValues: input }, client);
      return { id, partsChanged };
    });
  }

  /** Copies a ready-made pattern (its scales are reused if already copied). */
  applyPreset(code: string, programLevelIds: string[], auth: AuthContext, client: ClientInfo) {
    const p = PRESET_SCHEMES.find((x) => x.code === code);
    if (!p) throw NotFound('Pattern');
    return this.db.run(this.ctx(auth), async (tx) => {
      const scaleFor = async (c: string) => {
        const ex = await tx.gradeScale.findFirst({ where: { presetCode: c, status: 'ACTIVE' } });
        if (ex) return ex.id;
        const ps = PRESET_SCALES.find((x) => x.code === c)!;
        return (await this.createScaleTx(tx, { name: ps.name, items: ps.items.map((i) => ({ ...i, gradePoint: i.gradePoint ?? null, isFail: !!i.isFail })) }, auth, c)).id;
      };
      const gradeScaleId = await scaleFor(p.scale);
      const coScaleId = p.coScale ? await scaleFor(p.coScale) : null;
      let name = p.name;
      for (let n = 2; await tx.assessmentScheme.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name } }, select: { id: true } }); n++) name = `${p.name} (${n})`;
      const parsed = schemeSchema.safeParse({ ...p, name, gradeScaleId, coScaleId, programLevelIds });
      if (!parsed.success) throw unprocessable('pattern-invalid', parsed.error.issues[0].message, 'programLevelIds');
      const s = await this.createSchemeTx(tx, parsed.data, auth, p.code);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'ASSESSMENT_SCHEME', entityId: s.id, newValues: { preset: code, programLevelIds } }, client);
      return { id: s.id, name };
    });
  }

  /** The scheme a class uses (with its scale items), or null. */
  async schemeForLevelTx(tx: Tx, programLevelId: string) {
    const l = await tx.schemeLevel.findFirst({ where: { programLevelId } });
    if (!l) return null;
    return this.schemeTx(tx, l.schemeId);
  }

  async schemeTx(tx: Tx, schemeId: string) {
    const s = await tx.assessmentScheme.findUniqueOrThrow({ where: { id: schemeId }, include: { terms: { orderBy: { sortOrder: 'asc' } }, components: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } }, coAreas: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } } } });
    const items = await tx.gradeScaleItem.findMany({ where: { gradeScaleId: s.gradeScaleId }, orderBy: { minPercent: 'desc' } });
    const coItems = s.coScaleId ? await tx.gradeScaleItem.findMany({ where: { gradeScaleId: s.coScaleId }, orderBy: { minPercent: 'desc' } }) : [];
    const n = (i: (typeof items)[number]) => ({ ...i, minPercent: Number(i.minPercent), gradePoint: num(i.gradePoint) });
    return { ...s, items: items.map(n), coItems: coItems.map(n) };
  }
}
