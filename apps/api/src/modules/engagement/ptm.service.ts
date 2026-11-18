import { Injectable } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import { PERMISSIONS, PtmInput, WeeklyOff, addMinutes, isWeeklyOff, ptmSlotTimes } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { audiencesOf, unprocessable } from './audience';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();

/**
 * Parent-teacher meetings (M11.3). A PTM day is set for chosen classes; every class teacher and
 * subject teacher of their sections gets slots across the day. Parents book one slot per teacher per
 * child inside the booking window — one family per slot, enforced by the database even when two book
 * at once. The slot's teacher marks attended / no-show and writes notes; parents add feedback.
 */
@Injectable()
export class PtmService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly settings: SettingsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** Teachers of a section: its class teacher and subject teachers. */
  private async teachersOfSections(tx: Tx, sectionIds: string[]) {
    const st = await tx.sectionSubjectTeacher.findMany({ where: { sectionId: { in: sectionIds } }, select: { sectionId: true, employeeId: true, subjectId: true } });
    const ct = await tx.section.findMany({ where: { id: { in: sectionIds }, classTeacherId: { not: null } }, select: { id: true, classTeacherId: true } });
    return { st, ct };
  }

  create(input: PtmInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, PERMISSIONS.PTM_MANAGE);
      if (!s || !canAccessCampus(s, input.campusId)) throw NotFound('Campus');
      if (input.ptmDate < todayIST()) throw unprocessable('date-past', 'Choose today or a later date', 'ptmDate');
      if (new Date(input.bookingCloses) > new Date(`${input.ptmDate}T${input.startTime}:00+05:30`)) throw unprocessable('booking-late', 'Booking must close before the meetings start', 'bookingCloses');
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) throw unprocessable('no-current-year', 'Set the current academic year first', 'ptmDate');
      if (isWeeklyOff(input.ptmDate, await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', input.campusId))) throw unprocessable('school-closed', 'The school is closed that day (weekly holiday)', 'ptmDate');
      const hol = await tx.holiday.findFirst({ where: { holidayDate: day(input.ptmDate), OR: [{ campusId: null }, { campusId: input.campusId }] }, select: { name: true } });
      if (hol) throw unprocessable('school-closed', `The school is closed that day (${hol.name})`, 'ptmDate');
      const levels = await tx.programLevel.findMany({ where: { id: { in: input.programLevelIds }, program: { campusId: input.campusId } }, select: { id: true } });
      if (levels.length !== input.programLevelIds.length) throw unprocessable('class-invalid', 'Choose classes of this campus', 'programLevelIds');
      const times = ptmSlotTimes(input.startTime, input.endTime, input.slotMinutes);
      if (!times.length) throw unprocessable('no-slots', 'The meeting time is shorter than one slot', 'endTime');
      const sections = await tx.section.findMany({ where: { academicYearId: year.id, programLevelId: { in: input.programLevelIds }, status: 'ACTIVE' }, select: { id: true } });
      const { st, ct } = await this.teachersOfSections(tx, sections.map((x) => x.id));
      const teachers = [...new Set([...st.map((x) => x.employeeId), ...ct.map((x) => x.classTeacherId!)])];
      if (!teachers.length) throw unprocessable('no-teachers', 'These classes have no class or subject teachers yet', 'programLevelIds');
      const p = await tx.ptmSession.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, academicYearId: year.id, title: input.title, ptmDate: day(input.ptmDate), startTime: input.startTime, endTime: input.endTime, slotMinutes: input.slotMinutes, mode: input.mode, bookingOpens: new Date(input.bookingOpens), bookingCloses: new Date(input.bookingCloses), createdBy: auth.userId } });
      await tx.ptmSessionLevel.createMany({ data: input.programLevelIds.map((programLevelId) => ({ tenantId: auth.tenantId!, sessionId: p.id, programLevelId })) });
      await tx.ptmSlot.createMany({ data: teachers.flatMap((employeeId) => times.map((t) => ({ tenantId: auth.tenantId!, sessionId: p.id, employeeId, slotStart: t, slotEnd: addMinutes(t, input.slotMinutes) }))) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'PTM_SESSION', entityId: p.id, newValues: { ...input, teachers: teachers.length, slots: teachers.length * times.length } }, client);
      return { id: p.id, teachers: teachers.length, slots: teachers.length * times.length };
    });
  }

  list(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, PERMISSIONS.PTM_MANAGE) ?? scopeFor(auth, PERMISSIONS.PTM_TEACH) ?? { all: false, campusIds: [] };
      const rows = await tx.ptmSession.findMany({ where: { ...(s.all ? {} : { campusId: { in: s.campusIds } }), ptmDate: { gte: day(new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)) } }, orderBy: { ptmDate: 'desc' }, include: { slots: { select: { id: true, _count: { select: { bookings: { where: { status: { not: 'CANCELLED' } } } } } } } } });
      return rows.map(({ slots, ...p }) => ({ id: p.id, title: p.title, ptmDate: iso(p.ptmDate), startTime: p.startTime, endTime: p.endTime, slotMinutes: p.slotMinutes, mode: p.mode, bookingOpens: p.bookingOpens, bookingCloses: p.bookingCloses, status: p.status, slots: slots.length, booked: slots.reduce((a, x) => a + x._count.bookings, 0) }));
    });
  }

  /** A PTM day: every teacher's slots with bookings (office), or only the signed-in teacher's. */
  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.ptmSession.findUnique({ where: { id }, include: { levels: true } });
      const manage = scopeFor(auth, PERMISSIONS.PTM_MANAGE);
      const teach = scopeFor(auth, PERMISSIONS.PTM_TEACH);
      if (!p || !((manage && canAccessCampus(manage, p.campusId)) || (teach && canAccessCampus(teach, p.campusId)))) throw NotFound('Meeting day');
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const own = !(manage && canAccessCampus(manage, p.campusId));
      const slots = await tx.ptmSlot.findMany({ where: { sessionId: id, ...(own ? { employeeId: me?.id ?? '00000000-0000-0000-0000-000000000000' } : {}) }, orderBy: [{ slotStart: 'asc' }], include: { bookings: { where: { status: { not: 'CANCELLED' } } } } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: [...new Set(slots.map((x) => x.employeeId))] } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const studentIds = slots.flatMap((x) => x.bookings.map((b) => b.studentId));
      const students = new Map((await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((x) => [x.id, x]));
      const [auds, guardians] = [await audiencesOf(tx, studentIds), await tx.studentGuardian.findMany({ where: { studentId: { in: studentIds } }, orderBy: { isPrimary: 'desc' }, select: { studentId: true, guardian: { select: { name: true, phone: true } } } })];
      const sections = new Map((await tx.section.findMany({ where: { id: { in: auds.map((a) => a.sectionId) } }, select: { id: true, name: true, level: { select: { name: true } } } })).map((x) => [x.id, `${x.level.name} – ${x.name}`]));
      const levelNames = await tx.programLevel.findMany({ where: { id: { in: p.levels.map((l) => l.programLevelId) } }, select: { name: true } });
      const teachers = [...new Set(slots.map((x) => x.employeeId))].map((eid) => ({
        employeeId: eid, name: staff.get(eid) ?? '',
        slots: slots.filter((x) => x.employeeId === eid).map((x) => {
          const b = x.bookings[0];
          const stu = b ? students.get(b.studentId) : null;
          return { id: x.id, start: x.slotStart, end: x.slotEnd, room: x.room, isBlocked: x.isBlocked, booking: b && stu ? { id: b.id, studentId: b.studentId, student: name(stu), admissionNo: stu.admissionNo, section: sections.get(auds.find((a) => a.studentId === b.studentId)?.sectionId ?? '') ?? '', parent: guardians.find((g) => g.studentId === b.studentId)?.guardian.name ?? null, status: b.status, notes: b.teacherNotes, feedback: b.parentFeedback } : null };
        }),
      }));
      return {
        session: { id: p.id, title: p.title, ptmDate: iso(p.ptmDate), startTime: p.startTime, endTime: p.endTime, slotMinutes: p.slotMinutes, mode: p.mode, bookingOpens: p.bookingOpens, bookingCloses: p.bookingCloses, status: p.status, classes: levelNames.map((l) => l.name) },
        own, myEmployeeId: me?.id ?? null, teachers,
      };
    });
  }

  private async slotForTeacher(tx: Tx, slotId: string, auth: AuthContext) {
    const slot = await tx.ptmSlot.findUnique({ where: { id: slotId }, include: { session: true } });
    if (!slot) throw NotFound('Slot');
    const manage = scopeFor(auth, PERMISSIONS.PTM_MANAGE);
    if (manage && canAccessCampus(manage, slot.session.campusId)) return slot;
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    if (!scopeFor(auth, PERMISSIONS.PTM_TEACH) || me?.id !== slot.employeeId) throw Forbidden('not-your-slot', 'Only the teacher of this slot can do that');
    return slot;
  }

  /** The teacher blocks a free slot (e.g. a break) or opens it again. */
  block(slotId: string, blocked: boolean, room: string | null | undefined, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const slot = await this.slotForTeacher(tx, slotId, auth);
      if (blocked && (await tx.ptmBooking.count({ where: { slotId, status: { not: 'CANCELLED' } } }))) throw Conflict('slot-booked', 'A family has booked this slot');
      await tx.ptmSlot.update({ where: { id: slotId }, data: { isBlocked: blocked, ...(room !== undefined ? { room } : {}) } });
      return { id: slot.id, isBlocked: blocked };
    });
  }

  /** Attended / no-show with the teacher's notes (on or after the day). */
  outcome(bookingId: string, status: 'ATTENDED' | 'NO_SHOW', notes: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.ptmBooking.findUnique({ where: { id: bookingId } });
      if (!b || b.status === 'CANCELLED') throw NotFound('Booking');
      const slot = await this.slotForTeacher(tx, b.slotId, auth);
      if (iso(slot.session.ptmDate)! > todayIST()) throw Conflict('ptm-future', 'Record the meeting on or after its day');
      await tx.ptmBooking.update({ where: { id: bookingId }, data: { status, teacherNotes: notes } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: slot.session.campusId, action: 'UPDATE', entityType: 'PTM_BOOKING', entityId: bookingId, oldValues: { status: b.status }, newValues: { status, notes: notes ? 'recorded' : null } }, client);
      return { id: bookingId, status };
    });
  }

  // ───────────── Parent app ─────────────

  /** Open PTM days for the child's class: the child's teachers with free slots, and the child's bookings. */
  async forStudentTx(tx: Tx, studentId: string) {
    const [a] = await audiencesOf(tx, [studentId]);
    if (!a) return [];
    const sessions = await tx.ptmSession.findMany({ where: { status: 'OPEN', ptmDate: { gte: day(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)) }, levels: { some: { programLevelId: a.programLevelId } } }, orderBy: { ptmDate: 'asc' } });
    if (!sessions.length) return [];
    const { st, ct } = await this.teachersOfSections(tx, [a.sectionId]);
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: st.map((x) => x.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const roles = new Map<string, string[]>();
    for (const c of ct) roles.set(c.classTeacherId!, ['CLASS_TEACHER']);
    for (const x of st) roles.set(x.employeeId, [...(roles.get(x.employeeId) ?? []), subjects.get(x.subjectId) ?? '']);
    const staff = new Map((await tx.employee.findMany({ where: { id: { in: [...roles.keys()] } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
    const now = Date.now();
    const out = [];
    for (const s of sessions) {
      const slots = await tx.ptmSlot.findMany({ where: { sessionId: s.id, employeeId: { in: [...roles.keys()] } }, orderBy: { slotStart: 'asc' }, include: { bookings: { where: { status: { not: 'CANCELLED' } } } } });
      const mine = await tx.ptmBooking.findMany({ where: { sessionId: s.id, studentId, status: { not: 'CANCELLED' } } });
      out.push({
        id: s.id, title: s.title, ptmDate: iso(s.ptmDate), startTime: s.startTime, endTime: s.endTime, mode: s.mode, bookingOpens: s.bookingOpens, bookingCloses: s.bookingCloses,
        open: now >= s.bookingOpens.getTime() && now <= s.bookingCloses.getTime(),
        teachers: [...roles.entries()].map(([eid, r]) => {
          const b = mine.find((x) => x.employeeId === eid);
          const bs = b ? slots.find((x) => x.id === b.slotId) : null;
          return {
            employeeId: eid, name: staff.get(eid) ?? '', roles: r,
            booking: b && bs ? { id: b.id, start: bs.slotStart, end: bs.slotEnd, room: bs.room, status: b.status, feedback: b.parentFeedback } : null,
            free: slots.filter((x) => x.employeeId === eid && !x.isBlocked && !x.bookings.length).map((x) => ({ id: x.id, start: x.slotStart, end: x.slotEnd })),
          };
        }),
      });
    }
    return out;
  }

  /** The family books a slot for the child (window open, a teacher of the child, one per teacher). */
  async bookTx(tx: Tx, studentId: string, slotId: string, auth: AuthContext) {
    const slot = await tx.ptmSlot.findUnique({ where: { id: slotId }, include: { session: { include: { levels: true } } } });
    const [a] = await audiencesOf(tx, [studentId]);
    if (!slot || !a || slot.session.status !== 'OPEN' || !slot.session.levels.some((l) => l.programLevelId === a.programLevelId)) throw NotFound('Slot');
    const { st, ct } = await this.teachersOfSections(tx, [a.sectionId]);
    if (!st.some((x) => x.employeeId === slot.employeeId) && !ct.some((x) => x.classTeacherId === slot.employeeId)) throw NotFound('Slot');
    const now = Date.now();
    if (now < slot.session.bookingOpens.getTime() || now > slot.session.bookingCloses.getTime()) throw Conflict('booking-closed', 'Booking is not open now');
    if (slot.isBlocked) throw Conflict('slot-taken', 'This slot is not available');
    if (await tx.ptmBooking.findFirst({ where: { sessionId: slot.sessionId, employeeId: slot.employeeId, studentId, status: { not: 'CANCELLED' } }, select: { id: true } })) throw Conflict('already-booked', 'You already have a meeting with this teacher');
    if (await tx.ptmBooking.findFirst({ where: { slotId, status: { not: 'CANCELLED' } }, select: { id: true } })) throw Conflict('slot-taken', 'Someone has just booked this slot — choose another');
    try {
      const b = await tx.ptmBooking.create({ data: { tenantId: slot.tenantId, slotId, sessionId: slot.sessionId, employeeId: slot.employeeId, studentId, bookedBy: auth.userId } });
      const st2 = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true } });
      const teacher = await tx.employee.findUniqueOrThrow({ where: { id: slot.employeeId }, select: { firstName: true, lastName: true, userId: true } });
      const users = [auth.userId, ...(teacher.userId ? [teacher.userId] : [])];
      await this.notifications.notify(tx, { tenantId: slot.tenantId, userIds: users, eventCode: 'PTM_BOOKED', vars: { student: st2.firstName, teacher: name(teacher), date: iso(slot.session.ptmDate)!, time: slot.slotStart }, entityType: 'PTM_BOOKING', entityId: b.id });
      return { id: b.id, start: slot.slotStart, end: slot.slotEnd, status: b.status };
    } catch (e) {
      // Two bookings at the same moment: the database refused the second (the transaction cannot be used further).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Conflict('booking-clash', 'This slot or teacher was just booked — refresh and choose again');
      throw e;
    }
  }

  async cancelTx(tx: Tx, studentId: string, bookingId: string) {
    const b = await tx.ptmBooking.findUnique({ where: { id: bookingId }, include: { slot: { include: { session: true } } } });
    if (!b || b.studentId !== studentId || b.status !== 'BOOKED') throw NotFound('Booking');
    if (iso(b.slot.session.ptmDate)! <= todayIST()) throw Conflict('ptm-today', 'A meeting cannot be cancelled on its day — please tell the school');
    await tx.ptmBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    return { id: bookingId, status: 'CANCELLED' };
  }

  async feedbackTx(tx: Tx, studentId: string, bookingId: string, feedback: string) {
    const b = await tx.ptmBooking.findUnique({ where: { id: bookingId } });
    if (!b || b.studentId !== studentId || b.status !== 'ATTENDED') throw NotFound('Booking');
    await tx.ptmBooking.update({ where: { id: bookingId }, data: { parentFeedback: feedback } });
    return { id: bookingId, feedback };
  }
}
