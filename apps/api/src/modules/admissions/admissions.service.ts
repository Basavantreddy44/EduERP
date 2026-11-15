import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@eduerp/db';
import {
  APPLICATION_EDITABLE, AddFollowupInput, ApplicationStatus, CreateApplicationInput, CreateEnquiryInput, DecideApplicationInput, DuplicateCheckInput, EnrolInput, PERMISSIONS, PermissionCode, UpdateApplicationInput,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo, day, linkGuardians, recordStatus, todayIST } from '../students/student-records';
import { autoAssign } from '../fees/assignments';

const optDay = (d: string | null | undefined) => (d ? day(d) : d === null ? null : undefined);
const inScope = (s: CampusScope) => (s.all ? {} : { campusId: { in: s.campusIds } });

export interface DuplicateMatch {
  kind: 'APPLICATION' | 'STUDENT';
  id: string;
  number: string;
  name: string;
  dob: string;
  status: string;
  reason: 'SAME_PHONE_AND_DOB' | 'SAME_PHONE_SIMILAR_NAME';
}

/**
 * Admissions (M1.2): enquiry → follow-ups → application (duplicate check, documents) → decision →
 * enrolment. Enrolment is one transaction: student, admission number, guardians (reused for
 * siblings by phone), class enrolment within the section's seats, and the `student.enrolled` event.
 */
@Injectable()
export class AdmissionsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbering: NumberingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode) {
    return scopeFor(auth, code)!;
  }
  private check(auth: AuthContext, code: PermissionCode, campusId: string) {
    if (!canAccessCampus(this.scope(auth, code), campusId)) throw NotFound('Campus');
  }

  /** The class must belong to a programme of the chosen campus; the academic year must exist and be open. */
  private async placement(tx: Tx, campusId: string, academicYearId: string, programLevelId: string) {
    if (!(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
    const year = await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { name: true, status: true } });
    if (!year) throw NotFound('Academic year');
    if (year.status === 'CLOSED') throw Conflict('academic-year-closed', `${year.name} is closed`);
    const level = await tx.programLevel.findUnique({ where: { id: programLevelId }, include: { program: { select: { campusId: true, status: true, name: true } } } });
    if (!level || level.program.campusId !== campusId) throw NotFound('Class');
    if (level.program.status !== 'ACTIVE') throw Conflict('program-inactive', `${level.program.name} is inactive`);
    return { year, level };
  }

  /**
   * What the admission forms need: open academic years and the classes of the campuses this user
   * handles admissions for. Separate from /programs so admission staff need no set-up permission.
   */
  async options(auth: AuthContext) {
    const scopes = [scopeFor(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE), scopeFor(auth, PERMISSIONS.ADM_APPLICATION_MANAGE)].filter((s): s is CampusScope => !!s);
    if (!scopes.length) throw Forbidden();
    const all = scopes.some((s) => s.all);
    const campusIds = [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))];
    return this.db.run(this.ctx(auth), async (tx) => {
      const [years, programs] = await Promise.all([
        tx.academicYear.findMany({ where: { status: { not: 'CLOSED' } }, orderBy: { startDate: 'desc' }, select: { id: true, name: true, isCurrent: true } }),
        tx.program.findMany({
          where: { status: 'ACTIVE', ...(all ? {} : { campusId: { in: campusIds } }) },
          orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
          select: { id: true, name: true, campusId: true, campus: { select: { code: true, name: true } }, levels: { orderBy: { sequence: 'asc' }, select: { id: true, name: true } } },
        }),
      ]);
      return { years, programs };
    });
  }

  // ───────────── Enquiries ─────────────

  async enquiries(auth: AuthContext, q: { status?: string; due?: 'today' | 'overdue'; search?: string; campusId?: string }) {
    const scope = this.scope(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    const today = todayIST();
    const where: Prisma.EnquiryWhereInput = {
      ...(q.campusId ? { campusId: q.campusId } : inScope(scope)),
      ...(q.status ? { status: q.status } : {}),
      ...(q.due === 'today' ? { nextFollowUp: today, status: { notIn: ['CONVERTED', 'LOST'] } } : {}),
      ...(q.due === 'overdue' ? { nextFollowUp: { lt: today }, status: { notIn: ['CONVERTED', 'LOST'] } } : {}),
      ...(q.search
        ? { OR: [{ studentName: { contains: q.search, mode: 'insensitive' } }, { parentName: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { enquiryNo: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    return this.db.run(this.ctx(auth), async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.enquiry.findMany({
          where,
          orderBy: [{ nextFollowUp: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
          take: 500,
          include: { level: { select: { name: true, program: { select: { name: true } } } }, campus: { select: { code: true } }, _count: { select: { followups: true } } },
        }),
        tx.enquiry.groupBy({ by: ['status'], where: q.campusId ? { campusId: q.campusId } : inScope(scope), _count: true }),
      ]);
      const dueToday = await tx.enquiry.count({ where: { ...(q.campusId ? { campusId: q.campusId } : inScope(scope)), nextFollowUp: { lte: today }, status: { notIn: ['CONVERTED', 'LOST'] } } });
      return { rows, summary: { byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])), dueOrOverdue: dueToday } };
    });
  }

  async enquiry(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.enquiry.findUnique({
        where: { id },
        include: {
          followups: { orderBy: { createdAt: 'desc' } },
          level: { select: { id: true, name: true, program: { select: { name: true } } } },
          campus: { select: { code: true, name: true } },
          academicYear: { select: { name: true } },
          applications: { select: { id: true, applicationNo: true, status: true } },
        },
      });
      if (!e || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE), e.campusId)) throw NotFound('Enquiry');
      return e;
    });
  }

  async createEnquiry(input: CreateEnquiryInput, auth: AuthContext, client: ClientInfo) {
    this.check(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const { year } = await this.placement(tx, input.campusId, input.academicYearId, input.programLevelId);
      const enquiryNo = await allocateNo(this.numbering, tx, 'ENQUIRY', input.campusId, year.name, auth.userId);
      const e = await tx.enquiry.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId, academicYearId: input.academicYearId, programLevelId: input.programLevelId, enquiryNo,
          studentName: input.studentName, dob: optDay(input.dob), parentName: input.parentName, phone: input.phone, email: input.email ?? null,
          source: input.source, nextFollowUp: optDay(input.nextFollowUp), notes: input.notes ?? null, createdBy: auth.userId,
        },
      });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'ENQUIRY', entityId: e.id, newValues: e }, client);
      return e;
    });
  }

  async addFollowup(id: string, input: AddFollowupInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.enquiry.findUnique({ where: { id } });
      if (!e || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE), e.campusId)) throw NotFound('Enquiry');
      if (e.status === 'CONVERTED') throw Conflict('enquiry-converted', 'This enquiry already became an application');
      const nextFollowUp = input.status === 'LOST' ? null : optDay(input.nextFollowUp) ?? null;
      const f = await tx.enquiryFollowup.create({
        data: { tenantId: e.tenantId, enquiryId: id, mode: input.mode, remarks: input.remarks, status: input.status, nextFollowUp, createdBy: auth.userId },
      });
      await tx.enquiry.update({ where: { id }, data: { status: input.status, nextFollowUp, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'ENQUIRY', entityId: id, oldValues: { status: e.status }, newValues: { status: input.status, followup: f.id } }, client);
      return f;
    });
  }

  // ───────────── Duplicate check ─────────────

  /**
   * Possible duplicates: an application or student with the same parent phone and the same date of
   * birth, or the same parent phone and a similar name. Same phone with a different child is a sibling
   * and is not flagged. Cancelled/rejected applications are ignored.
   */
  private async findDuplicates(tx: Tx, q: DuplicateCheckInput, excludeApplicationId?: string): Promise<DuplicateMatch[]> {
    const name = `${q.firstName} ${q.lastName ?? ''}`.trim().toLowerCase();
    const dob = q.dob ?? null;
    const exclude = excludeApplicationId ?? null;
    const apps = await tx.$queryRaw<DuplicateMatch[]>`
      SELECT 'APPLICATION' AS kind, a.id, a.application_no AS number, trim(a.first_name || ' ' || coalesce(a.last_name, '')) AS name,
             to_char(a.dob, 'YYYY-MM-DD') AS dob, a.status,
             CASE WHEN ${dob}::date IS NOT NULL AND a.dob = ${dob}::date THEN 'SAME_PHONE_AND_DOB' ELSE 'SAME_PHONE_SIMILAR_NAME' END AS reason
        FROM admission_applications a
       WHERE a.parent_phone = ${q.parentPhone}
         AND a.status NOT IN ('CANCELLED', 'REJECTED')
         AND a.student_id IS NULL
         AND (${exclude}::uuid IS NULL OR a.id <> ${exclude}::uuid)
         AND ((${dob}::date IS NOT NULL AND a.dob = ${dob}::date)
              OR similarity(lower(a.first_name || ' ' || coalesce(a.last_name, '')), ${name}) >= 0.45)
       LIMIT 10`;
    const students = await tx.$queryRaw<DuplicateMatch[]>`
      SELECT DISTINCT 'STUDENT' AS kind, s.id, s.admission_no AS number, trim(s.first_name || ' ' || coalesce(s.last_name, '')) AS name,
             to_char(s.dob, 'YYYY-MM-DD') AS dob, s.status,
             CASE WHEN ${dob}::date IS NOT NULL AND s.dob = ${dob}::date THEN 'SAME_PHONE_AND_DOB' ELSE 'SAME_PHONE_SIMILAR_NAME' END AS reason
        FROM students s
        JOIN student_guardians sg ON sg.student_id = s.id
        JOIN guardians g ON g.id = sg.guardian_id
       WHERE g.phone = ${q.parentPhone}
         AND ((${dob}::date IS NOT NULL AND s.dob = ${dob}::date)
              OR similarity(lower(s.first_name || ' ' || coalesce(s.last_name, '')), ${name}) >= 0.45)
       LIMIT 10`;
    return [...students, ...apps];
  }

  duplicateCheck(q: DuplicateCheckInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.findDuplicates(tx, q));
  }

  // ───────────── Applications ─────────────

  async applications(auth: AuthContext, q: { status?: string; search?: string; campusId?: string; academicYearId?: string }) {
    const scope = this.scope(auth, PERMISSIONS.ADM_APPLICATION_MANAGE);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    const base: Prisma.AdmissionApplicationWhereInput = {
      ...(q.campusId ? { campusId: q.campusId } : inScope(scope)),
      ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}),
    };
    const where: Prisma.AdmissionApplicationWhereInput = {
      ...base,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } },
              { applicationNo: { contains: q.search, mode: 'insensitive' } }, { parentPhone: { contains: q.search } },
            ],
          }
        : {}),
    };
    return this.db.run(this.ctx(auth), async (tx) => {
      const [rows, counts] = await Promise.all([
        tx.admissionApplication.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            id: true, applicationNo: true, firstName: true, lastName: true, dob: true, gender: true, parentPhone: true, status: true, createdAt: true,
            campusId: true, academicYearId: true, programLevelId: true,
            level: { select: { name: true, program: { select: { name: true } } } }, campus: { select: { code: true } },
            student: { select: { id: true, admissionNo: true } },
          },
        }),
        tx.admissionApplication.groupBy({ by: ['status'], where: base, _count: true }),
      ]);
      return { rows, summary: { byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])) } };
    });
  }

  async application(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.admissionApplication.findUnique({
        where: { id },
        include: {
          level: { select: { id: true, name: true, program: { select: { id: true, name: true } } } },
          campus: { select: { code: true, name: true } },
          academicYear: { select: { name: true } },
          enquiry: { select: { id: true, enquiryNo: true } },
          student: { select: { id: true, admissionNo: true } },
        },
      });
      if (!a || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_APPLICATION_MANAGE), a.campusId)) throw NotFound('Application');
      return a;
    });
  }

  async createApplication(input: CreateApplicationInput, auth: AuthContext, client: ClientInfo) {
    this.check(auth, PERMISSIONS.ADM_APPLICATION_MANAGE, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const { year } = await this.placement(tx, input.campusId, input.academicYearId, input.programLevelId);
      let enquiry = null;
      if (input.enquiryId) {
        enquiry = await tx.enquiry.findUnique({ where: { id: input.enquiryId } });
        if (!enquiry || enquiry.campusId !== input.campusId) throw NotFound('Enquiry');
        if (enquiry.status === 'CONVERTED') throw Conflict('enquiry-converted', 'This enquiry already became an application');
      }
      const matches = await this.findDuplicates(tx, { parentPhone: input.parentPhone, dob: input.dob, firstName: input.firstName, lastName: input.lastName });
      if (matches.length && !input.duplicateReason) {
        throw new AppError(HttpStatus.CONFLICT, 'possible-duplicate', 'This child may already have an application or admission. Check the matches, or give a reason to continue.', matches);
      }
      const applicationNo = await allocateNo(this.numbering, tx, 'APPLICATION', input.campusId, year.name, auth.userId);
      const { duplicateReason, enquiryId, dob, ...fields } = input;
      const a = await tx.admissionApplication.create({
        data: {
          ...fields, tenantId: auth.tenantId!, applicationNo, dob: day(dob), enquiryId: enquiryId ?? null,
          duplicateReason: matches.length ? duplicateReason : null, createdBy: auth.userId,
        },
      });
      if (enquiry) await tx.enquiry.update({ where: { id: enquiry.id }, data: { status: 'CONVERTED', nextFollowUp: null, updatedBy: auth.userId } });
      await this.audit.log(tx, {
        tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'APPLICATION', entityId: a.id,
        newValues: { ...a, possibleDuplicates: matches.map((m) => m.number) },
      }, client);
      return a;
    });
  }

  async updateApplication(id: string, input: UpdateApplicationInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.admissionApplication.findUnique({ where: { id } });
      if (!before || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_APPLICATION_MANAGE), before.campusId)) throw NotFound('Application');
      if (!APPLICATION_EDITABLE.includes(before.status as ApplicationStatus)) throw Conflict('application-locked', 'A decided application cannot be edited');
      if (input.programLevelId && input.programLevelId !== before.programLevelId) await this.placement(tx, before.campusId, before.academicYearId, input.programLevelId);
      const { dob, ...rest } = input;
      const a = await tx.admissionApplication.update({ where: { id }, data: { ...rest, ...(dob ? { dob: day(dob) } : {}), updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'APPLICATION', entityId: id, oldValues: before, newValues: a }, client);
      return a;
    });
  }

  async decide(id: string, input: DecideApplicationInput, auth: AuthContext, client: ClientInfo) {
    const next = ({ APPROVE: 'APPROVED', REJECT: 'REJECTED', WAITLIST: 'WAITLISTED' } as const)[input.decision];
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.admissionApplication.findUnique({ where: { id } });
      if (!before || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_APPLICATION_DECIDE), before.campusId)) throw NotFound('Application');
      if (!['SUBMITTED', 'UNDER_REVIEW', 'WAITLISTED'].includes(before.status) || before.status === next) {
        throw Conflict('invalid-transition', `An application that is ${before.status.toLowerCase().replace('_', ' ')} cannot be marked ${next.toLowerCase()}`);
      }
      const a = await tx.admissionApplication.update({
        where: { id },
        data: { status: next, decisionRemarks: input.remarks ?? null, decidedAt: new Date(), decidedBy: auth.userId, updatedBy: auth.userId },
      });
      await this.audit.log(tx, {
        tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'APPLICATION', entityId: id,
        oldValues: { status: before.status }, newValues: { status: next, remarks: input.remarks ?? null },
      }, client);
      return a;
    });
  }

  async cancel(id: string, remarks: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.admissionApplication.findUnique({ where: { id } });
      if (!before || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_APPLICATION_MANAGE), before.campusId)) throw NotFound('Application');
      if (['ENROLLED', 'REJECTED', 'CANCELLED'].includes(before.status)) throw Conflict('invalid-transition', `This application is already ${before.status.toLowerCase()}`);
      const a = await tx.admissionApplication.update({ where: { id }, data: { status: 'CANCELLED', decisionRemarks: remarks, decidedAt: new Date(), decidedBy: auth.userId, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: a.tenantId, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'APPLICATION', entityId: id, oldValues: { status: before.status }, newValues: { status: 'CANCELLED', remarks } }, client);
      return a;
    });
  }

  // ───────────── Enrolment ─────────────

  /** Sections of the applied class in the applied year, with seats taken — for choosing where to enrol. */
  async enrolOptions(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.admissionApplication.findUnique({ where: { id }, select: { campusId: true, academicYearId: true, programLevelId: true } });
      if (!a || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_ENROL), a.campusId)) throw NotFound('Application');
      const sections = await tx.section.findMany({
        where: { academicYearId: a.academicYearId, programLevelId: a.programLevelId, campusId: a.campusId, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, capacity: true, room: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      });
      return sections.map(({ _count, ...s }) => ({ ...s, filled: _count.enrollments, available: Math.max(0, s.capacity - _count.enrollments) }));
    });
  }

  async enrol(id: string, input: EnrolInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      // Lock the application so two clicks cannot enrol the same child twice.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM admission_applications WHERE id = ${id}::uuid FOR UPDATE`;
      const a = locked.length ? await tx.admissionApplication.findUnique({ where: { id }, include: { academicYear: { select: { name: true, status: true } } } }) : null;
      if (!a || !canAccessCampus(this.scope(auth, PERMISSIONS.ADM_ENROL), a.campusId)) throw NotFound('Application');
      if (a.status !== 'APPROVED') throw Conflict('not-approved', a.status === 'ENROLLED' ? 'This applicant is already enrolled' : 'Only approved applications can be enrolled');
      if (a.academicYear.status === 'CLOSED') throw Conflict('academic-year-closed', `${a.academicYear.name} is closed`);

      // Lock the section row: concurrent enrolments into the same section queue here, so seats are never oversold.
      const sec = await tx.$queryRaw<{ capacity: number; status: string; campus_id: string; academic_year_id: string; program_level_id: string; name: string }[]>`
        SELECT capacity, status, campus_id, academic_year_id, program_level_id, name FROM sections WHERE id = ${input.sectionId}::uuid FOR UPDATE`;
      const s = sec[0];
      if (!s || s.campus_id !== a.campusId || s.academic_year_id !== a.academicYearId || s.program_level_id !== a.programLevelId) throw NotFound('Section');
      if (s.status !== 'ACTIVE') throw Conflict('section-inactive', `Section ${s.name} is inactive`);
      const filled = await tx.studentEnrollment.count({ where: { sectionId: input.sectionId, status: 'ACTIVE' } });
      if (filled >= s.capacity) throw Conflict('section-full', `Section ${s.name} is full (${s.capacity} seats). Choose another section or increase its seats.`);

      const tenantId = a.tenantId;
      const admissionNo = await allocateNo(this.numbering, tx, 'ADMISSION', a.campusId, a.academicYear.name, auth.userId);
      const admissionDate = input.admissionDate ? day(input.admissionDate) : todayIST();
      const student = await tx.student.create({
        data: {
          tenantId, campusId: a.campusId, admissionNo, firstName: a.firstName, lastName: a.lastName, nameLocal: a.nameLocal, dob: a.dob, gender: a.gender,
          category: a.category, religion: a.religion, motherTongue: a.motherTongue, aadhaarLast4: a.aadhaarLast4, address: a.address, admissionDate, createdBy: auth.userId,
        },
      });
      const guardians = await linkGuardians(tx, student.id, a, auth.userId);
      await recordStatus(tx, { tenantId, studentId: student.id, oldStatus: null, newStatus: 'ACTIVE', effectiveDate: admissionDate, reason: `Admitted (application ${a.applicationNo})`, userId: auth.userId });
      const enrollment = await tx.studentEnrollment.create({
        data: { tenantId, studentId: student.id, academicYearId: a.academicYearId, sectionId: input.sectionId, rollNo: input.rollNo ?? null, enrolledOn: admissionDate, createdBy: auth.userId },
      });
      await autoAssign(tx, { tenantId, studentId: student.id, academicYearId: a.academicYearId, programLevelId: a.programLevelId, userId: auth.userId });
      await tx.admissionApplication.update({ where: { id }, data: { status: 'ENROLLED', studentId: student.id, updatedBy: auth.userId } });
      await this.outbox.add(tx, {
        tenantId, eventType: EVENTS.STUDENT_ENROLLED, aggregateType: 'STUDENT', aggregateId: student.id,
        payload: { studentId: student.id, admissionNo, applicationId: id, campusId: a.campusId, academicYearId: a.academicYearId, sectionId: input.sectionId },
        dedupeKey: `enrol:${id}`,
      });
      await this.audit.log(tx, {
        tenantId, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'STUDENT', entityId: student.id,
        newValues: { admissionNo, applicationNo: a.applicationNo, section: s.name, guardians: guardians.map((g) => ({ id: g.id, relation: g.relation, reused: g.reused })) },
      }, client);
      return { student, enrollment, admissionNo, guardians };
    });
  }
}
