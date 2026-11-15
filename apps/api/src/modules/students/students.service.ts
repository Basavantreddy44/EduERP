import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import {
  AddGuardianInput, ChangeSectionInput, ChangeStudentStatusInput, PERMISSIONS, PermissionCode, StudentQuery, UpdateGuardianInput, UpdateGuardianLinkInput,
  UpdateStudentInput,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { day, recordStatus } from './student-records';
import { autoAssign } from '../fees/assignments';

const READ = PERMISSIONS.STU_STUDENT_READ;
const MANAGE = PERMISSIONS.STU_STUDENT_MANAGE;

export interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dob: Date;
  status: string;
  campusId: string;
  campusCode: string;
  rollNo: string | null;
  sectionId: string | null;
  sectionName: string | null;
  levelName: string | null;
  programName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Students & parents (M1.3): fast search, profile, edits, status changes (kept as history),
 * section change within the year (one active enrolment), and parents shared between siblings.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode): CampusScope {
    return scopeFor(auth, code)!;
  }

  /** The year whose classes the list shows: the one asked for, else the current one, else the latest. */
  private async yearOf(tx: Tx, academicYearId?: string) {
    if (academicYearId) {
      const y = await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, name: true, status: true } });
      if (!y) throw NotFound('Academic year');
      return y;
    }
    return (
      (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true, status: true } })) ??
      (await tx.academicYear.findFirst({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, status: true } }))
    );
  }

  /** Locks the student row and checks campus scope; used by every change. */
  private async lockStudent(tx: Tx, id: string, auth: AuthContext) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM students WHERE id = ${id}::uuid FOR UPDATE`;
    const s = rows.length ? await tx.student.findUnique({ where: { id } }) : null;
    if (!s || !canAccessCampus(this.scope(auth, MANAGE), s.campusId)) throw NotFound('Student');
    return s;
  }

  /** Locks a section and checks it has a free seat. */
  private async seat(tx: Tx, sectionId: string) {
    const rows = await tx.$queryRaw<{ id: string; name: string; capacity: number; status: string; campus_id: string; academic_year_id: string; program_level_id: string }[]>`
      SELECT id, name, capacity, status, campus_id, academic_year_id, program_level_id FROM sections WHERE id = ${sectionId}::uuid FOR UPDATE`;
    const sec = rows[0];
    if (!sec) throw NotFound('Section');
    if (sec.status !== 'ACTIVE') throw Conflict('section-inactive', `Section ${sec.name} is inactive`);
    const filled = await tx.studentEnrollment.count({ where: { sectionId, status: 'ACTIVE' } });
    if (filled >= sec.capacity) throw Conflict('section-full', `Section ${sec.name} is full (${sec.capacity} seats). Choose another section or increase its seats.`);
    return sec;
  }

  // ───────────── Filters & search ─────────────

  /** Years, classes and sections for the filters, limited to the campuses this user may see. */
  async options(auth: AuthContext, academicYearId?: string) {
    const scope = this.scope(auth, READ);
    const inScope = scope.all ? {} : { campusId: { in: scope.campusIds } };
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await this.yearOf(tx, academicYearId);
      const [years, campuses, programs, sections] = await Promise.all([
        tx.academicYear.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, isCurrent: true, status: true } }),
        tx.campus.findMany({ where: scope.all ? {} : { id: { in: scope.campusIds } }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
        tx.program.findMany({ where: inScope, orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }], select: { id: true, name: true, campusId: true, levels: { orderBy: { sequence: 'asc' }, select: { id: true, name: true } } } }),
        year
          ? tx.section.findMany({ where: { ...inScope, academicYearId: year.id }, orderBy: { name: 'asc' }, select: { id: true, name: true, programLevelId: true, capacity: true, status: true } })
          : [],
      ]);
      return { year, years, campuses, programs, sections };
    });
  }

  /**
   * Search (AC28): name, admission number or parent mobile, as you type. Each word must match the
   * name or the admission number; a number of 4+ digits also matches a parent's mobile. Filters by
   * campus, class, section and status; the class shown is the active one in the chosen year.
   */
  async list(auth: AuthContext, q: StudentQuery) {
    const scope = this.scope(auth, READ);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const started = process.hrtime.bigint();
      const year = await this.yearOf(tx, q.academicYearId);
      const where: Prisma.Sql[] = [];
      if (!scope.all) where.push(Prisma.sql`s.campus_id = ANY(${scope.campusIds}::uuid[])`);
      if (q.campusId) where.push(Prisma.sql`s.campus_id = ${q.campusId}::uuid`);
      if (q.status) where.push(Prisma.sql`s.status = ${q.status}`);
      if (q.sectionId) where.push(Prisma.sql`e.section_id = ${q.sectionId}::uuid`);
      if (q.programLevelId) where.push(Prisma.sql`sec.program_level_id = ${q.programLevelId}::uuid`);
      if (q.programId) where.push(Prisma.sql`l.program_id = ${q.programId}::uuid`);
      const text = (q.q ?? '').trim().toLowerCase();
      if (text) {
        const digits = text.replace(/[\s+-]/g, '');
        if (/^\d{4,}$/.test(digits)) {
          const tail = digits.length > 10 ? digits.slice(-10) : digits; // +91 98450 12345 → 9845012345
          where.push(Prisma.sql`(lower(s.admission_no) LIKE ${`%${likeEscape(digits)}%`} OR s.id IN (
            SELECT sg.student_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE g.phone LIKE ${`%${tail}%`}))`);
        } else {
          for (const w of text.split(/\s+/).slice(0, 5)) {
            const like = `%${likeEscape(w)}%`;
            where.push(Prisma.sql`(lower(s.first_name || ' ' || coalesce(s.last_name, '')) LIKE ${like} OR lower(admission_no) LIKE ${like})`);
          }
        }
      }
      const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
      const dir = Prisma.raw(q.dir === 'desc' ? 'DESC' : 'ASC');
      const order =
        q.sort === 'admissionNo'
          ? Prisma.sql`admission_no ${dir}`
          : q.sort === 'class'
            ? Prisma.sql`program_name ${dir} NULLS LAST, level_seq ${dir} NULLS LAST, section_name ${dir} NULLS LAST, name_key ASC, admission_no ASC`
            : Prisma.sql`name_key ${dir}, admission_no ${dir}`;
      const yearId = year?.id ?? '00000000-0000-0000-0000-000000000000';
      const offset = (q.page - 1) * q.pageSize;

      // Without a class filter or class sort, the page is chosen from students alone and the class is
      // looked up for those rows only — the common "browse / search" case stays fast as the school grows.
      const byClass = !!(q.sectionId || q.programLevelId || q.programId) || q.sort === 'class';
      const rows = !byClass
        ? await tx.$queryRaw<(StudentRow & { total: bigint })[]>`
        WITH base AS (
          SELECT s.id, s.admission_no, s.first_name, s.last_name, s.gender, s.dob, s.status, s.campus_id,
                 lower(s.first_name || ' ' || coalesce(s.last_name, '')) AS name_key
            FROM students s
          ${whereSql}
        ), page AS (
          SELECT * FROM base ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}
        )
        SELECT page.id, page.admission_no AS "admissionNo", page.first_name AS "firstName", page.last_name AS "lastName", page.gender, page.dob, page.status,
               page.campus_id AS "campusId", c.code AS "campusCode", cls.roll_no AS "rollNo", cls.section_id AS "sectionId", cls.section_name AS "sectionName",
               cls.level_name AS "levelName", cls.program_name AS "programName", pg.name AS "guardianName", pg.phone AS "guardianPhone",
               (SELECT count(*) FROM base) AS total
          FROM page
          JOIN campuses c ON c.id = page.campus_id
          LEFT JOIN LATERAL (
            SELECT e.roll_no, sec.id AS section_id, sec.name AS section_name, l.name AS level_name, p.name AS program_name
              FROM student_enrollments e JOIN sections sec ON sec.id = e.section_id JOIN program_levels l ON l.id = sec.program_level_id JOIN programs p ON p.id = l.program_id
             WHERE e.student_id = page.id AND e.academic_year_id = ${yearId}::uuid AND e.status = 'ACTIVE' LIMIT 1) cls ON true
          LEFT JOIN LATERAL (
            SELECT g.name, g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
             WHERE sg.student_id = page.id ORDER BY sg.is_primary DESC, sg.created_at ASC LIMIT 1) pg ON true
         ORDER BY ${order}`
        : await tx.$queryRaw<(StudentRow & { total: bigint })[]>`
        WITH base AS (
          SELECT s.id, s.admission_no, s.first_name, s.last_name, s.gender, s.dob, s.status, s.campus_id,
                 lower(s.first_name || ' ' || coalesce(s.last_name, '')) AS name_key,
                 e.roll_no, sec.id AS section_id, sec.name AS section_name, l.name AS level_name, l.sequence AS level_seq, p.name AS program_name
            FROM students s
            LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ${yearId}::uuid AND e.status = 'ACTIVE'
            LEFT JOIN sections sec ON sec.id = e.section_id
            LEFT JOIN program_levels l ON l.id = sec.program_level_id
            LEFT JOIN programs p ON p.id = l.program_id
          ${whereSql}
        ), page AS (
          SELECT * FROM base ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${offset}
        )
        SELECT page.id, page.admission_no AS "admissionNo", page.first_name AS "firstName", page.last_name AS "lastName", page.gender, page.dob, page.status,
               page.campus_id AS "campusId", c.code AS "campusCode", page.roll_no AS "rollNo", page.section_id AS "sectionId", page.section_name AS "sectionName",
               page.level_name AS "levelName", page.program_name AS "programName", pg.name AS "guardianName", pg.phone AS "guardianPhone",
               (SELECT count(*) FROM base) AS total
          FROM page
          JOIN campuses c ON c.id = page.campus_id
          LEFT JOIN LATERAL (
            SELECT g.name, g.phone FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
             WHERE sg.student_id = page.id ORDER BY sg.is_primary DESC, sg.created_at ASC LIMIT 1) pg ON true
         ORDER BY ${order}`;
      const total = rows.length ? Number(rows[0].total) : offset ? await this.countOnly(tx, whereSql, yearId) : 0;
      const counts = await tx.student.groupBy({ by: ['status'], where: scope.all ? {} : { campusId: { in: scope.campusIds } }, _count: true });
      const tookMs = Number(process.hrtime.bigint() - started) / 1e6;
      return {
        items: rows.map(({ total: _t, ...r }) => r),
        total,
        page: q.page,
        pageSize: q.pageSize,
        year,
        summary: { byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])) },
        tookMs: Math.round(tookMs * 10) / 10,
      };
    });
  }

  /** Total for a page past the end (the paged query returned no rows to carry it). */
  private async countOnly(tx: Tx, whereSql: Prisma.Sql, yearId: string) {
    const r = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM students s
        LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = ${yearId}::uuid AND e.status = 'ACTIVE'
        LEFT JOIN sections sec ON sec.id = e.section_id
        LEFT JOIN program_levels l ON l.id = sec.program_level_id
      ${whereSql}`;
    return Number(r[0].n);
  }

  // ───────────── Profile ─────────────

  async get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({
        where: { id },
        include: {
          campus: { select: { id: true, code: true, name: true } },
          enrollments: {
            orderBy: [{ enrolledOn: 'desc' }, { createdAt: 'desc' }],
            include: {
              academicYear: { select: { id: true, name: true, isCurrent: true, status: true } },
              section: { select: { id: true, name: true, level: { select: { id: true, name: true, program: { select: { id: true, name: true } } } } } },
            },
          },
          guardians: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            include: {
              guardian: {
                include: { students: { select: { student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, status: true, campusId: true } } } } },
              },
            },
          },
          statusHistory: { orderBy: [{ createdAt: 'desc' }] },
          applications: { select: { id: true, applicationNo: true } },
        },
      });
      const scope = this.scope(auth, READ);
      if (!s || !canAccessCampus(scope, s.campusId)) throw NotFound('Student');
      const userIds = [...new Set(s.statusHistory.map((h) => h.createdBy).filter((x): x is string => !!x))];
      const users = userIds.length ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
      const byUser = new Map(users.map((u) => [u.id, u.fullName]));
      return {
        ...s,
        guardians: s.guardians.map(({ guardian: { students, ...g }, ...link }) => ({
          ...link,
          guardian: g,
          // Brothers and sisters sharing this parent (only those this user may see).
          siblings: students.map((x) => x.student).filter((x) => x.id !== s.id && canAccessCampus(scope, x.campusId)).map(({ campusId: _c, ...x }) => x),
        })),
        statusHistory: s.statusHistory.map((h) => ({ ...h, byName: h.createdBy ? byUser.get(h.createdBy) ?? null : null })),
        canManage: !!scopeFor(auth, MANAGE) && canAccessCampus(this.scope(auth, MANAGE), s.campusId),
      };
    });
  }

  async update(id: string, input: UpdateStudentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await this.lockStudent(tx, id, auth);
      const { rollNo, dob, ...fields } = input;
      const s = await tx.student.update({ where: { id }, data: { ...fields, ...(dob ? { dob: day(dob) } : {}), updatedBy: auth.userId } });
      let rollChange: { from: string | null; to: string | null } | undefined;
      if (rollNo !== undefined) {
        const active = await this.activeEnrolment(tx, id);
        if (!active) throw Conflict('not-enrolled', 'This student has no class this year, so a roll number cannot be set');
        if (active.rollNo !== rollNo) {
          await tx.studentEnrollment.update({ where: { id: active.id }, data: { rollNo } });
          rollChange = { from: active.rollNo, to: rollNo };
        }
      }
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT', entityId: id, oldValues: before, newValues: { ...s, ...(rollChange ? { rollNo: rollChange } : {}) } }, client);
      return s;
    });
  }

  /** The active enrolment in the current (or latest open) academic year. */
  private async activeEnrolment(tx: Tx, studentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM student_enrollments e JOIN academic_years y ON y.id = e.academic_year_id
       WHERE e.student_id = ${studentId}::uuid AND e.status = 'ACTIVE'
       ORDER BY y.is_current DESC, y.start_date DESC LIMIT 1 FOR UPDATE OF e`;
    return rows.length
      ? tx.studentEnrollment.findUnique({ where: { id: rows[0].id }, include: { academicYear: { select: { name: true, status: true } }, section: { select: { name: true, programLevelId: true } } } })
      : null;
  }

  // ───────────── Status ─────────────

  /**
   * ACTIVE ↔ INACTIVE keeps the seat; DROPPED frees it (the enrolment is closed as LEFT). A dropped
   * student who comes back re-joins a section with a free seat. Every change is kept in the history.
   */
  async changeStatus(id: string, input: ChangeStudentStatusInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockStudent(tx, id, auth);
      if (['TRANSFERRED', 'PASSED_OUT'].includes(s.status)) {
        throw Conflict('student-left', `This student is ${s.status === 'TRANSFERRED' ? 'transferred' : 'passed out'}; that is changed only by a Transfer Certificate or year-end promotion`);
      }
      if (s.status === input.status) throw Conflict('same-status', `The student is already ${input.status.toLowerCase()}`);
      const eff = day(input.effectiveDate);
      if (eff < s.admissionDate) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'date-before-admission', 'The date is before the admission date', [{ field: 'effectiveDate', message: 'The date is before the admission date' }]);

      let enrolment: { closed?: string; joined?: string } = {};
      if (input.status === 'DROPPED') {
        const active = await this.activeEnrolment(tx, id);
        if (active) {
          if (eff < active.enrolledOn) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'date-before-enrolment', 'The date is before the student joined the current section', [{ field: 'effectiveDate', message: 'Before the student joined the section' }]);
          await tx.studentEnrollment.update({ where: { id: active.id }, data: { status: 'LEFT', endedOn: eff, remarks: input.reason } });
          enrolment = { closed: active.id };
        }
      } else if (s.status === 'DROPPED') {
        const year = await this.yearOf(tx);
        if (year && year.status !== 'CLOSED') {
          if (!input.sectionId) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'section-required', 'Choose the section the student re-joins', [{ field: 'sectionId', message: 'Choose a section' }]);
          const sec = await this.seat(tx, input.sectionId);
          if (sec.campus_id !== s.campusId || sec.academic_year_id !== year.id) throw NotFound('Section');
          const e = await tx.studentEnrollment.create({ data: { tenantId: s.tenantId, studentId: id, academicYearId: year.id, sectionId: sec.id, enrolledOn: eff, remarks: input.reason, createdBy: auth.userId } });
          enrolment = { joined: e.id };
          await autoAssign(tx, { tenantId: s.tenantId, studentId: id, academicYearId: year.id, programLevelId: sec.program_level_id, userId: auth.userId });
        }
      }

      const updated = await tx.student.update({ where: { id }, data: { status: input.status, updatedBy: auth.userId } });
      const h = await recordStatus(tx, { tenantId: s.tenantId, studentId: id, oldStatus: s.status, newStatus: input.status, effectiveDate: eff, reason: input.reason, userId: auth.userId });
      await this.outbox.add(tx, {
        tenantId: s.tenantId, eventType: EVENTS.STUDENT_STATUS_CHANGED, aggregateType: 'STUDENT', aggregateId: id,
        payload: { studentId: id, from: s.status, to: input.status, effectiveDate: input.effectiveDate }, dedupeKey: `status:${h.id}`,
      });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT', entityId: id, oldValues: { status: s.status }, newValues: { status: input.status, reason: input.reason, effectiveDate: input.effectiveDate, ...enrolment } }, client);
      return updated;
    });
  }

  // ───────────── Section change ─────────────

  /** Other sections of the student's class this year, with free seats. */
  async sectionOptions(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id }, select: { campusId: true, status: true } });
      if (!s || !canAccessCampus(this.scope(auth, MANAGE), s.campusId)) throw NotFound('Student');
      const current = await tx.studentEnrollment.findFirst({
        where: { studentId: id, status: 'ACTIVE' },
        orderBy: [{ academicYear: { isCurrent: 'desc' } }, { academicYear: { startDate: 'desc' } }],
        select: { sectionId: true, academicYearId: true, section: { select: { programLevelId: true } } },
      });
      const year = current ? null : await this.yearOf(tx);
      const sections = await tx.section.findMany({
        where: current
          ? { academicYearId: current.academicYearId, programLevelId: current.section.programLevelId, campusId: s.campusId, status: 'ACTIVE' }
          : { academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000', campusId: s.campusId, status: 'ACTIVE' },
        orderBy: [{ level: { program: { name: 'asc' } } }, { level: { sequence: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, capacity: true, room: true, level: { select: { name: true, program: { select: { name: true } } } }, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
      });
      return {
        currentSectionId: current?.sectionId ?? null,
        sections: sections.map(({ _count, ...x }) => ({ ...x, filled: _count.enrollments, available: Math.max(0, x.capacity - _count.enrollments) })),
      };
    });
  }

  /** Moves the student to another section of the same class and year; the old row stays as MOVED. */
  async changeSection(id: string, input: ChangeSectionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockStudent(tx, id, auth);
      if (!['ACTIVE', 'INACTIVE'].includes(s.status)) throw Conflict('student-not-active', 'Only a current student can change section');
      const active = await this.activeEnrolment(tx, id);
      if (!active) throw Conflict('not-enrolled', 'This student has no class this year');
      if (active.academicYear.status === 'CLOSED') throw Conflict('academic-year-closed', `${active.academicYear.name} is closed`);
      if (active.sectionId === input.sectionId) throw Conflict('same-section', `The student is already in section ${active.section.name}`);
      const sec = await this.seat(tx, input.sectionId);
      if (sec.campus_id !== s.campusId || sec.academic_year_id !== active.academicYearId || sec.program_level_id !== active.section.programLevelId) {
        throw Conflict('other-class', 'A section change stays within the same class and year. Moving to another class happens at promotion.');
      }
      const eff = day(input.effectiveDate);
      if (eff < active.enrolledOn) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'date-before-enrolment', 'The date is before the student joined the current section', [{ field: 'effectiveDate', message: 'Before the student joined the current section' }]);
      await tx.studentEnrollment.update({ where: { id: active.id }, data: { status: 'MOVED', endedOn: eff, remarks: input.reason } });
      const next = await tx.studentEnrollment.create({
        data: { tenantId: s.tenantId, studentId: id, academicYearId: active.academicYearId, sectionId: sec.id, rollNo: input.rollNo ?? null, enrolledOn: eff, remarks: input.reason, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT', entityId: id, oldValues: { section: active.section.name, enrollmentId: active.id }, newValues: { section: sec.name, enrollmentId: next.id, reason: input.reason, effectiveDate: input.effectiveDate } }, client);
      return next;
    });
  }

  // ───────────── Parents ─────────────

  /** Parents already on record with this mobile, and their children (to link a sibling's parent). */
  async lookupGuardians(phone: string, auth: AuthContext) {
    const scope = this.scope(auth, READ);
    return this.db.run(this.ctx(auth), async (tx) => {
      const gs = await tx.guardian.findMany({
        where: { phone },
        orderBy: { createdAt: 'asc' },
        include: { students: { select: { relation: true, student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, campusId: true } } } } },
      });
      return gs.map(({ students, ...g }) => ({
        ...g,
        children: students.filter((x) => canAccessCampus(scope, x.student.campusId)).map((x) => ({ ...x.student, relation: x.relation })),
        otherChildren: students.filter((x) => !canAccessCampus(scope, x.student.campusId)).length,
      }));
    });
  }

  private async setPrimary(tx: Tx, studentId: string, guardianId: string) {
    await tx.studentGuardian.updateMany({ where: { studentId, isPrimary: true, NOT: { guardianId } }, data: { isPrimary: false } });
    await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data: { isPrimary: true } });
  }

  private async phoneTaken(tx: Tx, phone: string, exceptGuardianId?: string) {
    const others = await tx.guardian.findMany({ where: { phone, ...(exceptGuardianId ? { NOT: { id: exceptGuardianId } } : {}) }, select: { id: true, name: true } });
    if (others.length) {
      throw new AppError(HttpStatus.CONFLICT, 'guardian-phone-exists', 'A parent with this mobile is already on record. Link that parent instead of adding them again.', others);
    }
  }

  async addGuardian(id: string, input: AddGuardianInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockStudent(tx, id, auth);
      const links = await tx.studentGuardian.findMany({ where: { studentId: id } });
      let guardianId: string;
      let reused = false;
      if (input.guardianId) {
        const g = await tx.guardian.findUnique({ where: { id: input.guardianId } });
        if (!g) throw NotFound('Parent');
        if (links.some((l) => l.guardianId === g.id)) throw Conflict('already-linked', `${g.name} is already a parent of this student`);
        if ((input.isPrimary || !links.length) && !g.phone) throw Conflict('primary-needs-phone', 'The main contact needs a mobile number');
        guardianId = g.id;
        reused = true;
      } else {
        if (!links.length && !input.phone) throw Conflict('primary-needs-phone', 'The main contact needs a mobile number');
        if (input.phone) await this.phoneTaken(tx, input.phone);
        const g = await tx.guardian.create({ data: { tenantId: s.tenantId, name: input.name!, phone: input.phone ?? null, email: input.email ?? null, occupation: input.occupation ?? null, createdBy: auth.userId } });
        guardianId = g.id;
      }
      await tx.studentGuardian.create({ data: { tenantId: s.tenantId, studentId: id, guardianId, relation: input.relation, isPrimary: false } });
      if (input.isPrimary || !links.length) await this.setPrimary(tx, id, guardianId);
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT', entityId: id, newValues: { guardianAdded: guardianId, relation: input.relation, reused, isPrimary: !!input.isPrimary || !links.length } }, client);
      return { guardianId, reused };
    });
  }

  /** Edits the parent's details (shared with siblings) and/or this student's link (relation, main contact). */
  async updateGuardian(id: string, guardianId: string, input: UpdateGuardianInput & UpdateGuardianLinkInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockStudent(tx, id, auth);
      const link = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: id, guardianId } }, include: { guardian: true } });
      if (!link) throw NotFound('Parent');
      const { relation, isPrimary, ...details } = input;
      const before = link.guardian;
      const phone = details.phone !== undefined ? details.phone : before.phone;
      const willBePrimary = isPrimary ?? link.isPrimary;
      if (willBePrimary && !phone) throw Conflict('primary-needs-phone', 'The main contact needs a mobile number');
      if (details.phone && details.phone !== before.phone) await this.phoneTaken(tx, details.phone, guardianId);
      const g =Object.keys(details).length ? await tx.guardian.update({ where: { id: guardianId }, data: details }) : before;
      if (relation && relation !== link.relation) await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId: id, guardianId } }, data: { relation } });
      if (isPrimary && !link.isPrimary) await this.setPrimary(tx, id, guardianId);
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'GUARDIAN', entityId: guardianId, oldValues: { ...before, relation: link.relation, isPrimary: link.isPrimary }, newValues: { ...g, relation: relation ?? link.relation, isPrimary: willBePrimary, student: id } }, client);
      return g;
    });
  }

  /** Removes the link only; the parent record stays for any siblings. The main contact cannot be removed. */
  async removeGuardian(id: string, guardianId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.lockStudent(tx, id, auth);
      const link = await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: id, guardianId } } });
      if (!link) throw NotFound('Parent');
      if (link.isPrimary) throw Conflict('primary-contact', 'Make another parent the main contact first');
      await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId: id, guardianId } } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'STUDENT', entityId: id, oldValues: { guardian: guardianId, relation: link.relation }, newValues: { guardianRemoved: guardianId } }, client);
      return { removed: true };
    });
  }
}
