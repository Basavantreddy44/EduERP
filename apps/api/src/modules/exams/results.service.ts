import { HttpStatus, Injectable } from '@nestjs/common';
import { ATTENDED_VALUE, AttendanceStatus, CalculateInput, CoGradesInput, FINAL_TERM, PERMISSIONS, ResultRemarksInput, gradeFor, ranks, roundBy } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { rosterOf } from '../attendance/attendance.service';
import { ExamSetupService, examScope } from './exam-setup.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const unprocessable = (code: string, detail: string, field: string, errors?: { field: string; message: string }[]) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, errors ?? [{ field, message: detail }]);
const can = (auth: AuthContext, code: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], campusId: string) => { const s = scopeFor(auth, code); return !!s && canAccessCampus(s, campusId); };

type Scheme = Awaited<ReturnType<ExamSetupService['schemeTx']>>;
type CompMark = { marks: number | null; max: number; code: string };
type Line = { subjectId: string; components: Record<string, CompMark | number>; percent: number; sortOrder: number };

/**
 * Results & report cards (M9.3). Results are calculated from verified marks exactly by the scheme:
 * a subject's term percentage is the weighted sum of its components (a component not held for that
 * subject, or one the student is exempt from, is left out and the other weights are rescaled; absent
 * counts as zero); the final result weights the terms. Each calculation is a version; parents see a
 * section's results only once a version is published by someone who did not enter its marks.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly setup: ExamSetupService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private async sectionTx(tx: Tx, sectionId: string, auth: AuthContext) {
    const s = await tx.section.findUnique({ where: { id: sectionId }, select: { id: true, name: true, campusId: true, academicYearId: true, programLevelId: true, classTeacherId: true, level: { select: { name: true, program: { select: { name: true } } } }, academicYear: { select: { name: true, startDate: true, endDate: true } } } });
    if (!s || !canAccessCampus(examScope(auth), s.campusId)) throw NotFound('Section');
    return s;
  }

  private termName(scheme: Scheme, code: string) {
    return code === FINAL_TERM ? 'Final' : scheme.terms.find((t) => t.code === code)?.name ?? code;
  }

  /** Verified marks of a section for the components of one term → per-student subject lines. */
  private async termLines(tx: Tx, scheme: Scheme, section: { id: string; campusId: string; academicYearId: string; programLevelId: string }, termCode: string) {
    const comps = scheme.components.filter((c) => c.termCode === termCode);
    const exams = await tx.exam.findMany({ where: { campusId: section.campusId, academicYearId: section.academicYearId, componentId: { in: comps.map((c) => c.id) } }, select: { id: true, name: true, componentId: true } });
    const papers = await tx.examSubject.findMany({ where: { examId: { in: exams.map((e) => e.id) }, programLevelId: section.programLevelId, status: 'ACTIVE' }, include: { sheets: { where: { sectionId: section.id }, include: { marks: true } } } });
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: papers.map((p) => p.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    // An optional subject that no student of the section chose has nobody to mark.
    const optional = new Set((await tx.levelSubject.findMany({ where: { programLevelId: section.programLevelId, isOptional: true }, select: { subjectId: true } })).map((x) => x.subjectId));
    const taken = new Set((await tx.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ss.subject_id AS id FROM student_subjects ss JOIN student_enrollments e ON e.id = ss.enrollment_id WHERE e.section_id = ${section.id}::uuid`).map((r) => r.id));
    const pending = papers.filter((p) => !(optional.has(p.subjectId) && !taken.has(p.subjectId)) && p.sheets[0]?.status !== 'VERIFIED').map((p) => `${subjects.get(p.subjectId)} — ${exams.find((e) => e.id === p.examId)?.name}: ${p.sheets[0]?.status === 'SUBMITTED' ? 'waiting for verification' : 'marks not complete'}`);
    const byStudent = new Map<string, Map<string, { num: number; den: number; components: Record<string, CompMark> }>>();
    for (const p of papers) {
      const comp = comps.find((c) => c.id === exams.find((e) => e.id === p.examId)!.componentId)!;
      const weight = Number(comp.weightage);
      for (const m of p.sheets[0]?.marks ?? []) {
        const s = byStudent.get(m.studentId) ?? new Map();
        byStudent.set(m.studentId, s);
        const line = s.get(p.subjectId) ?? { num: 0, den: 0, components: {} };
        s.set(p.subjectId, line);
        const max = Number(p.maxMarks);
        const marks = m.marks === null ? null : Number(m.marks);
        line.components[comp.code] = { marks, max, code: m.attendanceCode };
        if (m.attendanceCode === 'EXEMPT') continue;
        line.num += ((marks ?? 0) / max) * weight;
        line.den += weight;
      }
    }
    return { pending, papers: papers.length, byStudent };
  }

  /** Calculates (or recalculates) the section's results for a term or FINAL as a draft version. */
  calculate(input: CalculateInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const section = await this.sectionTx(tx, input.sectionId, auth);
      if (!can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId)) throw Forbidden('cannot-publish', 'You cannot prepare results');
      const scheme = await this.setup.schemeForLevelTx(tx, section.programLevelId);
      if (!scheme) throw unprocessable('no-scheme', 'This class has no assessment scheme — set one under Exams → Schemes', 'sectionId');
      const isFinal = input.termCode === FINAL_TERM;
      if (isFinal ? scheme.terms.length < 2 : !scheme.terms.some((t) => t.code === input.termCode)) throw unprocessable('term-invalid', isFinal ? 'This scheme has one term — calculate that term' : 'Unknown term', 'termCode');
      const rule = scheme.roundingRule as 'NONE' | 'ROUND' | 'CEIL';
      const terms = isFinal ? scheme.terms : scheme.terms.filter((t) => t.code === input.termCode);
      const perTerm = new Map<string, Awaited<ReturnType<ResultsService['termLines']>>>();
      for (const t of terms) perTerm.set(t.code, await this.termLines(tx, scheme, section, t.code));
      const pending = [...perTerm.values()].flatMap((x) => x.pending);
      if ([...perTerm.values()].every((x) => !x.papers)) throw unprocessable('no-marks', 'No exam papers for this class in that term yet', 'termCode');
      if (pending.length) throw unprocessable('marks-not-verified', `${pending.length} mark sheet(s) are not verified yet`, 'termCode', pending.slice(0, 30).map((m) => ({ field: 'termCode', message: m })));

      const year = section.academicYear;
      const asOf = todayIST() < iso(year.endDate)! ? todayIST() : iso(year.endDate)!;
      const roster = await rosterOf(tx, section.id, asOf);
      const syllabus = await tx.levelSubject.findMany({ where: { programLevelId: section.programLevelId }, orderBy: { sortOrder: 'asc' } });
      const chosen = new Set((await tx.$queryRaw<{ k: string }[]>`
        SELECT e.student_id::text || ':' || ss.subject_id::text AS k FROM student_subjects ss JOIN student_enrollments e ON e.id = ss.enrollment_id WHERE e.section_id = ${section.id}::uuid`).map((r) => r.k));

      const linesOf = (studentId: string): Line[] => {
        const out: Line[] = [];
        syllabus.forEach((ls, i) => {
          if (ls.isOptional && !chosen.has(`${studentId}:${ls.subjectId}`)) return;
          if (!isFinal) {
            const l = perTerm.get(terms[0].code)!.byStudent.get(studentId)?.get(ls.subjectId);
            if (!l || !l.den) return;
            out.push({ subjectId: ls.subjectId, components: l.components, percent: roundBy(rule, (l.num / l.den) * 100), sortOrder: i });
            return;
          }
          let num = 0; let den = 0; const comps: Record<string, number> = {};
          for (const t of terms) {
            const l = perTerm.get(t.code)!.byStudent.get(studentId)?.get(ls.subjectId);
            if (!l || !l.den) continue;
            const p = roundBy(rule, (l.num / l.den) * 100);
            comps[t.code] = p; num += p * Number(t.finalWeight); den += Number(t.finalWeight);
          }
          if (den) out.push({ subjectId: ls.subjectId, components: comps, percent: roundBy(rule, num / den), sortOrder: i });
        });
        return out;
      };

      // Attendance % for the year so far.
      const att = await tx.attendanceRecord.findMany({ where: { studentId: { in: roster.map((r) => r.id) }, attendanceDate: { gte: year.startDate, lte: new Date(`${asOf}T00:00:00Z`) } }, select: { studentId: true, status: true } });
      const attOf = (id: string) => { const rs = att.filter((a) => a.studentId === id); return rs.length ? r2((rs.reduce((a, x) => a + ATTENDED_VALUE[x.status as AttendanceStatus], 0) / rs.length) * 100) : null; };

      const subjectPass = Number(scheme.subjectPassPercent);
      const results = roster.map((st) => {
        const lines = linesOf(st.id).map((l) => {
          const g = gradeFor(scheme.items, l.percent);
          return { ...l, grade: g?.grade ?? null, gradePoint: g?.gradePoint ?? null, isPass: l.percent >= subjectPass && !g?.isFail };
        });
        const total = r2(lines.reduce((a, l) => a + l.percent, 0));
        const percentage = lines.length ? r2(total / lines.length) : 0;
        const g = gradeFor(scheme.items, percentage);
        const pass = lines.length > 0 && lines.every((l) => l.isPass) && percentage >= Number(scheme.passPercent);
        return { studentId: st.id, lines, total, maxTotal: lines.length * 100, percentage, grade: g?.grade ?? null, resultStatus: pass ? 'PASS' : 'FAIL', attendance: attOf(st.id) };
      }).filter((r) => r.lines.length);
      if (!results.length) throw unprocessable('no-marks', 'No student has marks for this term yet', 'termCode');
      const rank = ranks(results.map((r) => ({ id: r.studentId, percent: r.percentage })));

      // Reuse the draft version (keeping remarks) or start a new version.
      let pub = await tx.resultPublication.findFirst({ where: { sectionId: section.id, academicYearId: section.academicYearId, termCode: input.termCode, status: 'DRAFT' } });
      const remarks = new Map<string, string | null>();
      if (pub) {
        for (const r of await tx.examResult.findMany({ where: { publicationId: pub.id }, select: { id: true, studentId: true, remarks: true } })) remarks.set(r.studentId, r.remarks);
        await tx.$executeRaw`DELETE FROM exam_result_subjects WHERE result_id IN (SELECT id FROM exam_results WHERE publication_id = ${pub.id}::uuid)`;
        await tx.$executeRaw`DELETE FROM exam_results WHERE publication_id = ${pub.id}::uuid`;
        pub = await tx.resultPublication.update({ where: { id: pub.id }, data: { preparedBy: auth.userId, preparedAt: new Date(), schemeId: scheme.id } });
      } else {
        const last = await tx.resultPublication.findFirst({ where: { sectionId: section.id, academicYearId: section.academicYearId, termCode: input.termCode }, orderBy: { version: 'desc' }, include: { results: { select: { studentId: true, remarks: true } } } });
        for (const r of last?.results ?? []) remarks.set(r.studentId, r.remarks);
        pub = await tx.resultPublication.create({ data: { tenantId: auth.tenantId!, sectionId: section.id, academicYearId: section.academicYearId, schemeId: scheme.id, termCode: input.termCode, version: (last?.version ?? 0) + 1, preparedBy: auth.userId } });
      }
      for (const r of results) {
        const created = await tx.examResult.create({
          data: {
            tenantId: auth.tenantId!, publicationId: pub.id, studentId: r.studentId, total: r.total, maxTotal: r.maxTotal, percentage: r.percentage, grade: r.grade, classRank: rank.get(r.studentId) ?? null,
            attendancePercent: r.attendance, remarks: remarks.get(r.studentId) ?? null, resultStatus: r.resultStatus,
          },
        });
        await tx.examResultSubject.createMany({ data: r.lines.map((l) => ({ tenantId: auth.tenantId!, resultId: created.id, subjectId: l.subjectId, components: l.components, percent: l.percent, grade: l.grade, gradePoint: l.gradePoint, isPass: l.isPass, sortOrder: l.sortOrder })) });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: section.campusId, action: 'UPDATE', entityType: 'RESULT_PUBLICATION', entityId: pub.id, newValues: { termCode: input.termCode, version: pub.version, students: results.length } }, client);
      return { publicationId: pub.id, version: pub.version, students: results.length, passed: results.filter((r) => r.resultStatus === 'PASS').length };
    });
  }

  /** A section's results for a term: the draft (if any) and the published version, with each student's lines. */
  results(sectionId: string, termCode: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const section = await this.sectionTx(tx, sectionId, auth);
      const scheme = await this.setup.schemeForLevelTx(tx, section.programLevelId);
      const pubs = await tx.resultPublication.findMany({ where: { sectionId, academicYearId: section.academicYearId, termCode, status: { in: ['DRAFT', 'PUBLISHED'] } }, orderBy: { version: 'desc' } });
      const view = async (p: (typeof pubs)[number] | undefined) => {
        if (!p) return null;
        const rows = await tx.examResult.findMany({ where: { publicationId: p.id }, include: { subjects: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ classRank: 'asc' }] });
        const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
        const names = new Map((await tx.user.findMany({ where: { id: { in: [p.preparedBy, p.publishedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
        return {
          id: p.id, version: p.version, status: p.status, preparedBy: names.get(p.preparedBy) ?? null, preparedAt: p.preparedAt, publishedBy: p.publishedBy ? names.get(p.publishedBy) ?? null : null, publishedAt: p.publishedAt,
          results: rows.map((r) => ({
            id: r.id, studentId: r.studentId, name: `${st.get(r.studentId)?.firstName ?? ''} ${st.get(r.studentId)?.lastName ?? ''}`.trim(), admissionNo: st.get(r.studentId)?.admissionNo ?? '',
            total: Number(r.total), maxTotal: Number(r.maxTotal), percentage: Number(r.percentage), grade: r.grade, rank: r.classRank, attendance: r.attendancePercent === null ? null : Number(r.attendancePercent), remarks: r.remarks, resultStatus: r.resultStatus,
            subjects: r.subjects.map((l) => ({ subjectId: l.subjectId, percent: Number(l.percent), grade: l.grade, isPass: l.isPass })),
          })),
        };
      };
      const subjectIds = [...new Set((await tx.levelSubject.findMany({ where: { programLevelId: section.programLevelId }, orderBy: { sortOrder: 'asc' } })).map((x) => x.subjectId))];
      const subjects = (await tx.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, code: true, name: true } })).sort((a, b) => subjectIds.indexOf(a.id) - subjectIds.indexOf(b.id));
      return {
        section: { id: section.id, name: `${section.level.name} – ${section.name}`, campusId: section.campusId },
        scheme: scheme ? { id: scheme.id, name: scheme.name, terms: [...scheme.terms.map((t) => ({ code: t.code, name: t.name })), ...(scheme.terms.length > 1 ? [{ code: FINAL_TERM, name: 'Final' }] : [])], coAreas: scheme.coAreas.map((a) => ({ id: a.id, name: a.name })), coGrades: scheme.coItems.map((i) => i.grade) } : null,
        subjects,
        canPrepare: can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId),
        draft: await view(pubs.find((p) => p.status === 'DRAFT')),
        published: await view(pubs.find((p) => p.status === 'PUBLISHED')),
      };
    });
  }

  private async isClassTeacher(tx: Tx, auth: AuthContext, classTeacherId: string | null) {
    if (!classTeacherId) return false;
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    return me?.id === classTeacherId;
  }

  /** Class teacher's (or results staff's) remarks on a draft result. */
  setRemarks(resultId: string, input: ResultRemarksInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.examResult.findUnique({ where: { id: resultId }, include: { publication: true } });
      if (!r) throw NotFound('Result');
      const section = await this.sectionTx(tx, r.publication.sectionId, auth);
      if (!can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId) && !(await this.isClassTeacher(tx, auth, section.classTeacherId))) throw Forbidden('not-class-teacher', 'Only the class teacher or results staff can write remarks');
      if (r.publication.status !== 'DRAFT') throw Conflict('result-published', 'Published results cannot change — recalculate to make a new version');
      await tx.examResult.update({ where: { id: resultId }, data: { remarks: input.remarks ?? null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: section.campusId, action: 'UPDATE', entityType: 'EXAM_RESULT', entityId: resultId, oldValues: { remarks: r.remarks }, newValues: input }, client);
      return { id: resultId, remarks: input.remarks ?? null };
    });
  }

  /** Co-scholastic grades of a section for a term (areas of the class's scheme). */
  coGrades(sectionId: string, termCode: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const section = await this.sectionTx(tx, sectionId, auth);
      const scheme = await this.setup.schemeForLevelTx(tx, section.programLevelId);
      if (!scheme) return { areas: [], grades: [], students: [], scale: [], canEdit: false };
      const roster = await rosterOf(tx, sectionId, todayIST() < iso(section.academicYear.endDate)! ? todayIST() : iso(section.academicYear.endDate)!);
      const grades = await tx.coScholasticGrade.findMany({ where: { areaId: { in: scheme.coAreas.map((a) => a.id) }, academicYearId: section.academicYearId, termCode, studentId: { in: roster.map((r) => r.id) } } });
      return {
        areas: scheme.coAreas.map((a) => ({ id: a.id, name: a.name })), scale: scheme.coItems.map((i) => ({ grade: i.grade, description: i.description })),
        students: roster.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName ?? ''}`.trim(), rollNo: r.rollNo })),
        grades: grades.map((g) => ({ studentId: g.studentId, areaId: g.areaId, grade: g.grade })),
        canEdit: can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId) || (await this.isClassTeacher(tx, auth, section.classTeacherId)),
      };
    });
  }

  saveCoGrades(input: CoGradesInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const section = await this.sectionTx(tx, input.sectionId, auth);
      if (!can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId) && !(await this.isClassTeacher(tx, auth, section.classTeacherId))) throw Forbidden('not-class-teacher', 'Only the class teacher or results staff can grade');
      const scheme = await this.setup.schemeForLevelTx(tx, section.programLevelId);
      if (!scheme || !scheme.terms.some((t) => t.code === input.termCode)) throw unprocessable('term-invalid', 'Unknown term', 'termCode');
      const areas = new Set(scheme.coAreas.map((a) => a.id));
      const allowed = new Set(scheme.coItems.map((i) => i.grade));
      const roster = new Set((await rosterOf(tx, section.id, todayIST() < iso(section.academicYear.endDate)! ? todayIST() : iso(section.academicYear.endDate)!)).map((r) => r.id));
      for (const g of input.grades) {
        if (!areas.has(g.areaId) || !roster.has(g.studentId)) throw NotFound('Student or area');
        if (!allowed.has(g.grade.toUpperCase())) throw unprocessable('grade-invalid', `Use one of: ${[...allowed].join(', ')}`, 'grades');
        await tx.coScholasticGrade.upsert({
          where: { tenantId_areaId_studentId_academicYearId_termCode: { tenantId: auth.tenantId!, areaId: g.areaId, studentId: g.studentId, academicYearId: section.academicYearId, termCode: input.termCode } },
          update: { grade: g.grade.toUpperCase(), updatedBy: auth.userId },
          create: { tenantId: auth.tenantId!, areaId: g.areaId, studentId: g.studentId, academicYearId: section.academicYearId, termCode: input.termCode, grade: g.grade.toUpperCase(), updatedBy: auth.userId },
        });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: section.campusId, action: 'UPDATE', entityType: 'CO_SCHOLASTIC_GRADES', entityId: section.id, newValues: input }, client);
      return { saved: input.grades.length };
    });
  }

  /** Publishes a draft — by someone who entered none of its marks; the previous version is superseded. */
  publish(publicationId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.resultPublication.findUnique({ where: { id: publicationId } });
      if (!p) throw NotFound('Results');
      const section = await this.sectionTx(tx, p.sectionId, auth);
      if (!can(auth, PERMISSIONS.EXAM_PUBLISH, section.campusId)) throw Forbidden('cannot-publish', 'You cannot publish results');
      if (p.status !== 'DRAFT') throw Conflict('not-draft', 'Only a draft can be published');
      const scheme = await this.setup.schemeTx(tx, p.schemeId);
      const terms = p.termCode === FINAL_TERM ? scheme.terms.map((t) => t.code) : [p.termCode];
      const comps = scheme.components.filter((c) => terms.includes(c.termCode)).map((c) => c.id);
      const entered = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM exam_marks m JOIN exam_mark_sheets sh ON sh.id = m.sheet_id JOIN exam_subjects es ON es.id = sh.exam_subject_id JOIN exams e ON e.id = es.exam_id
         WHERE sh.section_id = ${p.sectionId}::uuid AND e.academic_year_id = ${p.academicYearId}::uuid AND e.component_id = ANY(${comps}::uuid[]) AND m.entered_by = ${auth.userId}::uuid`;
      if (entered[0].n > 0) throw Forbidden('own-marks', 'You entered marks for these results — someone else must publish them');
      await tx.resultPublication.updateMany({ where: { sectionId: p.sectionId, academicYearId: p.academicYearId, termCode: p.termCode, status: 'PUBLISHED' }, data: { status: 'SUPERSEDED' } });
      await tx.resultPublication.update({ where: { id: p.id }, data: { status: 'PUBLISHED', publishedBy: auth.userId, publishedAt: new Date() } });
      const results = await tx.examResult.findMany({ where: { publicationId: p.id }, select: { studentId: true } });
      const students = await tx.student.findMany({ where: { id: { in: results.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, userId: true } });
      const guardians = await tx.studentGuardian.findMany({ where: { studentId: { in: students.map((s) => s.id) }, guardian: { userId: { not: null } } }, select: { studentId: true, guardian: { select: { userId: true } } } });
      const term = this.termName(scheme, p.termCode);
      let told = 0;
      for (const s of students) {
        const users = [...new Set([...guardians.filter((g) => g.studentId === s.id).map((g) => g.guardian.userId!), ...(s.userId ? [s.userId] : [])])];
        if (!users.length) continue;
        told += users.length;
        await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'RESULT_PUBLISHED', vars: { student: `${s.firstName} ${s.lastName ?? ''}`.trim(), term, section: `${section.level.name} – ${section.name}` }, entityType: 'RESULT_PUBLICATION', entityId: p.id });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: section.campusId, action: 'STATUS_CHANGE', entityType: 'RESULT_PUBLICATION', entityId: p.id, oldValues: { status: 'DRAFT' }, newValues: { status: 'PUBLISHED', version: p.version } }, client);
      return { id: p.id, version: p.version, status: 'PUBLISHED', notified: told };
    });
  }

  // ───────────── Report card ─────────────

  private async cardTx(tx: Tx, resultId: string) {
    const r = await tx.examResult.findUnique({ where: { id: resultId }, include: { publication: true, subjects: { orderBy: { sortOrder: 'asc' } } } });
    if (!r) return null;
    const p = r.publication;
    const scheme = await this.setup.schemeTx(tx, p.schemeId);
    const section = await tx.section.findUniqueOrThrow({ where: { id: p.sectionId }, select: { name: true, campusId: true, level: { select: { name: true, program: { select: { name: true } } } }, academicYear: { select: { name: true } } } });
    const campus = await tx.campus.findUniqueOrThrow({ where: { id: section.campusId }, select: { name: true } });
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: r.tenantId }, select: { name: true } });
    const st = await tx.student.findUniqueOrThrow({ where: { id: r.studentId }, select: { id: true, firstName: true, lastName: true, admissionNo: true, dob: true } });
    const enr = await tx.studentEnrollment.findFirst({ where: { studentId: r.studentId, sectionId: p.sectionId }, select: { rollNo: true } });
    const parent = await tx.studentGuardian.findFirst({ where: { studentId: r.studentId }, orderBy: { isPrimary: 'desc' }, select: { guardian: { select: { name: true } } } });
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: r.subjects.map((l) => l.subjectId) } }, select: { id: true, name: true, nameLocal: true } })).map((s) => [s.id, s]));
    const isFinal = p.termCode === FINAL_TERM;
    const columns = isFinal ? scheme.terms.map((t) => ({ code: t.code, name: t.name, weight: Number(t.finalWeight) })) : scheme.components.filter((c) => c.termCode === p.termCode).map((c) => ({ code: c.code, name: c.name, weight: Number(c.weightage) }));
    const terms = isFinal ? scheme.terms.map((t) => t.code) : [p.termCode];
    const co = await tx.coScholasticGrade.findMany({ where: { studentId: r.studentId, academicYearId: p.academicYearId, termCode: { in: terms }, areaId: { in: scheme.coAreas.map((a) => a.id) } } });
    return {
      publication: p,
      card: {
        school: tenant.name, campus: campus.name, year: section.academicYear.name, term: this.termName(scheme, p.termCode), termCode: p.termCode, version: p.version, status: p.status, publishedAt: p.publishedAt,
        student: { id: st.id, name: `${st.firstName} ${st.lastName ?? ''}`.trim(), admissionNo: st.admissionNo, rollNo: enr?.rollNo ?? null, dateOfBirth: iso(st.dob), parent: parent?.guardian.name ?? null },
        className: `${section.level.program.name} · ${section.level.name} – ${section.name}`,
        columns, scale: scheme.items.map((i) => ({ grade: i.grade, minPercent: Number(i.minPercent), description: i.description })),
        subjects: r.subjects.map((l) => ({ name: subjects.get(l.subjectId)?.name ?? '', nameLocal: subjects.get(l.subjectId)?.nameLocal ?? null, components: l.components, percent: Number(l.percent), grade: l.grade, isPass: l.isPass })),
        total: Number(r.total), maxTotal: Number(r.maxTotal), percentage: Number(r.percentage), grade: r.grade, rank: r.classRank, attendance: r.attendancePercent === null ? null : Number(r.attendancePercent),
        remarks: r.remarks, resultStatus: r.resultStatus, passPercent: Number(scheme.passPercent),
        coScholastic: scheme.coAreas.map((a) => ({ area: a.name, grades: terms.map((t) => co.find((g) => g.areaId === a.id && g.termCode === t)?.grade ?? null) })), coTerms: terms.map((t) => this.termName(scheme, t)),
      },
    };
  }

  card(resultId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.cardTx(tx, resultId);
      if (!c) throw NotFound('Result');
      await this.sectionTx(tx, c.publication.sectionId, auth);
      return c.card;
    });
  }

  /** For the parent app: the student's published results (latest version per term). */
  async forStudentTx(tx: Tx, studentId: string) {
    const rows = await tx.examResult.findMany({ where: { studentId, publication: { status: 'PUBLISHED' } }, include: { publication: true }, orderBy: { createdAt: 'desc' } });
    const out = [];
    for (const r of rows) {
      const scheme = await this.setup.schemeTx(tx, r.publication.schemeId);
      const year = await tx.academicYear.findUnique({ where: { id: r.publication.academicYearId }, select: { name: true } });
      out.push({ id: r.id, term: this.termName(scheme, r.publication.termCode), year: year?.name ?? '', percentage: Number(r.percentage), grade: r.grade, rank: r.classRank, resultStatus: r.resultStatus, publishedAt: r.publication.publishedAt });
    }
    return out;
  }

  /** For the parent app: one published report card of the student. */
  async cardForStudentTx(tx: Tx, studentId: string, resultId: string) {
    const c = await this.cardTx(tx, resultId);
    if (!c || c.card.student.id !== studentId || c.publication.status !== 'PUBLISHED') throw NotFound('Result');
    return c.card;
  }
}
