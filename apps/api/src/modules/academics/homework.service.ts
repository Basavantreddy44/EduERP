import { HttpStatus, Injectable } from '@nestjs/common';
import { DiaryInput, HomeworkInput, MarkSubmissionInput, PERMISSIONS, SubmissionInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { rosterOf } from '../attendance/attendance.service';
import { AcademicSubjectsService } from './subjects.service';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/**
 * Homework & class diary (M8.3). Teachers post homework and diary notes only for sections they teach
 * (or are class teacher of); academic set-up staff can for any section on their campuses. Students and
 * parents see homework of the student's own section, submit once (re-submitting replaces it until it
 * is marked); a diary note to one student is seen only by that student's parents, who acknowledge it.
 */
@Injectable()
export class HomeworkService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly subjects: AcademicSubjectsService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** May this user post to the section? Set-up staff on the campus, or a teacher of the section. */
  private async canTeach(tx: Tx, section: { id: string; campusId: string }, auth: AuthContext) {
    const setup = scopeFor(auth, PERMISSIONS.ACAD_SETUP);
    if (setup && canAccessCampus(setup, section.campusId)) return true;
    const teach = scopeFor(auth, PERMISSIONS.ACAD_TEACH);
    if (!teach || !canAccessCampus(teach, section.campusId)) return false;
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    return !!me && (await this.subjects.teachingSections(tx, me.id)).includes(section.id);
  }

  /** Parent users of a set of students (guardians with a login), for notifications. */
  private async parentUsers(tx: Tx, studentIds: string[]) {
    if (!studentIds.length) return [];
    const rows = await tx.studentGuardian.findMany({ where: { studentId: { in: studentIds }, guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } });
    const students = await tx.student.findMany({ where: { id: { in: studentIds }, userId: { not: null } }, select: { userId: true } });
    return [...new Set([...rows.map((r) => r.guardian.userId!), ...students.map((s) => s.userId!)])];
  }

  // ───────────── Homework (staff) ─────────────

  createHomework(input: HomeworkInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, input.sectionId, auth);
      if (!(await this.canTeach(tx, s, auth))) throw Forbidden('not-your-section', 'You do not teach this section');
      if (!(await tx.levelSubject.findFirst({ where: { programLevelId: s.programLevelId, subjectId: input.subjectId }, select: { id: true } }))) throw unprocessable('not-in-syllabus', 'This subject is not in the class’s syllabus', 'subjectId');
      if (input.dueDate < todayIST()) throw unprocessable('due-past', 'The due date is in the past', 'dueDate');
      if (input.fileIds.length && (await tx.fileObject.count({ where: { id: { in: input.fileIds } } })) !== input.fileIds.length) throw NotFound('File');
      const h = await tx.homework.create({ data: { tenantId: auth.tenantId!, sectionId: s.id, subjectId: input.subjectId, title: input.title, description: input.description ?? null, dueDate: day(input.dueDate), fileIds: input.fileIds, allowSubmission: input.allowSubmission, createdBy: auth.userId } });
      const roster = await rosterOf(tx, s.id, todayIST());
      const users = await this.parentUsers(tx, roster.map((r) => r.id));
      const subject = await tx.subject.findUniqueOrThrow({ where: { id: input.subjectId }, select: { name: true } });
      if (users.length) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'HOMEWORK', vars: { subject: subject.name, title: input.title, dueDate: input.dueDate, section: `${s.level.name} – ${s.name}` }, entityType: 'HOMEWORK', entityId: h.id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'HOMEWORK', entityId: h.id, newValues: input }, client);
      return { ...h, dueDate: iso(h.dueDate), notified: users.length };
    });
  }

  /** A section's homework (newest due first) with submission counts — for staff. */
  sectionHomework(sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const rows = await tx.homework.findMany({ where: { sectionId, status: 'ACTIVE' }, orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }], take: 100, include: { _count: { select: { submissions: true } } } });
      const subjects = new Map((await tx.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      const marked = await tx.homeworkSubmission.groupBy({ by: ['homeworkId'], where: { homeworkId: { in: rows.map((r) => r.id) }, status: 'MARKED' }, _count: true });
      const students = (await rosterOf(tx, s.id, todayIST())).length;
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}` }, students, canPost: await this.canTeach(tx, s, auth),
        items: rows.map(({ _count, ...h }) => ({ ...h, dueDate: iso(h.dueDate), subject: subjects.get(h.subjectId) ?? '', submitted: _count.submissions, marked: marked.find((m) => m.homeworkId === h.id)?._count ?? 0 })),
      };
    });
  }

  /** One homework with every student of the section and their submission. */
  submissions(homeworkId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await tx.homework.findUnique({ where: { id: homeworkId } });
      if (!h) throw NotFound('Homework');
      const s = await this.subjects.section(tx, h.sectionId, auth);
      const roster = await rosterOf(tx, s.id, todayIST());
      const subs = new Map((await tx.homeworkSubmission.findMany({ where: { homeworkId } })).map((x) => [x.studentId, x]));
      return {
        homework: { ...h, dueDate: iso(h.dueDate) }, canMark: await this.canTeach(tx, s, auth),
        students: roster.map((r) => {
          const x = subs.get(r.id);
          return { studentId: r.id, name: `${r.firstName} ${r.lastName ?? ''}`.trim(), admissionNo: r.admissionNo, rollNo: r.rollNo, submission: x ? { id: x.id, text: x.text, fileId: x.fileId, submittedAt: x.submittedAt, late: iso(x.submittedAt)! > iso(h.dueDate)!, grade: x.grade, feedback: x.feedback, status: x.status } : null };
        }),
      };
    });
  }

  mark(submissionId: string, input: MarkSubmissionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.homeworkSubmission.findUnique({ where: { id: submissionId }, include: { homework: true } });
      if (!x) throw NotFound('Submission');
      const s = await this.subjects.section(tx, x.homework.sectionId, auth);
      if (!(await this.canTeach(tx, s, auth))) throw Forbidden('not-your-section', 'You do not teach this section');
      const after = await tx.homeworkSubmission.update({ where: { id: submissionId }, data: { grade: input.grade, feedback: input.feedback ?? null, markedBy: auth.userId, markedAt: new Date(), status: 'MARKED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'HOMEWORK_SUBMISSION', entityId: submissionId, newValues: input }, client);
      return after;
    });
  }

  // ───────────── Homework (student / parent app) ─────────────

  /** The student's section homework (last 30 days and upcoming), with their own submission. */
  async forStudentTx(tx: Tx, studentId: string) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true } }));
    if (!e) return { items: [] };
    const since = new Date(Date.parse(`${todayIST()}T00:00:00Z`) - 30 * 86_400_000);
    const rows = await tx.homework.findMany({ where: { sectionId: e.sectionId, status: 'ACTIVE', dueDate: { gte: since } }, orderBy: [{ dueDate: 'asc' }] });
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    const subs = new Map((await tx.homeworkSubmission.findMany({ where: { studentId, homeworkId: { in: rows.map((r) => r.id) } } })).map((x) => [x.homeworkId, x]));
    return {
      items: rows.map((h) => {
        const x = subs.get(h.id);
        return { id: h.id, subject: subjects.get(h.subjectId) ?? '', title: h.title, description: h.description, dueDate: iso(h.dueDate), fileIds: h.fileIds, allowSubmission: h.allowSubmission, submission: x ? { text: x.text, fileId: x.fileId, submittedAt: x.submittedAt, grade: x.grade, feedback: x.feedback, status: x.status } : null };
      }),
    };
  }

  /** A parent or the student submits (or replaces, until marked) the student's work. */
  submit(studentId: string, homeworkId: string, input: SubmissionInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await tx.homework.findUnique({ where: { id: homeworkId } });
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true } }));
      if (!h || !e || e.sectionId !== h.sectionId || h.status !== 'ACTIVE') throw NotFound('Homework');
      if (!h.allowSubmission) throw Conflict('no-submission', 'This homework is not submitted in the app');
      if (input.fileId && !(await tx.fileObject.findUnique({ where: { id: input.fileId }, select: { id: true } }))) throw NotFound('File');
      const ex = await tx.homeworkSubmission.findUnique({ where: { tenantId_homeworkId_studentId: { tenantId: auth.tenantId!, homeworkId, studentId } } });
      if (ex?.status === 'MARKED') throw Conflict('already-marked', 'The teacher has already marked this work');
      const data = { text: input.text ?? null, fileId: input.fileId ?? null, submittedBy: auth.userId, submittedAt: new Date() };
      const x = ex ? await tx.homeworkSubmission.update({ where: { id: ex.id }, data }) : await tx.homeworkSubmission.create({ data: { ...data, tenantId: auth.tenantId!, homeworkId, studentId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: ex ? 'UPDATE' : 'CREATE', entityType: 'HOMEWORK_SUBMISSION', entityId: x.id, newValues: { homeworkId, studentId, hasFile: !!input.fileId } });
      return x;
    });
  }

  // ───────────── Class diary ─────────────

  createDiary(input: DiaryInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, input.sectionId, auth);
      if (!(await this.canTeach(tx, s, auth))) throw Forbidden('not-your-section', 'You do not teach this section');
      const roster = await rosterOf(tx, s.id, input.noteDate <= todayIST() ? input.noteDate : todayIST());
      if (input.studentId && !roster.some((r) => r.id === input.studentId)) throw unprocessable('not-in-section', 'The student is not in this section', 'studentId');
      const n = await tx.diaryNote.create({ data: { tenantId: auth.tenantId!, sectionId: s.id, studentId: input.studentId ?? null, noteDate: day(input.noteDate), note: input.note, needsAck: input.needsAck, createdBy: auth.userId } });
      const users = await this.parentUsers(tx, input.studentId ? [input.studentId] : roster.map((r) => r.id));
      if (users.length) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'DIARY_NOTE', vars: { section: `${s.level.name} – ${s.name}`, note: input.note.slice(0, 160) }, entityType: 'DIARY_NOTE', entityId: n.id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'DIARY_NOTE', entityId: n.id, newValues: input }, client);
      return { ...n, noteDate: iso(n.noteDate), notified: users.length };
    });
  }

  /** A section's diary (newest first) with how many parents have acknowledged. */
  sectionDiary(sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const rows = await tx.diaryNote.findMany({ where: { sectionId }, orderBy: [{ noteDate: 'desc' }, { createdAt: 'desc' }], take: 100, include: { _count: { select: { acks: true } } } });
      const names = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((x) => [x.id, `${x.firstName} ${x.lastName ?? ''}`.trim()]));
      const roster = await rosterOf(tx, s.id, todayIST());
      const students = roster.length;
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}` }, students, canPost: await this.canTeach(tx, s, auth),
        roster: roster.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName ?? ""}`.trim(), rollNo: r.rollNo })),
        items: rows.map(({ _count, ...n }) => ({ ...n, noteDate: iso(n.noteDate), student: n.studentId ? names.get(n.studentId) ?? null : null, acks: _count.acks, expected: n.studentId ? 1 : students })),
      };
    });
  }

  /** Diary notes a student's parents see: the whole class's and the student's own. */
  async diaryForStudentTx(tx: Tx, studentId: string) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true } }));
    if (!e) return { items: [] };
    const rows = await tx.diaryNote.findMany({ where: { sectionId: e.sectionId, OR: [{ studentId: null }, { studentId }] }, orderBy: [{ noteDate: 'desc' }, { createdAt: 'desc' }], take: 30 });
    const acks = new Set((await tx.diaryAck.findMany({ where: { studentId, diaryNoteId: { in: rows.map((r) => r.id) } }, select: { diaryNoteId: true } })).map((a) => a.diaryNoteId));
    return { items: rows.map((n) => ({ id: n.id, noteDate: iso(n.noteDate), note: n.note, forChild: !!n.studentId, needsAck: n.needsAck, acknowledged: acks.has(n.id) })) };
  }

  /** The parent acknowledges a note (once per student). */
  acknowledge(studentId: string, noteId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const n = await tx.diaryNote.findUnique({ where: { id: noteId } });
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true } }));
      if (!n || !e || n.sectionId !== e.sectionId || (n.studentId && n.studentId !== studentId)) throw NotFound('Note');
      const ex = await tx.diaryAck.findUnique({ where: { tenantId_diaryNoteId_studentId: { tenantId: auth.tenantId!, diaryNoteId: noteId, studentId } } });
      if (ex) return { acknowledged: true, at: ex.ackAt };
      const a = await tx.diaryAck.create({ data: { tenantId: auth.tenantId!, diaryNoteId: noteId, studentId, ackBy: auth.userId } });
      return { acknowledged: true, at: a.ackAt };
    });
  }
}
