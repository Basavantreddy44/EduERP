import { HttpStatus, Injectable } from '@nestjs/common';
import { LessonPlanInput, LessonStatusInput, PERMISSIONS, SyllabusPlanInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { AcademicSubjectsService } from './subjects.service';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/**
 * Lesson plans & syllabus tracking (M10.1). The syllabus of a class and subject is a list of units
 * with topics for the year; the subject's teacher of a section plans lessons on topics and records
 * them taught (which marks the topic done for that section) or postponed. Completion % of a section
 * and subject = topics taught ÷ all topics.
 */
@Injectable()
export class LessonsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly subjects: AcademicSubjectsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private async currentYear(tx: Tx) {
    const y = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!y) throw unprocessable('no-current-year', 'Set the current academic year first', 'programLevelId');
    return y.id;
  }

  private async me(tx: Tx, auth: AuthContext) {
    return tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
  }

  /** Set-up staff of the campus, or the subject's teacher in that section. */
  async canTeachSubject(tx: Tx, section: { id: string; campusId: string }, subjectId: string, auth: AuthContext) {
    const setup = scopeFor(auth, PERMISSIONS.ACAD_SETUP);
    if (setup && canAccessCampus(setup, section.campusId)) return true;
    const teach = scopeFor(auth, PERMISSIONS.ACAD_TEACH);
    if (!teach || !canAccessCampus(teach, section.campusId)) return false;
    const me = await this.me(tx, auth);
    return !!me && !!(await tx.sectionSubjectTeacher.findFirst({ where: { sectionId: section.id, subjectId, employeeId: me.id }, select: { id: true } }));
  }

  // ───────────── Syllabus units & topics ─────────────

  private async unitsTx(tx: Tx, yearId: string, programLevelId: string, subjectId: string) {
    const units = await tx.syllabusUnit.findMany({ where: { academicYearId: yearId, programLevelId, subjectId, status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' }, include: { topics: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } } } });
    return units.map((u) => ({ id: u.id, title: u.title, plannedHours: u.plannedHours === null ? null : Number(u.plannedHours), topics: u.topics.map((t) => ({ id: t.id, title: t.title })) }));
  }

  /** A class and subject's units and topics for the current year. */
  syllabus(programLevelId: string, subjectId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id: programLevelId }, select: { program: { select: { campusId: true } } } });
      if (!level || !canAccessCampus(this.subjects.scope(auth), level.program.campusId)) throw NotFound('Class');
      return { units: await this.unitsTx(tx, await this.currentYear(tx), programLevelId, subjectId) };
    });
  }

  /** Saves the whole unit / topic list; removed topics that were taught or planned are kept (retired), never deleted. */
  saveSyllabus(input: SyllabusPlanInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id: input.programLevelId }, select: { program: { select: { campusId: true } } } });
      if (!level || !canAccessCampus(this.subjects.scope(auth, PERMISSIONS.ACAD_SETUP), level.program.campusId)) throw NotFound('Class');
      if (!(await tx.levelSubject.findFirst({ where: { programLevelId: input.programLevelId, subjectId: input.subjectId } }))) throw unprocessable('not-in-syllabus', 'This subject is not in the class’s syllabus', 'subjectId');
      const yearId = await this.currentYear(tx);
      const before = await tx.syllabusUnit.findMany({ where: { academicYearId: yearId, programLevelId: input.programLevelId, subjectId: input.subjectId, status: 'ACTIVE' }, include: { topics: { where: { status: 'ACTIVE' } } } });
      const keepUnits = new Set(input.units.map((u) => u.id).filter(Boolean));
      const keepTopics = new Set(input.units.flatMap((u) => u.topics.map((t) => t.id)).filter(Boolean));
      for (const u of before) {
        for (const t of u.topics) if (!keepTopics.has(t.id)) await tx.syllabusTopic.update({ where: { id: t.id }, data: { status: 'REMOVED' } });
        if (!keepUnits.has(u.id)) await tx.syllabusUnit.update({ where: { id: u.id }, data: { status: 'REMOVED' } });
      }
      for (const [i, u] of input.units.entries()) {
        let unitId = u.id ?? null;
        if (unitId) {
          if (!before.some((b) => b.id === unitId)) throw NotFound('Unit');
          await tx.syllabusUnit.update({ where: { id: unitId }, data: { title: u.title, plannedHours: u.plannedHours ?? null, sortOrder: i } });
        } else unitId = (await tx.syllabusUnit.create({ data: { tenantId: auth.tenantId!, academicYearId: yearId, programLevelId: input.programLevelId, subjectId: input.subjectId, title: u.title, plannedHours: u.plannedHours ?? null, sortOrder: i, createdBy: auth.userId } })).id;
        for (const [j, t] of u.topics.entries()) {
          if (t.id) {
            if (!before.some((b) => b.topics.some((x) => x.id === t.id))) throw NotFound('Topic');
            await tx.syllabusTopic.update({ where: { id: t.id }, data: { title: t.title, sortOrder: j, unitId } });
          } else await tx.syllabusTopic.create({ data: { tenantId: auth.tenantId!, unitId, title: t.title, sortOrder: j } });
        }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: level.program.campusId, action: 'UPDATE', entityType: 'SYLLABUS_PLAN', entityId: input.programLevelId, newValues: { subjectId: input.subjectId, units: input.units.length, topics: input.units.reduce((a, u) => a + u.topics.length, 0) } }, client);
      return { units: await this.unitsTx(tx, yearId, input.programLevelId, input.subjectId) };
    });
  }

  // ───────────── Lesson plans & progress ─────────────

  /** A section's subject: units and topics with taught state, the lesson plans, and completion %. */
  sectionSubject(sectionId: string, subjectId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const units = await this.unitsTx(tx, s.academicYearId, s.programLevelId, subjectId);
      const topicIds = units.flatMap((u) => u.topics.map((t) => t.id));
      const done = new Map((await tx.syllabusProgress.findMany({ where: { sectionId, topicId: { in: topicIds } } })).map((p) => [p.topicId, iso(p.completedDate)]));
      const plans = await tx.lessonPlan.findMany({ where: { sectionId, subjectId, topicId: { in: topicIds } }, orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }] });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: plans.map((p) => p.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, `${e.firstName} ${e.lastName ?? ''}`.trim()]));
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}`, programLevelId: s.programLevelId },
        canPlan: await this.canTeachSubject(tx, s, subjectId, auth),
        units: units.map((u) => ({ ...u, topics: u.topics.map((t) => ({ ...t, taughtOn: done.get(t.id) ?? null })) })),
        completion: { taught: [...done.keys()].length, total: topicIds.length, percent: topicIds.length ? Math.round((done.size / topicIds.length) * 1000) / 10 : null },
        plans: plans.map((p) => ({ id: p.id, topicId: p.topicId, plannedDate: iso(p.plannedDate), objectives: p.objectives, teachingMethod: p.teachingMethod, resources: p.resources, status: p.status, completedOn: iso(p.completedOn), notes: p.notes, teacher: p.employeeId ? staff.get(p.employeeId) ?? null : null })),
      };
    });
  }

  createPlan(input: LessonPlanInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, input.sectionId, auth);
      if (!(await this.canTeachSubject(tx, s, input.subjectId, auth))) throw Forbidden('not-your-subject', 'You do not teach this subject in this section');
      const topic = await tx.syllabusTopic.findUnique({ where: { id: input.topicId }, include: { unit: true } });
      if (!topic || topic.status !== 'ACTIVE' || topic.unit.programLevelId !== s.programLevelId || topic.unit.subjectId !== input.subjectId || topic.unit.academicYearId !== s.academicYearId) throw unprocessable('topic-invalid', 'Choose a topic of this class and subject', 'topicId');
      const me = await this.me(tx, auth);
      const p = await tx.lessonPlan.create({ data: { tenantId: auth.tenantId!, sectionId: s.id, subjectId: input.subjectId, topicId: input.topicId, employeeId: me?.id ?? null, plannedDate: day(input.plannedDate), objectives: input.objectives ?? null, teachingMethod: input.teachingMethod ?? null, resources: input.resources ?? null, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'LESSON_PLAN', entityId: p.id, newValues: input }, client);
      return { id: p.id, status: p.status };
    });
  }

  /** Taught (records the topic done for the section, once) or postponed to a new date. */
  setStatus(planId: string, input: LessonStatusInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.lessonPlan.findUnique({ where: { id: planId } });
      if (!p) throw NotFound('Lesson plan');
      const s = await this.subjects.section(tx, p.sectionId, auth);
      if (!(await this.canTeachSubject(tx, s, p.subjectId, auth))) throw Forbidden('not-your-subject', 'You do not teach this subject in this section');
      if (p.status === 'COMPLETED') throw Conflict('lesson-done', 'This lesson is already recorded as taught');
      const today = todayIST();
      if (input.status === 'COMPLETED') {
        if (iso(p.plannedDate)! > today) throw unprocessable('lesson-future', 'A lesson can be recorded as taught on or after its date', 'status');
        await tx.lessonPlan.update({ where: { id: planId }, data: { status: 'COMPLETED', completedOn: day(today), notes: input.notes ?? p.notes } });
        const me = await this.me(tx, auth);
        await tx.syllabusProgress.upsert({
          where: { tenantId_sectionId_topicId: { tenantId: auth.tenantId!, sectionId: p.sectionId, topicId: p.topicId } },
          update: {},
          create: { tenantId: auth.tenantId!, sectionId: p.sectionId, topicId: p.topicId, completedDate: day(today), employeeId: me?.id ?? null, lessonPlanId: p.id, remarks: input.notes ?? null, createdBy: auth.userId },
        });
      } else {
        if (input.newDate! < today) throw unprocessable('date-past', 'Choose today or a later date', 'newDate');
        await tx.lessonPlan.update({ where: { id: planId }, data: { status: 'POSTPONED', notes: input.notes ?? p.notes } });
        // The postponed lesson is kept; a new plan is made for the new date.
        await tx.lessonPlan.create({ data: { tenantId: auth.tenantId!, sectionId: p.sectionId, subjectId: p.subjectId, topicId: p.topicId, employeeId: p.employeeId, plannedDate: day(input.newDate!), objectives: p.objectives, teachingMethod: p.teachingMethod, resources: p.resources, createdBy: auth.userId } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'STATUS_CHANGE', entityType: 'LESSON_PLAN', entityId: planId, oldValues: { status: p.status }, newValues: input }, client);
      return { id: planId, status: input.status };
    });
  }

  /** Completion % of every subject of a section (or of the teacher's own sections) — the office view. */
  progress(sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const rows = await tx.$queryRaw<{ subject_id: string; total: number; taught: number; planned: number }[]>`
        SELECT u.subject_id, count(t.id)::int AS total,
               count(p.id)::int AS taught,
               (SELECT count(*)::int FROM lesson_plans lp WHERE lp.section_id = ${sectionId}::uuid AND lp.subject_id = u.subject_id AND lp.status = 'PLANNED') AS planned
          FROM syllabus_units u JOIN syllabus_topics t ON t.unit_id = u.id AND t.status = 'ACTIVE'
          LEFT JOIN syllabus_progress p ON p.topic_id = t.id AND p.section_id = ${sectionId}::uuid
         WHERE u.academic_year_id = ${s.academicYearId}::uuid AND u.program_level_id = ${s.programLevelId}::uuid AND u.status = 'ACTIVE'
         GROUP BY u.subject_id`;
      const syllabus = await tx.levelSubject.findMany({ where: { programLevelId: s.programLevelId }, orderBy: { sortOrder: 'asc' }, include: { subject: { select: { id: true, code: true, name: true } } } });
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}` },
        subjects: syllabus.map((l) => {
          const r = rows.find((x) => x.subject_id === l.subjectId);
          return { subject: l.subject, total: r?.total ?? 0, taught: r?.taught ?? 0, upcoming: r?.planned ?? 0, percent: r?.total ? Math.round((r.taught / r.total) * 1000) / 10 : null };
        }),
      };
    });
  }
}
