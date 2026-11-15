import { HttpStatus, Injectable } from '@nestjs/common';
import { IssueTcInput, PERMISSIONS, PromotionInput, formatINR, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo, day, recordStatus, todayIST } from './student-records';
import { autoAssign } from '../fees/assignments';
import { noDuesOf } from '../fees/dues.service';

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Outcome = 'PROMOTE' | 'DETAIN' | 'PASS_OUT';

interface PlanStudent { id: string; enrollmentId: string; firstName: string; lastName: string | null; admissionNo: string; sectionId: string; sectionName: string; status: string; hasDues: boolean; alreadyPlaced: boolean; outcome: Outcome }
/** filled = already in the target section; after = filled + everyone arriving there (from any class or section). */
interface PlanSection { fromSectionId: string; fromName: string; toSectionId: string | null; toName: string | null; capacity: number | null; filled: number; incoming: number; after: number; over: boolean; missing: boolean }
interface PlanClass {
  levelId: string; levelName: string; programName: string; campusId: string; nextLevelId: string | null; nextLevelName: string | null; final: boolean;
  students: PlanStudent[]; sections: PlanSection[]; detainSections: PlanSection[];
  targetSections: { id: string; name: string; capacity: number }[]; sameLevelSections: { id: string; name: string; capacity: number }[];
}

/**
 * Student lifecycle (M1.4): year-end promotion (preview → commit; next class, same section name unless
 * mapped; final class passes out; chosen students detained; already-placed students skipped; seats
 * checked) and the Transfer Certificate (only with no dues; the student is marked transferred, their
 * class place closed, future fees stopped).
 */
@Injectable()
export class StudentLifecycleService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbering: NumberingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Promotion ─────────────

  private async years(tx: Tx, fromYearId: string, toYearId: string) {
    const [from, to] = await Promise.all([tx.academicYear.findUnique({ where: { id: fromYearId } }), tx.academicYear.findUnique({ where: { id: toYearId } })]);
    if (!from || !to) throw NotFound('Academic year');
    if (to.startDate <= from.startDate) throw Conflict('year-order', `${to.name} must come after ${from.name}`);
    if (to.status === 'CLOSED') throw Conflict('academic-year-closed', `${to.name} is closed`);
    return { from, to };
  }

  /** Works out who goes where (nothing is written). */
  private async plan(tx: Tx, input: PromotionInput, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.STU_PROMOTE)!;
    const { from, to } = await this.years(tx, input.fromYearId, input.toYearId);
    const detain = new Set(input.detainIds);
    const classes: PlanClass[] = [];
    for (const levelId of [...new Set(input.programLevelIds)]) {
      const level = await tx.programLevel.findUnique({ where: { id: levelId }, include: { program: { include: { levels: { orderBy: { sequence: 'asc' } } } } } });
      if (!level || !canAccessCampus(scope, level.program.campusId)) throw NotFound('Class');
      const next = level.isFinal ? null : level.program.levels.find((l) => l.sequence > level.sequence) ?? null;
      const enrolments = await tx.studentEnrollment.findMany({
        where: { academicYearId: from.id, status: 'ACTIVE', section: { programLevelId: levelId }, student: { status: { in: ['ACTIVE', 'INACTIVE'] } } },
        include: { section: { select: { id: true, name: true } }, student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true } } },
        orderBy: [{ section: { name: 'asc' } }, { student: { firstName: 'asc' } }],
      });
      const ids = enrolments.map((e) => e.studentId);
      const placed = new Set((await tx.studentEnrollment.findMany({ where: { academicYearId: to.id, status: 'ACTIVE', studentId: { in: ids } }, select: { studentId: true } })).map((e) => e.studentId));
      const dues = new Set((await tx.feeInvoice.groupBy({ by: ['studentId'], where: { studentId: { in: ids }, status: { in: ['UNPAID', 'PARTIAL'] } }, _sum: { balanceAmount: true } })).filter((g) => toPaise((g._sum.balanceAmount ?? 0).toString()) > 0).map((g) => g.studentId));
      const sectionsOf = async (lvl: string) => {
        const secs = await tx.section.findMany({ where: { academicYearId: to.id, programLevelId: lvl, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, capacity: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } });
        return secs.map(({ _count, ...s }) => ({ ...s, filled: _count.enrollments }));
      };
      const targetSecs = next ? await sectionsOf(next.id) : [];
      const sameSecs = await sectionsOf(levelId);
      const students: PlanStudent[] = enrolments.map((e) => ({
        id: e.studentId, enrollmentId: e.id, firstName: e.student.firstName, lastName: e.student.lastName, admissionNo: e.student.admissionNo, sectionId: e.sectionId, sectionName: e.section.name,
        status: e.student.status, hasDues: dues.has(e.studentId), alreadyPlaced: placed.has(e.studentId), outcome: detain.has(e.studentId) ? 'DETAIN' : next ? 'PROMOTE' : 'PASS_OUT',
      }));
      const mapFor = (fromSectionId: string, fromName: string, pool: typeof targetSecs) => {
        const forced = input.sectionMap[fromSectionId];
        // A mapping can point at a section of the next class (movers) or of the same class (detainees); otherwise the same name.
        return (forced ? pool.find((s) => s.id === forced) : undefined) ?? pool.find((s) => s.name.toLowerCase() === fromName.toLowerCase()) ?? null;
      };
      const build = (outcome: Outcome, pool: typeof targetSecs): PlanSection[] => {
        const fromSecs = [...new Map(enrolments.map((e) => [e.sectionId, e.section.name])).entries()];
        return fromSecs
          .map(([fid, fname]) => {
            const movers = students.filter((s) => s.sectionId === fid && s.outcome === outcome && !s.alreadyPlaced).length;
            const tgt = mapFor(fid, fname, pool);
            return { fromSectionId: fid, fromName: fname, toSectionId: tgt?.id ?? null, toName: tgt?.name ?? null, capacity: tgt?.capacity ?? null, filled: tgt?.filled ?? 0, incoming: movers, after: 0, over: false, missing: !tgt && movers > 0 };
          })
          .filter((s) => s.incoming > 0);
      };
      classes.push({
        levelId, levelName: level.name, programName: level.program.name, campusId: level.program.campusId, nextLevelId: next?.id ?? null, nextLevelName: next?.name ?? null, final: !next,
        students, sections: next ? build('PROMOTE', targetSecs) : [], detainSections: build('DETAIN', sameSecs),
        targetSections: targetSecs.map(({ id, name, capacity }) => ({ id, name, capacity })), sameLevelSections: sameSecs.map(({ id, name, capacity }) => ({ id, name, capacity })),
      });
    }
    // Seats: everyone arriving in a target section (from any class or as a detainee) counts.
    const arriving = new Map<string, number>();
    for (const c of classes) for (const s of [...c.sections, ...c.detainSections]) if (s.toSectionId) arriving.set(s.toSectionId, (arriving.get(s.toSectionId) ?? 0) + s.incoming);
    const issues: string[] = [];
    for (const c of classes) {
      for (const s of [...c.sections, ...c.detainSections]) {
        if (s.missing) issues.push(`${c.levelName} ${s.fromName}: no section "${s.fromName}" in ${c.sections.includes(s) ? c.nextLevelName : c.levelName} for ${to.name} — create it or choose another`);
        else if (s.toSectionId) {
          s.after = s.filled + (arriving.get(s.toSectionId) ?? 0);
          if (s.after > (s.capacity ?? 0)) {
            s.over = true;
            issues.push(`${s.toName} would have ${s.after} students for ${s.capacity} seats`);
          }
        }
      }
    }
    const count = (o: Outcome) => classes.reduce((a, c) => a + c.students.filter((s) => s.outcome === o && !s.alreadyPlaced).length, 0);
    return {
      from: { id: from.id, name: from.name, endDate: from.endDate }, to: { id: to.id, name: to.name, startDate: to.startDate },
      classes, issues: [...new Set(issues)],
      totals: { promote: count('PROMOTE'), detain: count('DETAIN'), passOut: count('PASS_OUT'), skipped: classes.reduce((a, c) => a + c.students.filter((s) => s.alreadyPlaced).length, 0), withDues: classes.reduce((a, c) => a + c.students.filter((s) => s.hasDues).length, 0) },
    };
  }

  preview(input: PromotionInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.plan(tx, input, auth));
  }

  /** Classes that can be promoted from a year (with active students), for the wizard. */
  options(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.STU_PROMOTE)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const years = await tx.academicYear.findMany({ orderBy: { startDate: 'asc' }, select: { id: true, name: true, isCurrent: true, status: true, startDate: true } });
      const programs = await tx.program.findMany({
        where: { status: 'ACTIVE', ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
        orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, campusId: true, levels: { orderBy: { sequence: 'asc' }, select: { id: true, name: true, isFinal: true } } },
      });
      return { years, programs };
    });
  }

  /** Past promotions (newest first). */
  runs(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const runs = await tx.promotionRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
      const years = new Map((await tx.academicYear.findMany({ select: { id: true, name: true } })).map((y) => [y.id, y.name]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: runs.map((r) => r.createdBy).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return runs.map((r) => ({ id: r.id, from: years.get(r.fromYearId) ?? '', to: years.get(r.toYearId) ?? '', promoted: r.promoted, detained: r.detained, passedOut: r.passedOut, classes: r.levelIds.length, createdAt: r.createdAt, byName: r.createdBy ? users.get(r.createdBy) ?? null : null }));
    });
  }

  async commit(input: PromotionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`promotion:${auth.tenantId}:${input.fromYearId}`}))`;
      const p = await this.plan(tx, input, auth);
      if (p.issues.length) throw new AppError(HttpStatus.CONFLICT, 'promotion-blocked', 'Some classes cannot be promoted yet — see the problems listed', p.issues.map((m) => ({ field: 'sections', message: m })));
      const today = iso(todayIST());
      const endIso = iso(p.from.endDate) < today ? iso(p.from.endDate) : today;
      const counts = { promoted: 0, detained: 0, passedOut: 0, skipped: p.totals.skipped };
      for (const c of p.classes) {
        for (const s of c.students) {
          if (s.alreadyPlaced) continue;
          const enr = await tx.studentEnrollment.findUniqueOrThrow({ where: { id: s.enrollmentId } });
          const ended = day(endIso) < enr.enrolledOn ? enr.enrolledOn : day(endIso);
          if (s.outcome === 'PASS_OUT') {
            await tx.studentEnrollment.update({ where: { id: enr.id }, data: { status: 'COMPLETED', endedOn: ended, remarks: `Passed out (${p.from.name})` } });
            const st = await tx.student.update({ where: { id: s.id }, data: { status: 'PASSED_OUT', updatedBy: auth.userId } });
            await recordStatus(tx, { tenantId: st.tenantId, studentId: s.id, oldStatus: s.status, newStatus: 'PASSED_OUT', effectiveDate: ended, reason: `Completed ${c.levelName} (${p.from.name})`, userId: auth.userId });
            await this.outbox.add(tx, { tenantId: st.tenantId, eventType: EVENTS.STUDENT_STATUS_CHANGED, aggregateType: 'STUDENT', aggregateId: s.id, payload: { studentId: s.id, from: s.status, to: 'PASSED_OUT', effectiveDate: iso(ended) }, dedupeKey: `passout:${enr.id}` });
            counts.passedOut += 1;
            continue;
          }
          const sections = s.outcome === 'DETAIN' ? c.detainSections : c.sections;
          const target = sections.find((x) => x.fromSectionId === s.sectionId)!;
          const levelTo = s.outcome === 'DETAIN' ? c.levelId : c.nextLevelId!;
          await tx.studentEnrollment.update({ where: { id: enr.id }, data: { status: s.outcome === 'DETAIN' ? 'DETAINED' : 'PROMOTED', endedOn: ended, remarks: s.outcome === 'DETAIN' ? `Detained in ${c.levelName}` : `Promoted to ${c.nextLevelName}` } });
          await tx.studentEnrollment.create({ data: { tenantId: enr.tenantId, studentId: s.id, academicYearId: p.to.id, sectionId: target.toSectionId!, enrolledOn: p.to.startDate, remarks: s.outcome === 'DETAIN' ? `Detained from ${p.from.name}` : `Promoted from ${c.levelName}`, createdBy: auth.userId } });
          await autoAssign(tx, { tenantId: enr.tenantId, studentId: s.id, academicYearId: p.to.id, programLevelId: levelTo, userId: auth.userId });
          if (s.outcome === 'DETAIN') counts.detained += 1;
          else counts.promoted += 1;
        }
      }
      if (!counts.promoted && !counts.detained && !counts.passedOut) return { ...counts, runId: null, from: p.from.name, to: p.to.name }; // nothing to do: no log entry
      const run = await tx.promotionRun.create({ data: { tenantId: auth.tenantId!, fromYearId: p.from.id, toYearId: p.to.id, ...counts, levelIds: p.classes.map((c) => c.levelId), createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'PROMOTION', entityId: run.id, newValues: { from: p.from.name, to: p.to.name, ...counts, classes: p.classes.map((c) => c.levelName) } }, client);
      return { ...counts, runId: run.id, from: p.from.name, to: p.to.name };
    }, { timeout: 180_000 });
  }

  // ───────────── Transfer Certificate ─────────────

  async issueTc(studentId: string, input: IssueTcInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM students WHERE id = ${studentId}::uuid FOR UPDATE`;
      const s = rows.length ? await tx.student.findUnique({ where: { id: studentId } }) : null;
      if (!s || !canAccessCampus(scopeFor(auth, PERMISSIONS.STU_TC_ISSUE)!, s.campusId)) throw NotFound('Student');
      if (s.status === 'TRANSFERRED') throw Conflict('tc-issued', 'A Transfer Certificate has already been issued');
      const leaving = day(input.leavingDate);
      if (leaving < s.admissionDate) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'date-before-admission', 'The leaving date is before the admission date', [{ field: 'leavingDate', message: 'Before the admission date' }]);
      const nd = await noDuesOf(tx, studentId);
      if (!nd.clear) {
        throw new AppError(HttpStatus.CONFLICT, 'dues-pending', nd.pendingRefunds ? 'A refund is still waiting for approval' : `${formatINR(toPaise(nd.balance))} is still due. Fees must be cleared before a Transfer Certificate.`, nd.openBills.map((b) => ({ field: 'dues', message: `${b.description} (${b.invoiceNo})` })));
      }
      // Last class actually attended: a place in a year that has not started by the leaving date does not count.
      const enrols = await tx.studentEnrollment.findMany({
        where: { studentId, status: { in: ['ACTIVE', 'COMPLETED', 'PROMOTED', 'DETAINED', 'LEFT'] } },
        orderBy: [{ academicYear: { startDate: 'desc' } }, { enrolledOn: 'desc' }],
        include: { academicYear: { select: { name: true, startDate: true } }, section: { select: { name: true, level: { select: { name: true, program: { select: { name: true } } } } } } },
      });
      const last = enrols.find((e) => e.enrolledOn <= leaving) ?? enrols.at(-1) ?? null;
      const year = (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true } })) ?? { name: last?.academicYear.name ?? String(new Date().getFullYear()) };
      const tcNo = await allocateNo(this.numbering, tx, 'TC', s.campusId, year.name, auth.userId);
      const tc = await tx.transferCertificate.create({
        data: {
          tenantId: s.tenantId, campusId: s.campusId, studentId, tcNo, issueDate: todayIST(), leavingDate: leaving,
          lastClass: last ? `${last.section.level.name} – ${last.section.name} (${last.section.level.program.name})` : null, lastYear: last?.academicYear.name ?? null,
          reason: input.reason, conduct: input.conduct, remarks: input.remarks ?? null, duesCleared: true, createdBy: auth.userId,
        },
      });
      // Close the class place, stop future fees and payment links.
      const active = await tx.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE' } });
      for (const e of active) {
        // A place in a later year (after promotion) that the student never started is cancelled, not transferred.
        const future = e.enrolledOn > leaving;
        await tx.studentEnrollment.update({ where: { id: e.id }, data: future ? { status: 'CANCELLED', remarks: `Left before this year started (TC ${tcNo})` } : { status: 'TRANSFERRED', endedOn: leaving, remarks: `TC ${tcNo}` } });
      }
      await tx.studentFeeAssignment.updateMany({ where: { studentId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await tx.paymentLink.updateMany({ where: { studentId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      if (s.status !== 'PASSED_OUT') {
        await tx.student.update({ where: { id: studentId }, data: { status: 'TRANSFERRED', updatedBy: auth.userId } });
        await recordStatus(tx, { tenantId: s.tenantId, studentId, oldStatus: s.status, newStatus: 'TRANSFERRED', effectiveDate: leaving, reason: `Transfer Certificate ${tcNo}: ${input.reason}`, userId: auth.userId });
        await this.outbox.add(tx, { tenantId: s.tenantId, eventType: EVENTS.STUDENT_STATUS_CHANGED, aggregateType: 'STUDENT', aggregateId: studentId, payload: { studentId, from: s.status, to: 'TRANSFERRED', effectiveDate: input.leavingDate }, dedupeKey: `tc:${tc.id}` });
      }
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'TRANSFER_CERTIFICATE', entityId: tc.id, newValues: { ...tc, closedEnrolments: active.length } }, client);
      return tc;
    });
  }

  async tc(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const tc = await tx.transferCertificate.findUnique({
        where: { id },
        include: {
          student: {
            select: {
              id: true, firstName: true, lastName: true, nameLocal: true, admissionNo: true, dob: true, gender: true, category: true, religion: true, motherTongue: true, admissionDate: true, apaarId: true,
              campus: { select: { name: true, address: true, city: true, phone: true } },
              guardians: { select: { relation: true, guardian: { select: { name: true } } } },
            },
          },
        },
      });
      if (!tc || !canAccessCampus(scopeFor(auth, PERMISSIONS.STU_STUDENT_READ)!, tc.campusId)) throw NotFound('Transfer Certificate');
      const tenant = await tx.tenant.findUnique({ where: { id: tc.tenantId }, select: { name: true, nameLocal: true } });
      const issuer = tc.createdBy ? await tx.user.findUnique({ where: { id: tc.createdBy }, select: { fullName: true } }) : null;
      return { ...tc, institution: tenant?.name ?? '', institutionLocal: tenant?.nameLocal ?? null, issuedBy: issuer?.fullName ?? null };
    });
  }

  tcsOf(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(scopeFor(auth, PERMISSIONS.STU_STUDENT_READ)!, s.campusId)) throw NotFound('Student');
      return tx.transferCertificate.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, select: { id: true, tcNo: true, issueDate: true, status: true } });
    });
  }
}
