import { HttpStatus, Injectable } from '@nestjs/common';
import { ElectivesInput, PERMISSIONS, PermissionCode, SectionTeachersInput, SubjectInput, SyllabusInput, UpdateSubjectInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const SETUP = PERMISSIONS.ACAD_SETUP;
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Subjects & teachers (M8.1): the institution's subjects, each class's syllabus (core, electives,
 * languages), the class teacher and subject teachers of each section, and students' electives.
 */
@Injectable()
export class AcademicSubjectsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  scope(auth: AuthContext, code: PermissionCode = PERMISSIONS.ACAD_READ): CampusScope {
    return scopeFor(auth, code) ?? scopeFor(auth, SETUP) ?? scopeFor(auth, PERMISSIONS.ACAD_TEACH) ?? { all: false, campusIds: [] };
  }

  /** The section, checked against the user's campus scope. */
  async section(tx: Tx, sectionId: string, auth: AuthContext, code: PermissionCode = PERMISSIONS.ACAD_READ) {
    const s = await tx.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, campusId: true, academicYearId: true, programLevelId: true, classTeacherId: true, level: { select: { name: true, program: { select: { name: true } } } } } });
    if (!s || !canAccessCampus(this.scope(auth, code), s.campusId)) throw NotFound('Section');
    return s;
  }

  // ───────────── Subjects ─────────────

  subjects(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.subject.findMany({ orderBy: [{ status: 'asc' }, { code: 'asc' }], include: { _count: { select: { levels: true } } } });
      return rows.map(({ _count, ...s }) => ({ ...s, credits: num(s.credits), classes: _count.levels }));
    });
  }

  createSubject(input: SubjectInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.subject.findUnique({ where: { tenantId_code: { tenantId: auth.tenantId!, code: input.code } }, select: { id: true } })) throw Conflict('subject-code-taken', `Subject code ${input.code} is already used`);
      const s = await tx.subject.create({ data: { ...input, nameLocal: input.nameLocal ?? null, credits: input.credits ?? null, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'SUBJECT', entityId: s.id, newValues: input }, client);
      return { ...s, credits: num(s.credits) };
    });
  }

  updateSubject(id: string, input: UpdateSubjectInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.subject.findUnique({ where: { id } });
      if (!s) throw NotFound('Subject');
      if (input.code && input.code !== s.code && (await tx.subject.findUnique({ where: { tenantId_code: { tenantId: auth.tenantId!, code: input.code } }, select: { id: true } }))) throw Conflict('subject-code-taken', `Subject code ${input.code} is already used`);
      const after = await tx.subject.update({ where: { id }, data: input });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'SUBJECT', entityId: id, oldValues: s, newValues: input }, client);
      return { ...after, credits: num(after.credits) };
    });
  }

  // ───────────── Syllabus per class ─────────────

  syllabus(programLevelId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id: programLevelId }, select: { id: true, name: true, program: { select: { name: true, campusId: true } } } });
      if (!level || !canAccessCampus(this.scope(auth), level.program.campusId)) throw NotFound('Class');
      const rows = await tx.levelSubject.findMany({ where: { programLevelId }, orderBy: [{ sortOrder: 'asc' }], include: { subject: { select: { id: true, code: true, name: true, nameLocal: true, subjectType: true, isLanguage: true, status: true } } } });
      return { level: { id: level.id, name: level.name, program: level.program.name }, subjects: rows.map((r) => ({ subjectId: r.subjectId, subjectGroup: r.subjectGroup, isOptional: r.isOptional, subject: r.subject })) };
    });
  }

  saveSyllabus(input: SyllabusInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id: input.programLevelId }, select: { id: true, program: { select: { campusId: true } } } });
      if (!level || !canAccessCampus(this.scope(auth, SETUP), level.program.campusId)) throw NotFound('Class');
      const subjects = await tx.subject.findMany({ where: { id: { in: input.subjects.map((s) => s.subjectId) } }, select: { id: true, status: true } });
      if (subjects.length !== input.subjects.length || subjects.some((s) => s.status !== 'ACTIVE')) throw unprocessable('subject-invalid', 'Choose active subjects', 'subjects');
      const before = await tx.levelSubject.findMany({ where: { programLevelId: input.programLevelId } });
      const removed = before.filter((b) => !input.subjects.some((s) => s.subjectId === b.subjectId));
      if (removed.length) {
        // A subject still taught or chosen in this class cannot leave the syllabus.
        const taught = await tx.sectionSubjectTeacher.count({ where: { subjectId: { in: removed.map((r) => r.subjectId) }, sectionId: { in: (await tx.section.findMany({ where: { programLevelId: input.programLevelId }, select: { id: true } })).map((x) => x.id) } } });
        if (taught) throw Conflict('subject-in-use', 'A removed subject still has teachers in this class — remove them first');
        for (const r of removed) await tx.$executeRaw`DELETE FROM level_subjects WHERE id = ${r.id}::uuid`;
      }
      for (const [i, s] of input.subjects.entries()) {
        const ex = before.find((b) => b.subjectId === s.subjectId);
        if (ex) await tx.levelSubject.update({ where: { id: ex.id }, data: { subjectGroup: s.subjectGroup, isOptional: s.isOptional, sortOrder: i } });
        else await tx.levelSubject.create({ data: { tenantId: auth.tenantId!, programLevelId: input.programLevelId, subjectId: s.subjectId, subjectGroup: s.subjectGroup, isOptional: s.isOptional, sortOrder: i } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: level.program.campusId, action: 'UPDATE', entityType: 'SYLLABUS', entityId: input.programLevelId, oldValues: before.map((b) => b.subjectId), newValues: input.subjects }, client);
      return { saved: input.subjects.length };
    });
  }

  // ───────────── Teachers of a section ─────────────

  /** The section's class teacher, and its subjects (from the class syllabus) with their teachers. */
  teachers(sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.section(tx, sectionId, auth);
      const syllabus = await tx.levelSubject.findMany({ where: { programLevelId: s.programLevelId }, orderBy: { sortOrder: 'asc' }, include: { subject: { select: { id: true, code: true, name: true } } } });
      const assigned = await tx.sectionSubjectTeacher.findMany({ where: { sectionId } });
      const staffIds = [...new Set([...assigned.map((a) => a.employeeId), ...(s.classTeacherId ? [s.classTeacherId] : [])])];
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, { id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), code: e.employeeCode }]));
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}`, campusId: s.campusId },
        classTeacher: s.classTeacherId ? staff.get(s.classTeacherId) ?? null : null,
        subjects: syllabus.map((l) => ({ subjectId: l.subjectId, subject: l.subject, subjectGroup: l.subjectGroup, isOptional: l.isOptional, teachers: assigned.filter((a) => a.subjectId === l.subjectId).map((a) => staff.get(a.employeeId)!).filter(Boolean) })),
      };
    });
  }

  saveTeachers(sectionId: string, input: SectionTeachersInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.section(tx, sectionId, auth, SETUP);
      const staffIds = [...new Set([...input.subjects.flatMap((x) => x.employeeIds), ...(input.classTeacherId ? [input.classTeacherId] : [])])];
      const staff = await tx.employee.findMany({ where: { id: { in: staffIds } }, select: { id: true, campusId: true, status: true } });
      if (staff.length !== staffIds.length || staff.some((e) => e.campusId !== s.campusId || !['ACTIVE', 'ON_LEAVE'].includes(e.status))) throw unprocessable('teacher-invalid', 'Choose current staff of this campus', 'subjects');
      const syllabus = new Set((await tx.levelSubject.findMany({ where: { programLevelId: s.programLevelId }, select: { subjectId: true } })).map((x) => x.subjectId));
      for (const x of input.subjects) if (!syllabus.has(x.subjectId)) throw unprocessable('not-in-syllabus', 'A subject is not in this class’s syllabus', 'subjects');
      const before = await tx.sectionSubjectTeacher.findMany({ where: { sectionId } });
      const want = input.subjects.flatMap((x) => x.employeeIds.map((e) => `${x.subjectId}:${e}`));
      for (const b of before) if (!want.includes(`${b.subjectId}:${b.employeeId}`)) await tx.$executeRaw`DELETE FROM section_subject_teachers WHERE id = ${b.id}::uuid`;
      for (const x of input.subjects) for (const e of x.employeeIds) {
        if (!before.some((b) => b.subjectId === x.subjectId && b.employeeId === e)) await tx.sectionSubjectTeacher.create({ data: { tenantId: auth.tenantId!, sectionId, subjectId: x.subjectId, employeeId: e, createdBy: auth.userId } });
      }
      await tx.section.update({ where: { id: sectionId }, data: { classTeacherId: input.classTeacherId ?? null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'SECTION_TEACHERS', entityId: sectionId, oldValues: { classTeacherId: s.classTeacherId, teachers: before.map((b) => `${b.subjectId}:${b.employeeId}`) }, newValues: { classTeacherId: input.classTeacherId ?? null, teachers: want } }, client);
      return { saved: want.length };
    });
  }

  // ───────────── Electives ─────────────

  /** A student's optional subjects for their current class (only the class's optional subjects). */
  saveElectives(studentId: string, input: ElectivesInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { id: true, section: { select: { campusId: true, programLevelId: true } } } }));
      if (!e || !canAccessCampus(this.scope(auth, SETUP), e.section.campusId)) throw NotFound('Student');
      const optional = new Set((await tx.levelSubject.findMany({ where: { programLevelId: e.section.programLevelId, isOptional: true }, select: { subjectId: true } })).map((x) => x.subjectId));
      for (const id of input.subjectIds) if (!optional.has(id)) throw unprocessable('not-optional', 'Choose from this class’s optional subjects', 'subjectIds');
      const before = await tx.studentSubject.findMany({ where: { enrollmentId: e.id } });
      for (const b of before) if (!input.subjectIds.includes(b.subjectId)) await tx.$executeRaw`DELETE FROM student_subjects WHERE id = ${b.id}::uuid`;
      for (const id of input.subjectIds) if (!before.some((b) => b.subjectId === id)) await tx.studentSubject.create({ data: { tenantId: auth.tenantId!, enrollmentId: e.id, subjectId: id, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.section.campusId, action: 'UPDATE', entityType: 'STUDENT_SUBJECTS', entityId: studentId, oldValues: before.map((b) => b.subjectId), newValues: input.subjectIds }, client);
      return { saved: input.subjectIds.length };
    });
  }

  /**
   * Current-year sections for the academics screens: everything on the user's campuses for office
   * staff (read or set-up), and only their own sections for a teacher. `mine` marks the sections
   * the signed-in staff member teaches.
   */
  mySections(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) return [];
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const mine = new Set(me ? await this.teachingSections(tx, me.id) : []);
      const office = scopeFor(auth, PERMISSIONS.ACAD_READ) ?? scopeFor(auth, SETUP) ?? scopeFor(auth, PERMISSIONS.EXAM_READ);
      const where = office ? (office.all ? {} : { campusId: { in: office.campusIds } }) : { id: { in: [...mine] } };
      const rows = await tx.section.findMany({ where: { ...where, academicYearId: year.id, status: 'ACTIVE' }, select: { id: true, name: true, campusId: true, programLevelId: true, level: { select: { name: true, sequence: true, program: { select: { name: true } } } } } });
      const campuses = new Map((await tx.campus.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.campusId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return rows
        .sort((a, b) => a.level.program.name.localeCompare(b.level.program.name) || a.level.sequence - b.level.sequence || a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: `${s.level.name} – ${s.name}`, program: s.level.program.name, campusId: s.campusId, campus: campuses.get(s.campusId) ?? '', programLevelId: s.programLevelId, mine: mine.has(s.id) }));
    });
  }

  /** Teaching staff of a campus (for choosing teachers and substitutes). */
  teachingStaff(campusId: string, auth: AuthContext) {
    if (!canAccessCampus(this.scope(auth), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.employee.findMany({ where: { campusId, status: { in: ['ACTIVE', 'ON_LEAVE'] }, employeeType: { in: ['TEACHING', 'VISITING', 'CONTRACT'] } }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true } });
      return rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), code: e.employeeCode, designation: e.designation }));
    });
  }

  /** Sections this staff member teaches in (any subject) or is class teacher of — current year. */
  async teachingSections(tx: Tx, employeeId: string) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) return [] as string[];
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM sections s WHERE s.academic_year_id = ${year.id}::uuid AND (s.class_teacher_id = ${employeeId}::uuid
         OR s.id IN (SELECT section_id FROM section_subject_teachers WHERE employee_id = ${employeeId}::uuid))`;
    return rows.map((r) => r.id);
  }
}
