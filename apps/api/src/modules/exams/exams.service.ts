import { HttpStatus, Injectable } from '@nestjs/common';
import { ExamInput, ExamScheduleInput, MarksInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { rosterOf } from '../attendance/attendance.service';
import { examScope } from './exam-setup.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const unprocessable = (code: string, detail: string, field: string, errors?: { field: string; message: string }[]) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, errors ?? [{ field, message: detail }]);
const can = (auth: AuthContext, code: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], campusId: string) => { const s = scopeFor(auth, code); return !!s && canAccessCampus(s, campusId); };

/**
 * Exams & marks (M9.2). An exam fills one component of a scheme for a campus and year; its timetable
 * lists, per class, the subjects with date, time and marks. Marks are kept per subject and section on
 * a mark sheet: the subject's teacher (or set-up staff) enters them, submits, and someone else
 * verifies — then they are locked; set-up staff can still correct them, with a reason.
 */
@Injectable()
export class ExamsService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Exams ─────────────

  list(auth: AuthContext, campusId?: string) {
    const s = examScope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) return [];
      const rows = await tx.exam.findMany({
        where: { academicYearId: year.id, ...(campusId ? { campusId } : s.all ? {} : { campusId: { in: s.campusIds } }) },
        orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
        include: { scheme: { select: { name: true } }, component: { select: { code: true, name: true, termCode: true, maxMarks: true } }, subjects: { where: { status: 'ACTIVE' }, select: { id: true, sheets: { select: { status: true } } } } },
      });
      return rows.filter((e) => canAccessCampus(s, e.campusId)).map(({ subjects, ...e }) => ({
        ...e, startDate: iso(e.startDate), endDate: iso(e.endDate), component: { ...e.component, maxMarks: Number(e.component.maxMarks) },
        papers: subjects.length, sheets: subjects.reduce((a, x) => a + x.sheets.length, 0), verified: subjects.reduce((a, x) => a + x.sheets.filter((y) => y.status === 'VERIFIED').length, 0),
      }));
    });
  }

  create(input: ExamInput, auth: AuthContext, client: ClientInfo) {
    if (!can(auth, PERMISSIONS.EXAM_SETUP, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true } });
      if (!year) throw unprocessable('no-current-year', 'Set the current academic year first', 'campusId');
      if (input.startDate < iso(year.startDate)! || input.endDate > iso(year.endDate)!) throw unprocessable('outside-year', `Exam dates must fall in ${year.name}`, 'startDate');
      const comp = await tx.assessmentComponent.findUnique({ where: { id: input.componentId } });
      if (!comp || comp.schemeId !== input.schemeId || comp.status !== 'ACTIVE') throw NotFound('Component');
      if (await tx.exam.findUnique({ where: { tenantId_campusId_academicYearId_componentId: { tenantId: auth.tenantId!, campusId: input.campusId, academicYearId: year.id, componentId: input.componentId } }, select: { id: true } })) throw Conflict('exam-exists', `${comp.name} already has an exam this year on this campus`);
      const e = await tx.exam.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, academicYearId: year.id, schemeId: input.schemeId, componentId: input.componentId, name: input.name, startDate: day(input.startDate), endDate: day(input.endDate), createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'EXAM', entityId: e.id, newValues: input }, client);
      return { ...e, startDate: input.startDate, endDate: input.endDate };
    });
  }

  private async examTx(tx: Tx, id: string, auth: AuthContext, code: (typeof PERMISSIONS)[keyof typeof PERMISSIONS] = PERMISSIONS.EXAM_READ) {
    const e = await tx.exam.findUnique({ where: { id }, include: { scheme: { select: { id: true, name: true } }, component: true } });
    if (!e || !canAccessCampus(code === PERMISSIONS.EXAM_READ ? examScope(auth) : scopeFor(auth, code) ?? { all: false, campusIds: [] }, e.campusId)) throw NotFound('Exam');
    return e;
  }

  /** The exam with its timetable per class (classes using the scheme) and each sheet's state. */
  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.examTx(tx, id, auth);
      const levelIds = (await tx.schemeLevel.findMany({ where: { schemeId: e.schemeId } })).map((l) => l.programLevelId);
      const levels = await tx.programLevel.findMany({ where: { id: { in: levelIds }, program: { campusId: e.campusId } }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, program: { select: { name: true } } } });
      const syllabus = await tx.levelSubject.findMany({ where: { programLevelId: { in: levels.map((l) => l.id) } }, orderBy: { sortOrder: 'asc' }, include: { subject: { select: { id: true, code: true, name: true } } } });
      const papers = await tx.examSubject.findMany({ where: { examId: id, status: 'ACTIVE' }, include: { sheets: true } });
      const sections = await tx.section.findMany({ where: { academicYearId: e.academicYearId, programLevelId: { in: levels.map((l) => l.id) }, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, programLevelId: true } });
      return {
        exam: { ...e, startDate: iso(e.startDate), endDate: iso(e.endDate), component: { ...e.component, maxMarks: Number(e.component.maxMarks), weightage: Number(e.component.weightage) } },
        canSetup: can(auth, PERMISSIONS.EXAM_SETUP, e.campusId),
        classes: levels.map((l) => ({
          id: l.id, name: l.name, program: l.program.name,
          sections: sections.filter((s) => s.programLevelId === l.id).map((s) => ({ id: s.id, name: s.name })),
          subjects: syllabus.filter((x) => x.programLevelId === l.id).map((x) => x.subject),
          papers: papers.filter((p) => p.programLevelId === l.id).map((p) => ({
            id: p.id, subjectId: p.subjectId, examDate: iso(p.examDate), startTime: p.startTime, endTime: p.endTime, maxMarks: Number(p.maxMarks), passMarks: p.passMarks === null ? null : Number(p.passMarks),
            sheets: p.sheets.map((sh) => ({ sectionId: sh.sectionId, status: sh.status })),
          })),
        })),
      };
    });
  }

  /** Saves one class's exam timetable. A paper with marks cannot be removed. */
  saveSchedule(id: string, input: ExamScheduleInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.examTx(tx, id, auth, PERMISSIONS.EXAM_SETUP);
      if (!(await tx.schemeLevel.findFirst({ where: { schemeId: e.schemeId, programLevelId: input.programLevelId } }))) throw unprocessable('class-not-in-scheme', 'This class does not use the exam’s scheme', 'programLevelId');
      const syllabus = new Set((await tx.levelSubject.findMany({ where: { programLevelId: input.programLevelId }, select: { subjectId: true } })).map((x) => x.subjectId));
      for (const s of input.subjects) {
        if (!syllabus.has(s.subjectId)) throw unprocessable('not-in-syllabus', 'A subject is not in this class’s syllabus', 'subjects');
        if (s.examDate < iso(e.startDate)! || s.examDate > iso(e.endDate)!) throw unprocessable('date-outside-exam', `Paper dates must be between ${iso(e.startDate)} and ${iso(e.endDate)}`, 'subjects');
      }
      const before = await tx.examSubject.findMany({ where: { examId: id, programLevelId: input.programLevelId }, include: { sheets: { select: { _count: { select: { marks: true } } } } } });
      for (const b of before.filter((x) => x.status === 'ACTIVE' && !input.subjects.some((s) => s.subjectId === x.subjectId))) {
        if (b.sheets.some((sh) => sh._count.marks > 0)) throw Conflict('paper-has-marks', 'A removed paper already has marks — it cannot be removed');
        await tx.examSubject.update({ where: { id: b.id }, data: { status: 'REMOVED' } });
      }
      for (const s of input.subjects) {
        const ex = before.find((b) => b.subjectId === s.subjectId);
        const data = { examDate: day(s.examDate), startTime: s.startTime ?? null, endTime: s.endTime ?? null, maxMarks: s.maxMarks, passMarks: s.passMarks ?? null, status: 'ACTIVE' };
        if (ex) {
          const marked = ex.sheets.some((sh) => sh._count.marks > 0);
          if (marked && Number(ex.maxMarks) !== s.maxMarks) {
            const top = await tx.examMark.aggregate({ where: { sheet: { examSubjectId: ex.id } }, _max: { marks: true } });
            if (top._max.marks !== null && Number(top._max.marks) > s.maxMarks) throw Conflict('marks-above-max', 'Some marks entered are above the new maximum');
          }
          await tx.examSubject.update({ where: { id: ex.id }, data });
        } else await tx.examSubject.create({ data: { ...data, tenantId: auth.tenantId!, examId: id, programLevelId: input.programLevelId, subjectId: s.subjectId } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'EXAM_SCHEDULE', entityId: id, newValues: input }, client);
      return { saved: input.subjects.length };
    });
  }

  // ───────────── Mark sheets ─────────────

  private async myEmployee(tx: Tx, auth: AuthContext) {
    return tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
  }

  private async teaches(tx: Tx, auth: AuthContext, sectionId: string, subjectId: string) {
    const me = await this.myEmployee(tx, auth);
    return !!me && !!(await tx.sectionSubjectTeacher.findFirst({ where: { sectionId, subjectId, employeeId: me.id }, select: { id: true } }));
  }

  /** Students on a sheet: the section's students on the paper's date; an optional subject only for those who chose it. */
  private async sheetRoster(tx: Tx, paper: { programLevelId: string; subjectId: string; examDate: Date }, sectionId: string) {
    const roster = await rosterOf(tx, sectionId, iso(paper.examDate)! <= todayIST() ? iso(paper.examDate)! : todayIST());
    const ls = await tx.levelSubject.findFirst({ where: { programLevelId: paper.programLevelId, subjectId: paper.subjectId } });
    if (!ls?.isOptional) return roster;
    const chose = new Set((await tx.$queryRaw<{ id: string }[]>`
      SELECT e.student_id AS id FROM student_subjects ss JOIN student_enrollments e ON e.id = ss.enrollment_id
       WHERE e.section_id = ${sectionId}::uuid AND ss.subject_id = ${paper.subjectId}::uuid`).map((r) => r.id));
    return roster.filter((r) => chose.has(r.id));
  }

  private async sheetTx(tx: Tx, paperId: string, sectionId: string, auth: AuthContext) {
    const paper = await tx.examSubject.findUnique({ where: { id: paperId }, include: { exam: true } });
    if (!paper || paper.status !== 'ACTIVE' || !canAccessCampus(examScope(auth), paper.exam.campusId)) throw NotFound('Paper');
    const section = await tx.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, programLevelId: true, academicYearId: true, level: { select: { name: true } } } });
    if (!section || section.programLevelId !== paper.programLevelId || section.academicYearId !== paper.exam.academicYearId) throw NotFound('Section');
    let sheet = await tx.examMarkSheet.findUnique({ where: { tenantId_examSubjectId_sectionId: { tenantId: auth.tenantId!, examSubjectId: paperId, sectionId } } });
    if (!sheet) sheet = await tx.examMarkSheet.upsert({ where: { tenantId_examSubjectId_sectionId: { tenantId: auth.tenantId!, examSubjectId: paperId, sectionId } }, update: {}, create: { tenantId: auth.tenantId!, examSubjectId: paperId, sectionId } });
    return { paper, section, sheet };
  }

  /** A mark sheet with its students and marks, and what the user may do with it. */
  sheet(paperId: string, sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { paper, section, sheet } = await this.sheetTx(tx, paperId, sectionId, auth);
      const roster = await this.sheetRoster(tx, paper, sectionId);
      const marks = new Map((await tx.examMark.findMany({ where: { sheetId: sheet.id } })).map((m) => [m.studentId, m]));
      const subject = await tx.subject.findUniqueOrThrow({ where: { id: paper.subjectId }, select: { name: true, code: true } });
      const campus = paper.exam.campusId;
      const setup = can(auth, PERMISSIONS.EXAM_SETUP, campus);
      const teacher = can(auth, PERMISSIONS.EXAM_MARKS, campus) && (await this.teaches(tx, auth, sectionId, paper.subjectId));
      const entrants = new Set([...marks.values()].map((m) => m.enteredBy));
      const names = new Map((await tx.user.findMany({ where: { id: { in: [...entrants, sheet.submittedBy, sheet.verifiedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return {
        exam: { id: paper.exam.id, name: paper.exam.name }, subject, section: { id: section.id, name: `${section.level.name} – ${section.name}` },
        paper: { id: paper.id, examDate: iso(paper.examDate), maxMarks: Number(paper.maxMarks), passMarks: paper.passMarks === null ? null : Number(paper.passMarks) },
        sheet: { id: sheet.id, status: sheet.status, submittedBy: sheet.submittedBy ? names.get(sheet.submittedBy) ?? null : null, submittedAt: sheet.submittedAt, verifiedBy: sheet.verifiedBy ? names.get(sheet.verifiedBy) ?? null : null, verifiedAt: sheet.verifiedAt },
        canEnter: sheet.status !== 'VERIFIED' && (setup || teacher),
        canCorrect: sheet.status === 'VERIFIED' && setup,
        canVerify: sheet.status === 'SUBMITTED' && can(auth, PERMISSIONS.EXAM_VERIFY, campus) && !entrants.has(auth.userId) && sheet.submittedBy !== auth.userId,
        students: roster.map((r) => {
          const m = marks.get(r.id);
          return { studentId: r.id, name: `${r.firstName} ${r.lastName ?? ''}`.trim(), admissionNo: r.admissionNo, rollNo: r.rollNo, attendanceCode: m?.attendanceCode ?? null, marks: m?.marks == null ? null : Number(m.marks) };
        }),
      };
    });
  }

  saveMarks(paperId: string, sectionId: string, input: MarksInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { paper, sheet } = await this.sheetTx(tx, paperId, sectionId, auth);
      const campus = paper.exam.campusId;
      const setup = can(auth, PERMISSIONS.EXAM_SETUP, campus);
      if (sheet.status === 'VERIFIED') {
        if (!setup) throw Forbidden('sheet-locked', 'These marks are verified and locked');
        if (!input.reason) throw unprocessable('reason-required', 'Give the reason for changing verified marks', 'reason');
      } else if (!setup && !(can(auth, PERMISSIONS.EXAM_MARKS, campus) && (await this.teaches(tx, auth, sectionId, paper.subjectId)))) {
        throw Forbidden('not-your-subject', 'You do not teach this subject in this section');
      }
      const roster = new Set((await this.sheetRoster(tx, paper, sectionId)).map((r) => r.id));
      const max = Number(paper.maxMarks);
      const bad: { field: string; message: string }[] = [];
      input.marks.forEach((m, i) => {
        if (!roster.has(m.studentId)) bad.push({ field: `marks.${i}.studentId`, message: 'Not a student of this sheet' });
        else if (m.attendanceCode === 'PRESENT' && (m.marks ?? 0) > max) bad.push({ field: `marks.${i}.marks`, message: `Above the maximum (${max})` });
      });
      if (bad.length) throw unprocessable('marks-invalid', bad.length === 1 ? bad[0].message : `${bad.length} entries need fixing`, 'marks', bad);
      const before = new Map((await tx.examMark.findMany({ where: { sheetId: sheet.id } })).map((m) => [m.studentId, m]));
      let changed = 0;
      for (const m of input.marks) {
        const marks = m.attendanceCode === 'PRESENT' ? m.marks! : null;
        const ex = before.get(m.studentId);
        if (ex && ex.attendanceCode === m.attendanceCode && (ex.marks === null ? null : Number(ex.marks)) === marks) continue;
        changed++;
        if (ex) await tx.examMark.update({ where: { id: ex.id }, data: { marks, attendanceCode: m.attendanceCode, enteredBy: auth.userId } });
        else await tx.examMark.create({ data: { tenantId: auth.tenantId!, sheetId: sheet.id, studentId: m.studentId, marks, attendanceCode: m.attendanceCode, enteredBy: auth.userId } });
      }
      // Editing a submitted sheet sends it back for submitting again; verified sheets stay verified (correction).
      if (changed && sheet.status === 'SUBMITTED') await tx.examMarkSheet.update({ where: { id: sheet.id }, data: { status: 'PENDING', submittedBy: null, submittedAt: null } });
      if (changed) {
        await this.audit.log(tx, {
          tenantId: auth.tenantId!, userId: auth.userId, campusId: campus, action: 'UPDATE', entityType: 'EXAM_MARK_SHEET', entityId: sheet.id,
          oldValues: Object.fromEntries([...before.values()].map((b) => [b.studentId, [b.attendanceCode, b.marks === null ? null : Number(b.marks)]])), newValues: { marks: input.marks, correction: sheet.status === 'VERIFIED', reason: input.reason ?? null },
        }, client);
      }
      return { saved: changed, status: changed && sheet.status === 'SUBMITTED' ? 'PENDING' : sheet.status };
    });
  }

  /** Submit for verification: every student needs marks or an attendance code. */
  submit(paperId: string, sectionId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { paper, sheet } = await this.sheetTx(tx, paperId, sectionId, auth);
      const setup = can(auth, PERMISSIONS.EXAM_SETUP, paper.exam.campusId);
      if (!setup && !(can(auth, PERMISSIONS.EXAM_MARKS, paper.exam.campusId) && (await this.teaches(tx, auth, sectionId, paper.subjectId)))) throw Forbidden('not-your-subject', 'You do not teach this subject in this section');
      if (sheet.status !== 'PENDING') throw Conflict('sheet-not-pending', sheet.status === 'SUBMITTED' ? 'Already submitted' : 'Already verified');
      const roster = await this.sheetRoster(tx, paper, sectionId);
      const done = new Set((await tx.examMark.findMany({ where: { sheetId: sheet.id }, select: { studentId: true } })).map((m) => m.studentId));
      const missing = roster.filter((r) => !done.has(r.id));
      if (!roster.length) throw unprocessable('no-students', 'No students on this sheet', 'marks');
      if (missing.length) throw unprocessable('marks-missing', `${missing.length} student(s) have no marks yet`, 'marks', missing.slice(0, 20).map((r) => ({ field: 'marks', message: `${r.firstName} ${r.lastName ?? ''}`.trim() })));
      await tx.examMarkSheet.update({ where: { id: sheet.id }, data: { status: 'SUBMITTED', submittedBy: auth.userId, submittedAt: new Date() } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: paper.exam.campusId, action: 'STATUS_CHANGE', entityType: 'EXAM_MARK_SHEET', entityId: sheet.id, oldValues: { status: 'PENDING' }, newValues: { status: 'SUBMITTED' } }, client);
      return { status: 'SUBMITTED' };
    });
  }

  /** Verify (lock) or send back a submitted sheet — never by someone who entered its marks. */
  verify(paperId: string, sectionId: string, accept: boolean, note: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { paper, sheet } = await this.sheetTx(tx, paperId, sectionId, auth);
      if (!can(auth, PERMISSIONS.EXAM_VERIFY, paper.exam.campusId)) throw Forbidden('cannot-verify', 'You cannot verify marks');
      if (sheet.status !== 'SUBMITTED') throw Conflict('sheet-not-submitted', 'Only submitted marks can be verified');
      const entrants = new Set((await tx.examMark.findMany({ where: { sheetId: sheet.id }, select: { enteredBy: true } })).map((m) => m.enteredBy));
      if (entrants.has(auth.userId) || sheet.submittedBy === auth.userId) throw Forbidden('own-marks', 'Someone other than the person who entered the marks must verify them');
      const status = accept ? 'VERIFIED' : 'PENDING';
      await tx.examMarkSheet.update({ where: { id: sheet.id }, data: accept ? { status, verifiedBy: auth.userId, verifiedAt: new Date() } : { status, submittedBy: null, submittedAt: null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: paper.exam.campusId, action: 'STATUS_CHANGE', entityType: 'EXAM_MARK_SHEET', entityId: sheet.id, oldValues: { status: 'SUBMITTED' }, newValues: { status, note } }, client);
      return { status };
    });
  }

  /** Papers this user can enter marks for (their subjects and sections), or every paper for set-up staff. */
  mySheets(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) return [];
      const me = await this.myEmployee(tx, auth);
      const mine = me ? await tx.sectionSubjectTeacher.findMany({ where: { employeeId: me.id }, select: { sectionId: true, subjectId: true } }) : [];
      const papers = await tx.examSubject.findMany({ where: { status: 'ACTIVE', exam: { academicYearId: year.id } }, orderBy: { examDate: 'asc' }, include: { exam: { select: { id: true, name: true, campusId: true } }, sheets: true } });
      const sections = await tx.section.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, select: { id: true, name: true, programLevelId: true, level: { select: { name: true } } } });
      const subjects = new Map((await tx.subject.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      const out = [];
      for (const p of papers) {
        const setup = can(auth, PERMISSIONS.EXAM_SETUP, p.exam.campusId);
        const verify = can(auth, PERMISSIONS.EXAM_VERIFY, p.exam.campusId);
        for (const s of sections.filter((x) => x.programLevelId === p.programLevelId)) {
          const teach = can(auth, PERMISSIONS.EXAM_MARKS, p.exam.campusId) && mine.some((m) => m.sectionId === s.id && m.subjectId === p.subjectId);
          const sh = p.sheets.find((x) => x.sectionId === s.id);
          if (!teach && !setup && !(verify && sh?.status === 'SUBMITTED')) continue;
          out.push({ paperId: p.id, exam: p.exam.name, examId: p.exam.id, subject: subjects.get(p.subjectId) ?? '', sectionId: s.id, section: `${s.level.name} – ${s.name}`, examDate: iso(p.examDate), maxMarks: Number(p.maxMarks), status: sh?.status ?? 'PENDING', mine: teach });
        }
      }
      return out;
    });
  }
}
