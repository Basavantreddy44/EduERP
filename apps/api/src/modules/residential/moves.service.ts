import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS, StaffMoveInput, StudentMoveInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { day } from '../students/student-records';
import { ids, unionScope } from './allotments.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const unprocessable = (code: string, message: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, [{ field, message }]);

/**
 * Moves between schools (Phase 21 R2). A student keeps one record: the class place at the old school
 * ends as moved and a new one starts at the new school; marks, attendance, fees and documents stay on
 * the record. Refused while the student holds a hostel bed. A staff member's school (and department)
 * changes. Every move is kept in campus_transfers and audited. The mover needs the right for both schools.
 */
@Injectable()
export class MovesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private both(auth: AuthContext, code: string, from: string, to: string) {
    const s = scopeFor(auth, code as never);
    if (!s || !canAccessCampus(s, from)) return 'from';
    if (!canAccessCampus(s, to)) return 'to';
    return null;
  }

  /** Target sections for a student: same class name, same year, at another school. */
  async studentOptions(studentId: string, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.STU_TRANSFER);
    if (!scope) throw Forbidden('permission-denied', 'You cannot move students between schools');
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, campusId: true, status: true } });
      if (!s || !canAccessCampus(scope, s.campusId)) throw NotFound('Student');
      const e = await tx.studentEnrollment.findFirst({ where: { studentId, status: 'ACTIVE', academicYear: { isCurrent: true } }, select: { academicYearId: true, section: { select: { name: true, level: { select: { name: true } } } } } });
      const bed = await tx.hostelAllotment.findFirst({ where: { studentId, status: { in: ['RESERVED', 'CHECKED_IN'] } }, select: { id: true } });
      if (!e) return { levelName: null, holdsBed: !!bed, schools: [] };
      const sections = await tx.section.findMany({
        where: { academicYearId: e.academicYearId, status: 'ACTIVE', campusId: { not: s.campusId }, level: { name: { equals: e.section.level.name, mode: 'insensitive' } } },
        orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, capacity: true, campusId: true, campus: { select: { name: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      });
      const schools = new Map<string, { campusId: string; campus: string; sections: { id: string; name: string; available: number }[] }>();
      for (const x of sections.filter((x) => canAccessCampus(scope, x.campusId))) {
        if (!schools.has(x.campusId)) schools.set(x.campusId, { campusId: x.campusId, campus: x.campus.name, sections: [] });
        schools.get(x.campusId)!.sections.push({ id: x.id, name: x.name, available: Math.max(0, x.capacity - x._count.enrollments) });
      }
      return { levelName: e.section.level.name, section: e.section.name, holdsBed: !!bed, schools: [...schools.values()] };
    });
  }

  async moveStudent(studentId: string, input: StudentMoveInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM students WHERE id = ${studentId}::uuid FOR UPDATE`;
      const s = rows.length ? await tx.student.findUnique({ where: { id: studentId } }) : null;
      const scope = scopeFor(auth, PERMISSIONS.STU_TRANSFER);
      if (!s || !scope || !canAccessCampus(scope, s.campusId)) throw NotFound('Student');
      if (input.toCampusId === s.campusId) throw unprocessable('same-school', 'The student is already at this school', 'toCampusId');
      if (this.both(auth, PERMISSIONS.STU_TRANSFER, s.campusId, input.toCampusId)) throw unprocessable('school-not-allowed', 'You cannot move students to that school', 'toCampusId');
      if (!['ACTIVE', 'INACTIVE'].includes(s.status)) throw Conflict('student-not-active', 'Only a current student can move to another school');
      const bed = await tx.hostelAllotment.findFirst({ where: { studentId, status: { in: ['RESERVED', 'CHECKED_IN'] } }, select: { id: true } });
      if (bed) throw Conflict('holds-hostel-bed', 'The student still has a hostel bed at this school. Vacate the bed first, then move the student.');
      const er = await tx.$queryRaw<{ id: string }[]>`
        SELECT e.id FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id
         WHERE e.student_id = ${studentId}::uuid AND e.status = 'ACTIVE' AND y.is_current ORDER BY e.enrolled_on DESC LIMIT 1 FOR UPDATE OF e`;
      const active = er.length ? await tx.studentEnrollment.findUnique({ where: { id: er[0].id }, include: { academicYear: { select: { status: true, name: true } }, section: { select: { name: true, level: { select: { name: true } } } } } }) : null;
      if (!active) throw Conflict('not-enrolled', 'The student has no class this year');
      if (active.academicYear.status === 'CLOSED') throw Conflict('academic-year-closed', `${active.academicYear.name} is closed`);
      const sr = await tx.$queryRaw<{ id: string; name: string; capacity: number; status: string; campus_id: string; academic_year_id: string; program_level_id: string }[]>`
        SELECT id, name, capacity, status, campus_id, academic_year_id, program_level_id FROM sections WHERE id = ${input.sectionId}::uuid FOR UPDATE`;
      const sec = sr[0];
      if (!sec) throw NotFound('Section');
      const lvl = await tx.programLevel.findUnique({ where: { id: sec.program_level_id }, select: { name: true } });
      if (sec.campus_id !== input.toCampusId || sec.academic_year_id !== active.academicYearId || lvl?.name.trim().toLowerCase() !== active.section.level.name.trim().toLowerCase()) {
        throw unprocessable('section-other-class', `Choose a section of ${active.section.level.name} at the new school`, 'sectionId');
      }
      if (sec.status !== 'ACTIVE') throw Conflict('section-inactive', `Section ${sec.name} is inactive`);
      if ((await tx.studentEnrollment.count({ where: { sectionId: sec.id, status: 'ACTIVE' } })) >= sec.capacity) throw Conflict('section-full', `Section ${sec.name} is full (${sec.capacity} seats)`);
      const eff = day(input.transferDate);
      if (eff < active.enrolledOn) throw unprocessable('date-before-enrolment', 'The date is before the student joined the current class', 'transferDate');
      await tx.studentEnrollment.update({ where: { id: active.id }, data: { status: 'MOVED', endedOn: eff, remarks: `Moved to another school: ${input.reason}`.slice(0, 300) } });
      const next = await tx.studentEnrollment.create({ data: { tenantId: s.tenantId, studentId, academicYearId: active.academicYearId, sectionId: sec.id, enrolledOn: eff, remarks: input.reason, createdBy: auth.userId } });
      await tx.student.update({ where: { id: studentId }, data: { campusId: input.toCampusId, updatedBy: auth.userId } });
      const move = await tx.campusTransfer.create({ data: { tenantId: s.tenantId, personType: 'STUDENT', studentId, fromCampusId: s.campusId, toCampusId: input.toCampusId, transferDate: eff, orderNo: input.orderNo, reason: input.reason, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT_MOVE', entityId: studentId, oldValues: { campusId: s.campusId, section: active.section.name }, newValues: { campusId: input.toCampusId, section: sec.name, enrollmentId: next.id, orderNo: input.orderNo, transferDate: input.transferDate }, reason: input.reason }, client);
      return { id: move.id, studentId, toCampusId: input.toCampusId, sectionId: sec.id };
    });
  }

  async moveStaff(employeeId: string, input: StaffMoveInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const e = rows.length ? await tx.employee.findUnique({ where: { id: employeeId } }) : null;
      const scope = scopeFor(auth, PERMISSIONS.HR_TRANSFER);
      if (!e || !scope || !canAccessCampus(scope, e.campusId)) throw NotFound('Staff member');
      if (input.toCampusId === e.campusId) throw unprocessable('same-school', 'The staff member already works at this school', 'toCampusId');
      if (this.both(auth, PERMISSIONS.HR_TRANSFER, e.campusId, input.toCampusId)) throw unprocessable('school-not-allowed', 'You cannot move staff to that school', 'toCampusId');
      if (e.status !== 'ACTIVE') throw Conflict('staff-not-active', 'Only a working staff member can move to another school');
      if (!(await tx.campus.findUnique({ where: { id: input.toCampusId }, select: { id: true } }))) throw unprocessable('school-not-found', 'Choose a school', 'toCampusId');
      if (input.departmentId) {
        const d = await tx.department.findUnique({ where: { id: input.departmentId }, select: { campusId: true } });
        if (!d || (d.campusId && d.campusId !== input.toCampusId)) throw unprocessable('department-other-school', 'Choose a department of the new school or of the whole institution', 'departmentId');
      }
      const eff = day(input.transferDate);
      await tx.employee.update({ where: { id: employeeId }, data: { campusId: input.toCampusId, departmentId: input.departmentId ?? null, updatedBy: auth.userId } });
      const move = await tx.campusTransfer.create({ data: { tenantId: e.tenantId, personType: 'STAFF', employeeId, fromCampusId: e.campusId, toCampusId: input.toCampusId, transferDate: eff, orderNo: input.orderNo, reason: input.reason, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'STAFF_MOVE', entityId: employeeId, oldValues: { campusId: e.campusId, departmentId: e.departmentId }, newValues: { campusId: input.toCampusId, departmentId: input.departmentId ?? null, orderNo: input.orderNo, transferDate: input.transferDate }, reason: input.reason }, client);
      return { id: move.id, employeeId, toCampusId: input.toCampusId, hasLogin: !!e.userId };
    });
  }

  /** History of moves: all (head office) or those touching the reader's schools. */
  async list(q: { personType?: 'STUDENT' | 'STAFF'; campusId?: string; from?: string; to?: string }, auth: AuthContext) {
    const scope = unionScope(auth, PERMISSIONS.STU_TRANSFER, PERMISSIONS.HR_TRANSFER, PERMISSIONS.OVERVIEW_READ);
    if (!scope) throw Forbidden('permission-denied', 'You cannot see moves between schools');
    return this.db.run(this.ctx(auth), (tx) => this.rows(tx, {
      ...(q.personType ? { personType: q.personType } : {}),
      ...(q.from || q.to ? { transferDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
      ...(q.campusId ? { OR: [{ fromCampusId: q.campusId }, { toCampusId: q.campusId }] } : {}),
      ...(scope.all ? {} : { AND: [{ OR: [{ fromCampusId: { in: ids(scope) } }, { toCampusId: { in: ids(scope) } }] }] }),
    }));
  }

  /** Moves of one student or staff member (their profile page). */
  async history(kind: 'STUDENT' | 'STAFF', id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const owner = kind === 'STUDENT' ? await tx.student.findUnique({ where: { id }, select: { campusId: true } }) : await tx.employee.findUnique({ where: { id }, select: { campusId: true } });
      const scope = kind === 'STUDENT' ? scopeFor(auth, PERMISSIONS.STU_STUDENT_READ) : scopeFor(auth, PERMISSIONS.HR_STAFF_READ);
      if (!owner || !scope || !canAccessCampus(scope, owner.campusId)) throw NotFound(kind === 'STUDENT' ? 'Student' : 'Staff member');
      return this.rows(tx, kind === 'STUDENT' ? { studentId: id } : { employeeId: id });
    });
  }

  private async rows(tx: Tx, where: object) {
    const rows = await tx.campusTransfer.findMany({ where, orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
    const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, { name: `${s.firstName} ${s.lastName ?? ''}`.trim(), code: s.admissionNo }]));
    const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((s) => [s.id, { name: `${s.firstName} ${s.lastName ?? ''}`.trim(), code: s.employeeCode }]));
    return rows.map((r) => {
      const p = r.studentId ? students.get(r.studentId) : staff.get(r.employeeId!);
      return {
        id: r.id, personType: r.personType, personId: r.studentId ?? r.employeeId, name: p?.name ?? '', code: p?.code ?? '',
        from: campuses.get(r.fromCampusId) ?? '', to: campuses.get(r.toCampusId) ?? '', fromCampusId: r.fromCampusId, toCampusId: r.toCampusId,
        transferDate: iso(r.transferDate), orderNo: r.orderNo, reason: r.reason,
      };
    });
  }
}
