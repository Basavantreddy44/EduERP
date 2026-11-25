import { HttpStatus, Injectable } from '@nestjs/common';
import { AllotmentJoinInput, AllotmentStatusInput, EntranceAllotmentStatus, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo, day, linkGuardians, recordStatus } from '../students/student-records';
import { autoAssign } from '../fees/assignments';

/** Campus ids of a limited scope (empty for an all-campus scope, which is never filtered). */
export const ids = (s: CampusScope) => (s.all ? [] : s.campusIds);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Campuses where the user holds any of the rights (union). */
export function unionScope(auth: AuthContext, ...codes: string[]): CampusScope | null {
  const scopes = codes.map((c) => scopeFor(auth, c as never)).filter((s): s is CampusScope => !!s);
  if (!scopes.length) return null;
  if (scopes.some((s) => s.all)) return { all: true };
  return { all: false, campusIds: [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))] };
}

/**
 * Allotment list (Phase 21 R1). Head office imports the list; each school marks its allotted
 * children as joined (one step creates the student, parents, class place and status entry) or
 * not reported; head office can cancel. A joined allotment never changes again.
 */
@Injectable()
export class AllotmentsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private reader(auth: AuthContext) {
    const s = unionScope(auth, PERMISSIONS.ALLOT_JOIN, PERMISSIONS.ALLOT_MANAGE);
    if (!s) throw Forbidden('permission-denied', 'You cannot see the allotment list');
    return s;
  }

  private async currentYear(tx: Tx, id?: string) {
    const y = id ? await tx.academicYear.findUnique({ where: { id }, select: { id: true, name: true } }) : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    if (id && !y) throw NotFound('Academic year');
    return y;
  }

  async list(q: { campusId?: string; academicYearId?: string; status?: EntranceAllotmentStatus; q?: string }, auth: AuthContext) {
    const scope = this.reader(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await this.currentYear(tx, q.academicYearId);
      if (!year) return { year: null, summary: [], rows: [] };
      if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
      const campusFilter = q.campusId ? { campusId: q.campusId } : scope.all ? {} : { campusId: { in: ids(scope) } };
      const term = q.q?.trim();
      const rows = await tx.studentAllotment.findMany({
        where: {
          academicYearId: year.id, ...campusFilter, ...(q.status ? { status: q.status } : {}),
          ...(term ? { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { entranceRegNo: { contains: term.toUpperCase() } }, { parentPhone: { contains: term } }] } : {}),
        },
        orderBy: [{ status: 'asc' }, { rank: { sort: 'asc', nulls: 'last' } }, { firstName: 'asc' }],
        take: 500,
      });
      const counts = await tx.studentAllotment.groupBy({ by: ['campusId', 'status'], where: { academicYearId: year.id, ...(scope.all ? {} : { campusId: { in: ids(scope) } }) }, _count: { _all: true } });
      const campuses = await tx.campus.findMany({ where: scope.all ? {} : { id: { in: ids(scope) } }, select: { id: true, name: true, district: true }, orderBy: { name: 'asc' } });
      const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, admissionNo: true } })).map((s) => [s.id, s.admissionNo]));
      const summary = campuses
        .map((c) => {
          const n = (st: string) => counts.find((x) => x.campusId === c.id && x.status === st)?._count._all ?? 0;
          return { campusId: c.id, campus: c.name, district: c.district, allotted: n('ALLOTTED') + n('JOINED') + n('NOT_REPORTED') + n('CANCELLED'), joined: n('JOINED'), waiting: n('ALLOTTED'), notReported: n('NOT_REPORTED'), cancelled: n('CANCELLED') };
        })
        .filter((c) => c.allotted > 0);
      return {
        year,
        summary,
        rows: rows.map((r) => ({
          id: r.id, campusId: r.campusId, levelName: r.levelName, entranceRegNo: r.entranceRegNo, name: `${r.firstName} ${r.lastName ?? ''}`.trim(), gender: r.gender, dob: iso(r.dob),
          category: r.category, quota: r.quota, rank: r.rank, fatherName: r.fatherName, motherName: r.motherName, parentPhone: r.parentPhone, address: r.address,
          status: r.status, statusDate: iso(r.statusDate), statusReason: r.statusReason, studentId: r.studentId, admissionNo: r.studentId ? students.get(r.studentId) ?? null : null,
        })),
      };
    });
  }

  /** Sections the child can join: their school, this year, the allotted class. */
  async sections(id: string, auth: AuthContext) {
    const scope = unionScope(auth, PERMISSIONS.ALLOT_JOIN);
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.studentAllotment.findUnique({ where: { id } });
      if (!a || !scope || !canAccessCampus(scope, a.campusId)) throw NotFound('Allotment');
      const rows = await tx.section.findMany({
        where: { campusId: a.campusId, academicYearId: a.academicYearId, status: 'ACTIVE', level: { name: { equals: a.levelName, mode: 'insensitive' } } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, capacity: true, level: { select: { name: true, program: { select: { name: true } } } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      });
      return rows.map(({ _count, ...s }) => ({ ...s, filled: _count.enrollments, available: Math.max(0, s.capacity - _count.enrollments) }));
    });
  }

  private async lock(tx: Tx, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM student_allotments WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length ? tx.studentAllotment.findUnique({ where: { id } }) : null;
  }

  async join(id: string, input: AllotmentJoinInput, auth: AuthContext, client: ClientInfo) {
    const scope = unionScope(auth, PERMISSIONS.ALLOT_JOIN);
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.lock(tx, id);
      if (!a || !scope || !canAccessCampus(scope, a.campusId)) throw NotFound('Allotment');
      if (a.status !== 'ALLOTTED') throw Conflict('allotment-not-open', a.status === 'JOINED' ? 'This child has already joined' : 'Only an allotment waiting to join can be marked as joined. Put it back to allotted first.');
      const secRows = await tx.$queryRaw<{ id: string; name: string; capacity: number; status: string; campus_id: string; academic_year_id: string; program_level_id: string }[]>`
        SELECT id, name, capacity, status, campus_id, academic_year_id, program_level_id FROM sections WHERE id = ${input.sectionId}::uuid FOR UPDATE`;
      const sec = secRows[0];
      if (!sec) throw NotFound('Section');
      const level = await tx.programLevel.findUnique({ where: { id: sec.program_level_id }, select: { name: true } });
      if (sec.campus_id !== a.campusId || sec.academic_year_id !== a.academicYearId || level?.name.trim().toLowerCase() !== a.levelName.trim().toLowerCase()) {
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'section-not-allotted-class', `Choose a section of ${a.levelName} at the allotted school`, [{ field: 'sectionId', message: `A section of ${a.levelName}` }]);
      }
      if (sec.status !== 'ACTIVE') throw Conflict('section-inactive', `Section ${sec.name} is inactive`);
      const filled = await tx.studentEnrollment.count({ where: { sectionId: sec.id, status: 'ACTIVE' } });
      if (filled >= sec.capacity) throw Conflict('section-full', `Section ${sec.name} is full (${sec.capacity} seats). Choose another section or increase its seats.`);
      const year = await tx.academicYear.findUniqueOrThrow({ where: { id: a.academicYearId }, select: { name: true } });
      const tenantId = auth.tenantId!;
      if (input.admissionNo && (await tx.student.findFirst({ where: { admissionNo: input.admissionNo }, select: { id: true } }))) {
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'admission-no-taken', `Admission no. ${input.admissionNo} is already used`, [{ field: 'admissionNo', message: 'Already used' }]);
      }
      const admissionNo = input.admissionNo ?? (await allocateNo(this.numbering, tx, 'ADMISSION', a.campusId, year.name, auth.userId));
      const joinedOn = day(input.joinedOn);
      const student = await tx.student.create({
        data: { tenantId, campusId: a.campusId, admissionNo, firstName: a.firstName, lastName: a.lastName, dob: a.dob, gender: a.gender, category: a.category, address: a.address, admissionDate: joinedOn, createdBy: auth.userId },
      });
      const guardians = await linkGuardians(tx, student.id, { tenantId, fatherName: a.fatherName, motherName: a.motherName, guardianName: null, parentPhone: a.parentPhone, parentEmail: null }, auth.userId);
      await tx.studentEnrollment.create({ data: { tenantId, studentId: student.id, academicYearId: a.academicYearId, sectionId: sec.id, rollNo: input.rollNo ?? null, enrolledOn: joinedOn, createdBy: auth.userId } });
      await recordStatus(tx, { tenantId, studentId: student.id, oldStatus: null, newStatus: 'ACTIVE', effectiveDate: joinedOn, reason: `Joined from allotment ${a.entranceRegNo}`, userId: auth.userId });
      await autoAssign(tx, { tenantId, studentId: student.id, academicYearId: a.academicYearId, programLevelId: sec.program_level_id, userId: auth.userId });
      await this.outbox.add(tx, {
        tenantId, eventType: EVENTS.STUDENT_ENROLLED, aggregateType: 'STUDENT', aggregateId: student.id,
        payload: { studentId: student.id, admissionNo, campusId: a.campusId, academicYearId: a.academicYearId, sectionId: sec.id, source: 'ALLOTMENT' },
        dedupeKey: `allotment:${a.id}`,
      });
      await tx.studentAllotment.update({ where: { id }, data: { status: 'JOINED', studentId: student.id, statusDate: joinedOn, statusReason: null, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'STUDENT', entityId: student.id, newValues: { admissionNo, section: sec.name, guardians, allotment: a.entranceRegNo }, reason: 'Joined from allotment' }, client);
      return { id, status: 'JOINED', studentId: student.id, admissionNo };
    });
  }

  async setStatus(id: string, input: AllotmentStatusInput, auth: AuthContext, client: ClientInfo) {
    // Not reported / back to allotted: the school; cancelled: head office.
    const scope = unionScope(auth, ...(input.status === 'CANCELLED' ? [PERMISSIONS.ALLOT_MANAGE] : [PERMISSIONS.ALLOT_JOIN, PERMISSIONS.ALLOT_MANAGE]));
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.lock(tx, id);
      if (!a || !scope || !canAccessCampus(scope, a.campusId)) {
        if (a && input.status === 'CANCELLED' && unionScope(auth, PERMISSIONS.ALLOT_JOIN)) throw Forbidden('permission-denied', 'Only head office can cancel an allotment');
        throw NotFound('Allotment');
      }
      if (a.status === 'JOINED') throw Conflict('allotment-joined', 'This child has joined; the allotment cannot change. Use the student record instead.');
      if (a.status === input.status) throw Conflict('same-status', 'The allotment already has this status');
      if (a.status === 'CANCELLED' && !unionScope(auth, PERMISSIONS.ALLOT_MANAGE)) throw Forbidden('permission-denied', 'Only head office can reopen a cancelled allotment');
      const back = input.status === 'ALLOTTED';
      await tx.studentAllotment.update({ where: { id }, data: { status: input.status, statusDate: back ? null : day(input.date), statusReason: input.reason, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'STATUS_CHANGE', entityType: 'STUDENT_ALLOTMENT', entityId: id, oldValues: { status: a.status }, newValues: { status: input.status, date: input.date }, reason: input.reason }, client);
      return { id, status: input.status };
    });
  }
}
