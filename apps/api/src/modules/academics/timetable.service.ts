import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import { ClassRoomInput, PERMISSIONS, SaveTimetableInput, SubstitutionInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { onLeave } from '../leave/leave.service';
import { AcademicSubjectsService } from './subjects.service';

const SETUP = PERMISSIONS.ACAD_SETUP;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const weekday = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type EntryView = { id: string; dayOfWeek: number; periodId: string; subjectId: string; employeeId: string; roomId: string | null; subject: string; subjectCode: string; teacher: string; room: string | null; section?: string };

/**
 * Timetable & substitution (M8.2). A section's week is drafted on its campus's bell timings, with
 * each lesson taught by a teacher assigned to that subject in that section; publishing archives the
 * previous version and makes the new one "live". Live lessons are guarded by unique indexes, so a
 * teacher, a room or a section can never be in two places in the same period — also when two
 * timetables are published at the same moment. A substitute is only offered when free that period.
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly subjects: AcademicSubjectsService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Rooms ─────────────

  rooms(auth: AuthContext, campusId?: string) {
    const s = this.subjects.scope(auth);
    return this.db.run(this.ctx(auth), (tx) => tx.classRoom.findMany({ where: { ...(campusId ? { campusId } : s.all ? {} : { campusId: { in: s.campusIds } }), status: 'ACTIVE' }, orderBy: [{ building: 'asc' }, { name: 'asc' }] }));
  }

  createRoom(input: ClassRoomInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.subjects.scope(auth, SETUP), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.classRoom.findUnique({ where: { tenantId_campusId_name: { tenantId: auth.tenantId!, campusId: input.campusId, name: input.name } }, select: { id: true } })) throw Conflict('room-name-taken', `${input.name} already exists`);
      const r = await tx.classRoom.create({ data: { ...input, capacity: input.capacity ?? null, building: input.building ?? null, floor: input.floor ?? null, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CREATE', entityType: 'CLASS_ROOM', entityId: r.id, newValues: input }, client);
      return r;
    });
  }

  // ───────────── Section timetable ─────────────

  private async entryViews(tx: Tx, timetableIds: string[], withSection = false): Promise<(EntryView & { timetableId: string })[]> {
    if (!timetableIds.length) return [];
    const rows = await tx.$queryRaw<(EntryView & { timetableId: string })[]>`
      SELECT e.id, e.timetable_id AS "timetableId", e.day_of_week AS "dayOfWeek", e.period_id AS "periodId", e.subject_id AS "subjectId", e.employee_id AS "employeeId", e.room_id AS "roomId",
             sj.name AS subject, sj.code AS "subjectCode", trim(em.first_name || ' ' || coalesce(em.last_name, '')) AS teacher, r.name AS room,
             CASE WHEN ${withSection} THEN l.name || ' – ' || sc.name ELSE NULL END AS section
        FROM timetable_entries e JOIN timetables t ON t.id = e.timetable_id JOIN subjects sj ON sj.id = e.subject_id JOIN employees em ON em.id = e.employee_id
        LEFT JOIN class_rooms r ON r.id = e.room_id JOIN sections sc ON sc.id = t.section_id JOIN program_levels l ON l.id = sc.program_level_id
       WHERE e.timetable_id = ANY(${timetableIds}::uuid[])
       ORDER BY e.day_of_week`;
    return rows;
  }

  /** Bell timings, syllabus subjects with their teachers, rooms — and the published and draft weeks. */
  async section(sectionId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const periods = await tx.period.findMany({ where: { campusId: s.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, isBreak: true } });
      const syllabus = await tx.levelSubject.findMany({ where: { programLevelId: s.programLevelId }, orderBy: { sortOrder: 'asc' }, include: { subject: { select: { id: true, code: true, name: true } } } });
      const teachers = await tx.$queryRaw<{ subject_id: string; id: string; name: string }[]>`
        SELECT st.subject_id, e.id, trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS name
          FROM section_subject_teachers st JOIN employees e ON e.id = st.employee_id WHERE st.section_id = ${sectionId}::uuid`;
      const rooms = await tx.classRoom.findMany({ where: { campusId: s.campusId, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, roomType: true } });
      const tts = await tx.timetable.findMany({ where: { sectionId, status: { in: ['PUBLISHED', 'DRAFT'] } } });
      const entries = await this.entryViews(tx, tts.map((t) => t.id));
      const view = (status: string) => {
        const t = tts.find((x) => x.status === status);
        return t ? { id: t.id, version: t.version, status: t.status, effectiveFrom: iso(t.effectiveFrom), publishedAt: t.publishedAt, entries: entries.filter((e) => e.timetableId === t.id) } : null;
      };
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}`, campusId: s.campusId },
        periods,
        subjects: syllabus.map((l) => ({ id: l.subject.id, code: l.subject.code, name: l.subject.name, teachers: teachers.filter((x) => x.subject_id === l.subjectId).map((x) => ({ id: x.id, name: x.name })) })),
        rooms, published: view('PUBLISHED'), draft: view('DRAFT'),
      };
    });
  }

  /** Saves the section's draft week (one draft per section, replaced each time). */
  saveDraft(input: SaveTimetableInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, input.sectionId, auth, SETUP);
      const periods = new Map((await tx.period.findMany({ where: { campusId: s.campusId, status: 'ACTIVE' }, select: { id: true, isBreak: true } })).map((p) => [p.id, p]));
      const assigned = new Set((await tx.sectionSubjectTeacher.findMany({ where: { sectionId: s.id }, select: { subjectId: true, employeeId: true } })).map((a) => `${a.subjectId}:${a.employeeId}`));
      const rooms = new Set((await tx.classRoom.findMany({ where: { campusId: s.campusId, status: 'ACTIVE' }, select: { id: true } })).map((r) => r.id));
      for (const e of input.entries) {
        const p = periods.get(e.periodId);
        if (!p || p.isBreak) throw unprocessable('period-invalid', 'Use the campus’s bell timings (not a break)', 'entries');
        if (!assigned.has(`${e.subjectId}:${e.employeeId}`)) throw unprocessable('not-subject-teacher', 'A lesson’s teacher does not teach that subject in this section — set the subject teachers first', 'entries');
        if (e.roomId && !rooms.has(e.roomId)) throw unprocessable('room-invalid', 'Choose a room of this campus', 'entries');
      }
      let draft = await tx.timetable.findFirst({ where: { sectionId: s.id, status: 'DRAFT' } });
      if (draft) {
        await tx.$executeRaw`DELETE FROM timetable_entries WHERE timetable_id = ${draft.id}::uuid`;
        draft = await tx.timetable.update({ where: { id: draft.id }, data: { effectiveFrom: day(input.effectiveFrom) } });
      } else {
        const last = await tx.timetable.aggregate({ where: { sectionId: s.id }, _max: { version: true } });
        draft = await tx.timetable.create({ data: { tenantId: auth.tenantId!, academicYearId: s.academicYearId, sectionId: s.id, effectiveFrom: day(input.effectiveFrom), version: (last._max.version ?? 0) + 1, createdBy: auth.userId } });
      }
      await tx.timetableEntry.createMany({ data: input.entries.map((e) => ({ tenantId: auth.tenantId!, timetableId: draft!.id, dayOfWeek: e.dayOfWeek, periodId: e.periodId, subjectId: e.subjectId, employeeId: e.employeeId, roomId: e.roomId ?? null })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'TIMETABLE', entityId: draft.id, newValues: { version: draft.version, lessons: input.entries.length } }, client);
      return { id: draft.id, version: draft.version, lessons: input.entries.length };
    });
  }

  /** Lessons of the draft that clash with live lessons of other sections (same teacher or room, same period). */
  private async clashes(tx: Tx, draftId: string, sectionId: string) {
    return tx.$queryRaw<{ dayOfWeek: number; period: string; kind: string; who: string; otherSection: string }[]>`
      SELECT d.day_of_week AS "dayOfWeek", p.name AS period, x.kind, x.who, x.other_section AS "otherSection"
        FROM timetable_entries d JOIN periods p ON p.id = d.period_id
        JOIN LATERAL (
          SELECT 'TEACHER' AS kind, trim(em.first_name || ' ' || coalesce(em.last_name, '')) AS who, l.name || ' – ' || sc.name AS other_section
            FROM timetable_entries o JOIN timetables t ON t.id = o.timetable_id JOIN employees em ON em.id = o.employee_id JOIN sections sc ON sc.id = t.section_id JOIN program_levels l ON l.id = sc.program_level_id
           WHERE o.is_live AND t.section_id <> ${sectionId}::uuid AND o.employee_id = d.employee_id AND o.day_of_week = d.day_of_week AND o.period_id = d.period_id
          UNION ALL
          SELECT 'ROOM', r.name, l.name || ' – ' || sc.name
            FROM timetable_entries o JOIN timetables t ON t.id = o.timetable_id JOIN class_rooms r ON r.id = o.room_id JOIN sections sc ON sc.id = t.section_id JOIN program_levels l ON l.id = sc.program_level_id
           WHERE o.is_live AND t.section_id <> ${sectionId}::uuid AND d.room_id IS NOT NULL AND o.room_id = d.room_id AND o.day_of_week = d.day_of_week AND o.period_id = d.period_id
        ) x ON true
       WHERE d.timetable_id = ${draftId}::uuid
       ORDER BY d.day_of_week, p.sequence`;
  }

  /** Publishes the draft: refuses any clash; the previous version is archived. */
  publish(sectionId: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth, SETUP);
      const draft = await tx.timetable.findFirst({ where: { sectionId, status: 'DRAFT' } });
      if (!draft) throw NotFound('Draft timetable');
      // Serialise publishing per institution so the clash check and the switch-over are atomic.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timetable:${auth.tenantId}`}))`;
      const found = await this.clashes(tx, draft.id, sectionId);
      if (found.length) {
        throw new AppError(HttpStatus.CONFLICT, 'timetable-clash', `${found.length} lesson(s) clash with other classes`, found.slice(0, 20).map((c) => ({ field: 'entries', message: `${DAY[c.dayOfWeek]} ${c.period}: ${c.kind === 'TEACHER' ? 'teacher' : 'room'} ${c.who} is with ${c.otherSection}` })));
      }
      const live = await tx.timetable.findFirst({ where: { sectionId, status: 'PUBLISHED' } });
      if (live) {
        await tx.timetableEntry.updateMany({ where: { timetableId: live.id }, data: { isLive: false } });
        await tx.timetable.update({ where: { id: live.id }, data: { status: 'ARCHIVED', effectiveTo: day(todayIST()) } });
      }
      try {
        await tx.timetableEntry.updateMany({ where: { timetableId: draft.id }, data: { isLive: true } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Conflict('timetable-clash', 'Another timetable was just published with the same teacher or room — check again');
        throw e;
      }
      const after = await tx.timetable.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedBy: auth.userId, publishedAt: new Date() } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'STATUS_CHANGE', entityType: 'TIMETABLE', entityId: draft.id, oldValues: { status: 'DRAFT' }, newValues: { status: 'PUBLISHED', version: draft.version, replaced: live?.version ?? null } }, client);
      return { id: after.id, version: after.version, status: after.status };
    });
  }

  /** A teacher's week (live lessons in every section) and substitutions from today. */
  teacher(employeeId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, campusId: true, firstName: true, lastName: true } });
      if (!e || !canAccessCampus(this.subjects.scope(auth), e.campusId)) throw NotFound('Staff member');
      const tts = await tx.timetable.findMany({ where: { status: 'PUBLISHED', entries: { some: { employeeId } } }, select: { id: true } });
      const entries = (await this.entryViews(tx, tts.map((t) => t.id), true)).filter((x) => x.employeeId === employeeId);
      const subs = await this.subsFor(tx, { substituteEmployeeId: employeeId, substitutionDate: { gte: day(todayIST()) }, status: 'ASSIGNED' });
      const periods = await tx.period.findMany({ where: { campusId: e.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, isBreak: true } });
      return { teacher: { id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim() }, periods, entries, substitutions: subs };
    });
  }

  /** The signed-in staff member's own week (their staff record linked to the login). */
  async mine(auth: AuthContext) {
    const me = await this.db.run(this.ctx(auth), (tx) => tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true, campusId: true } }));
    if (!me) throw NotFound('Staff record');
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUniqueOrThrow({ where: { id: me.id }, select: { id: true, campusId: true, firstName: true, lastName: true } });
      const tts = await tx.timetable.findMany({ where: { status: 'PUBLISHED', entries: { some: { employeeId: e.id } } }, select: { id: true } });
      const entries = (await this.entryViews(tx, tts.map((x) => x.id), true)).filter((x) => x.employeeId === e.id);
      const subs = await this.subsFor(tx, { substituteEmployeeId: e.id, substitutionDate: { gte: day(todayIST()) }, status: 'ASSIGNED' });
      const periods = await tx.period.findMany({ where: { campusId: e.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, isBreak: true } });
      return { teacher: { id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim() }, periods, entries, substitutions: subs };
    });
  }

  private async subsFor(tx: Tx, where: Prisma.SubstitutionWhereInput) {
    const rows = await tx.substitution.findMany({ where, orderBy: { substitutionDate: 'asc' }, include: { entry: { include: { timetable: { select: { sectionId: true } } } } } });
    const ids = [...new Set(rows.flatMap((r) => [r.absentEmployeeId, r.substituteEmployeeId]))];
    const staff = new Map((await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, `${e.firstName} ${e.lastName ?? ''}`.trim()]));
    const secs = new Map((await tx.section.findMany({ where: { id: { in: rows.map((r) => r.entry.timetable.sectionId) } }, select: { id: true, name: true, level: { select: { name: true } } } })).map((s) => [s.id, `${s.level.name} – ${s.name}`]));
    const periods = new Map((await tx.period.findMany({ where: { id: { in: rows.map((r) => r.entry.periodId) } }, select: { id: true, name: true, startTime: true } })).map((p) => [p.id, p]));
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: rows.map((r) => r.entry.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return rows.map((r) => ({
      id: r.id, date: iso(r.substitutionDate), status: r.status, reason: r.reason, timetableEntryId: r.timetableEntryId,
      section: secs.get(r.entry.timetable.sectionId) ?? '', period: periods.get(r.entry.periodId)?.name ?? '', startTime: periods.get(r.entry.periodId)?.startTime ?? null,
      subject: subjects.get(r.entry.subjectId) ?? '', absent: staff.get(r.absentEmployeeId) ?? '', substitute: staff.get(r.substituteEmployeeId) ?? '',
    }));
  }

  /** Teachers of the campus free in that lesson's period on that date (not teaching, not substituting, not on leave). */
  freeTeachers(entryId: string, date: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { entry, campusId } = await this.liveEntry(tx, entryId, auth);
      if (weekday(date) !== entry.dayOfWeek) throw unprocessable('wrong-day', `This lesson is on ${DAY[entry.dayOfWeek]}`, 'date');
      return this.freeTx(tx, campusId, entry, date);
    });
  }

  private async liveEntry(tx: Tx, entryId: string, auth: AuthContext) {
    const entry = await tx.timetableEntry.findUnique({ where: { id: entryId }, include: { timetable: { select: { sectionId: true, status: true } } } });
    if (!entry || !entry.isLive) throw NotFound('Lesson');
    const s = await this.subjects.section(tx, entry.timetable.sectionId, auth, SETUP);
    return { entry, campusId: s.campusId };
  }

  private async freeTx(tx: Tx, campusId: string, entry: { dayOfWeek: number; periodId: string; employeeId: string }, date: string) {
    const busy = new Set((await tx.timetableEntry.findMany({ where: { isLive: true, dayOfWeek: entry.dayOfWeek, periodId: entry.periodId }, select: { employeeId: true } })).map((x) => x.employeeId));
    const subbing = new Set((await tx.substitution.findMany({ where: { substitutionDate: day(date), status: 'ASSIGNED', entry: { dayOfWeek: entry.dayOfWeek, periodId: entry.periodId } }, select: { substituteEmployeeId: true } })).map((x) => x.substituteEmployeeId));
    const staff = await tx.employee.findMany({ where: { campusId, status: 'ACTIVE', employeeType: { in: ['TEACHING', 'VISITING', 'CONTRACT'] } }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true, employeeCode: true } });
    const away = await onLeave(tx, 'EMPLOYEE', staff.map((s) => s.id), date);
    return staff.filter((s) => s.id !== entry.employeeId && !busy.has(s.id) && !subbing.has(s.id) && !away.has(s.id)).map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), code: s.employeeCode }));
  }

  substitute(input: SubstitutionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { entry, campusId } = await this.liveEntry(tx, input.timetableEntryId, auth);
      if (input.date < todayIST()) throw unprocessable('date-past', 'Choose today or a later date', 'date');
      if (weekday(input.date) !== entry.dayOfWeek) throw unprocessable('wrong-day', `This lesson is on ${DAY[entry.dayOfWeek]}`, 'date');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subs:${auth.tenantId}:${input.date}`}))`;
      if (await tx.substitution.findFirst({ where: { timetableEntryId: entry.id, substitutionDate: day(input.date), status: 'ASSIGNED' }, select: { id: true } })) throw Conflict('already-substituted', 'This lesson already has a substitute that day');
      const free = await this.freeTx(tx, campusId, entry, input.date);
      if (!free.some((f) => f.id === input.substituteEmployeeId)) throw Conflict('teacher-busy', 'That teacher is not free in this period');
      const sub = await tx.substitution.create({ data: { tenantId: auth.tenantId!, timetableEntryId: entry.id, substitutionDate: day(input.date), absentEmployeeId: entry.employeeId, substituteEmployeeId: input.substituteEmployeeId, reason: input.reason, createdBy: auth.userId } });
      const view = (await this.subsFor(tx, { id: sub.id }))[0];
      const user = await tx.employee.findUnique({ where: { id: input.substituteEmployeeId }, select: { userId: true } });
      if (user?.userId) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: [user.userId], eventCode: 'SUBSTITUTION', vars: { section: view.section, subject: view.subject, period: view.period, date: input.date, absent: view.absent }, entityType: 'SUBSTITUTION', entityId: sub.id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'CREATE', entityType: 'SUBSTITUTION', entityId: sub.id, newValues: input }, client);
      return { ...view, notified: !!user?.userId };
    });
  }

  cancelSubstitution(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const sub = await tx.substitution.findUnique({ where: { id } });
      if (!sub) throw NotFound('Substitution');
      const { campusId } = await this.liveEntry(tx, sub.timetableEntryId, auth);
      if (sub.status !== 'ASSIGNED') throw Conflict('substitution-closed', 'This substitution is already cancelled');
      await tx.substitution.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'STATUS_CHANGE', entityType: 'SUBSTITUTION', entityId: id, oldValues: { status: 'ASSIGNED' }, newValues: { status: 'CANCELLED' } }, client);
      return { id, status: 'CANCELLED' };
    });
  }

  /** Substitutions on a date for a campus (the office's "today" list). */
  daySubstitutions(campusId: string, date: string, auth: AuthContext) {
    if (!canAccessCampus(this.subjects.scope(auth), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => this.subsFor(tx, { substitutionDate: day(date), entry: { timetable: { sectionId: { in: (await tx.section.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id) } } } }));
  }

  /** For the parent app: the child's section week (live) with substitutions in the next 7 days. */
  async forSectionTx(tx: Tx, sectionId: string) {
    const t = await tx.timetable.findFirst({ where: { sectionId, status: 'PUBLISHED' }, select: { id: true } });
    if (!t) return null;
    const s = await tx.section.findUnique({ where: { id: sectionId }, select: { campusId: true } });
    const periods = await tx.period.findMany({ where: { campusId: s!.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, isBreak: true } });
    const entries = await this.entryViews(tx, [t.id]);
    const subs = await this.subsFor(tx, { status: 'ASSIGNED', substitutionDate: { gte: day(todayIST()), lte: day(new Date(Date.parse(`${todayIST()}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)) }, entry: { timetableId: t.id } });
    return { periods, entries, substitutions: subs };
  }
}
