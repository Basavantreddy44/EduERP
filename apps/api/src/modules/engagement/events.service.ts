import { Injectable } from '@nestjs/common';
import { EventInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { FeeBillingService } from '../fees/billing.service';
import { Audience, audiencesOf, checkTargets, familyUsers, reaches, studentsReached, unprocessable } from './audience';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Events & calendar (M11.2). An event is for an audience; when it needs registration or parent
 * consent, families answer for each child in the app (or the office records it). Registration never
 * passes the limit — the event row is locked while counting. A paid event bills the student once
 * when the answer is "going"; that answer cannot then be withdrawn in the app (the office cancels the
 * bill). The calendar merges events, holidays, exam papers and PTM days for what the user may see.
 */
@Injectable()
export class EventsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly billing: FeeBillingService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code = PERMISSIONS.EVENT_READ as string) {
    return scopeFor(auth, code as never) ?? scopeFor(auth, PERMISSIONS.EVENT_MANAGE) ?? { all: false, campusIds: [] };
  }

  create(input: EventInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, PERMISSIONS.EVENT_MANAGE);
      if (!s) throw Forbidden('cannot-manage', 'You cannot create events');
      if (input.campusId ? !canAccessCampus(s, input.campusId) : !s.all) throw NotFound('Campus');
      const campuses = await checkTargets(tx, input.targets);
      if (input.campusId && campuses.some((c) => c && c !== input.campusId)) throw unprocessable('target-campus', 'The audience must be on the event’s campus', 'targets');
      if (input.feeHeadId && !(await tx.feeHead.findUnique({ where: { id: input.feeHeadId }, select: { id: true } }))) throw NotFound('Fee head');
      const e = await tx.event.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId ?? null, title: input.title, description: input.description ?? null, eventType: input.eventType,
          startDate: day(input.startDate), endDate: day(input.endDate), startTime: input.startTime ?? null, endTime: input.endTime ?? null, venue: input.venue ?? null,
          organiserEmployeeId: input.organiserEmployeeId ?? null, registrationRequired: input.registrationRequired, maxParticipants: input.maxParticipants ?? null, requiresConsent: input.requiresConsent,
          feeHeadId: input.feeHeadId ?? null, feeAmount: input.feeAmount ?? null, status: input.publish ? 'PUBLISHED' : 'DRAFT', createdBy: auth.userId,
        },
      });
      await tx.eventTarget.createMany({ data: input.targets.map((t) => ({ tenantId: auth.tenantId!, eventId: e.id, targetType: t.targetType, targetId: t.targetId ?? null })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId ?? null, action: 'CREATE', entityType: 'EVENT', entityId: e.id, newValues: input }, client);
      if (input.publish) await this.invite(tx, e.id);
      return { id: e.id, status: e.status };
    });
  }

  /** Families of the audience are told when an answer is needed. */
  private async invite(tx: Tx, eventId: string) {
    const e = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { targets: true } });
    if (!e.registrationRequired && !e.requiresConsent) return;
    const reached = await studentsReached(tx, e.targets);
    const students = await tx.student.findMany({ where: { id: { in: reached.map((a) => a.studentId) } }, select: { id: true, firstName: true } });
    for (const st of students) {
      const users = await familyUsers(tx, [st.id]);
      if (users.length) await this.notifications.notify(tx, { tenantId: e.tenantId, userIds: users, eventCode: 'EVENT_INVITE', vars: { title: e.title, date: iso(e.startDate)!, student: st.firstName }, entityType: 'EVENT', entityId: e.id });
    }
  }

  setStatus(id: string, status: 'PUBLISHED' | 'CANCELLED', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.manageable(tx, id, auth);
      if (e.status === status || e.status === 'CANCELLED') throw Conflict('event-state', 'The event is not in a state for that');
      await tx.event.update({ where: { id }, data: { status } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'STATUS_CHANGE', entityType: 'EVENT', entityId: id, oldValues: { status: e.status }, newValues: { status } }, client);
      if (status === 'PUBLISHED') await this.invite(tx, id);
      return { id, status };
    });
  }

  private async manageable(tx: Tx, id: string, auth: AuthContext) {
    const e = await tx.event.findUnique({ where: { id } });
    const s = scopeFor(auth, PERMISSIONS.EVENT_MANAGE);
    if (!e || !s || (e.campusId ? !canAccessCampus(s, e.campusId) : !s.all)) throw NotFound('Event');
    return e;
  }

  /** Upcoming and recent events (staff), with answers counted. */
  list(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = this.scope(auth);
      const rows = await tx.event.findMany({ where: { endDate: { gte: day(new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)) }, ...(s.all ? {} : { OR: [{ campusId: null }, { campusId: { in: s.campusIds } }] }) }, orderBy: { startDate: 'asc' }, include: { participants: { select: { response: true, attended: true } } } });
      return rows.map(({ participants, ...e }) => ({ ...this.view(e), going: participants.filter((p) => p.response === 'GOING').length, notGoing: participants.filter((p) => p.response === 'NOT_GOING').length, attended: participants.filter((p) => p.attended).length }));
    });
  }

  private view(e: { id: string; campusId: string | null; title: string; description: string | null; eventType: string; startDate: Date; endDate: Date; startTime: string | null; endTime: string | null; venue: string | null; registrationRequired: boolean; maxParticipants: number | null; requiresConsent: boolean; feeAmount: unknown; status: string }) {
    return { id: e.id, campusId: e.campusId, title: e.title, description: e.description, eventType: e.eventType, startDate: iso(e.startDate), endDate: iso(e.endDate), startTime: e.startTime, endTime: e.endTime, venue: e.venue, registrationRequired: e.registrationRequired, maxParticipants: e.maxParticipants, requiresConsent: e.requiresConsent, feeAmount: e.feeAmount == null ? null : Number(e.feeAmount).toFixed(2), status: e.status };
  }

  /** One event with every student it is for and their answer (staff). */
  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.event.findUnique({ where: { id }, include: { targets: true, participants: true } });
      const s = this.scope(auth);
      if (!e || (e.campusId ? !canAccessCampus(s, e.campusId) : !s.all)) throw NotFound('Event');
      const reached = await studentsReached(tx, e.targets);
      const studentIds = [...new Set([...reached.map((a) => a.studentId), ...e.participants.map((p) => p.studentId)])];
      const students = new Map((await tx.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((x) => [x.id, x]));
      const sections = new Map((await tx.section.findMany({ where: { id: { in: reached.map((a) => a.sectionId) } }, select: { id: true, name: true, level: { select: { name: true } } } })).map((x) => [x.id, `${x.level.name} – ${x.name}`]));
      const organiser = e.organiserEmployeeId ? await tx.employee.findUnique({ where: { id: e.organiserEmployeeId }, select: { firstName: true, lastName: true } }) : null;
      return {
        event: { ...this.view(e), organiser: organiser ? `${organiser.firstName} ${organiser.lastName ?? ''}`.trim() : null },
        canManage: !!scopeFor(auth, PERMISSIONS.EVENT_MANAGE),
        students: studentIds.map((sid) => {
          const p = e.participants.find((x) => x.studentId === sid);
          const st = students.get(sid);
          return { studentId: sid, name: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim(), admissionNo: st?.admissionNo ?? '', section: sections.get(reached.find((a) => a.studentId === sid)?.sectionId ?? '') ?? '', response: p?.response ?? null, billed: !!p?.invoiceId, attended: p?.attended ?? null };
        }).sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)),
      };
    });
  }

  /** "Going" or "not going" for one student — by the family in the app, or by the office. */
  async respondTx(tx: Tx, eventId: string, studentId: string, going: boolean, userId: string, audience: Audience | null) {
    // Lock the event so the limit is never passed when two answer at once.
    await tx.$executeRaw`SELECT id FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
    const e = await tx.event.findUnique({ where: { id: eventId }, include: { targets: true } });
    if (!e || e.status !== 'PUBLISHED' || (audience && !reaches(e.targets, audience))) throw NotFound('Event');
    if (!e.registrationRequired && !e.requiresConsent) throw Conflict('no-answer-needed', 'This event needs no reply');
    if (iso(e.startDate)! < todayIST()) throw Conflict('event-past', 'The event has already started');
    const ex = await tx.eventParticipant.findUnique({ where: { tenantId_eventId_studentId: { tenantId: e.tenantId, eventId, studentId } } });
    if (ex?.invoiceId && !going) throw Conflict('already-billed', 'This event is already billed — ask the school office to cancel it');
    if (going && ex?.response !== 'GOING' && e.maxParticipants) {
      const n = await tx.eventParticipant.count({ where: { eventId, response: 'GOING' } });
      if (n >= e.maxParticipants) throw Conflict('event-full', 'The event is full');
    }
    const response = going ? 'GOING' : 'NOT_GOING';
    const p = ex
      ? await tx.eventParticipant.update({ where: { id: ex.id }, data: { response, respondedBy: userId, respondedAt: new Date(), consentBy: e.requiresConsent && going ? userId : ex.consentBy } })
      : await tx.eventParticipant.create({ data: { tenantId: e.tenantId, eventId, studentId, response, respondedBy: userId, consentBy: e.requiresConsent && going ? userId : null } });
    let billed: string | null = null;
    if (going && e.feeAmount && e.feeHeadId && !p.invoiceId) {
      const st = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
      const inv = await this.billing.chargeInTx(tx, st, { feeHeadId: e.feeHeadId, amount: String(e.feeAmount), dueDate: iso(e.startDate)! < todayIST() ? todayIST() : iso(e.startDate)!, description: `${e.title} (${iso(e.startDate)})` }, userId);
      await tx.eventParticipant.update({ where: { id: p.id }, data: { invoiceId: inv.id } });
      billed = Number(e.feeAmount).toFixed(2);
    }
    return { eventId, studentId, response, billed };
  }

  respondAsOffice(eventId: string, studentId: string, going: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.manageable(tx, eventId, auth);
      const [a] = await audiencesOf(tx, [studentId]);
      if (!a) throw NotFound('Student');
      const r = await this.respondTx(tx, eventId, studentId, going, auth.userId, a);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'EVENT_PARTICIPANT', entityId: eventId, newValues: r }, client);
      return r;
    });
  }

  /** Attendance on the day (or after). */
  markAttendance(eventId: string, rows: { studentId: string; attended: boolean }[], auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.manageable(tx, eventId, auth);
      if (iso(e.startDate)! > todayIST()) throw Conflict('event-future', 'Attendance is taken on or after the event day');
      for (const r of rows) {
        await tx.eventParticipant.upsert({
          where: { tenantId_eventId_studentId: { tenantId: auth.tenantId!, eventId, studentId: r.studentId } },
          update: { attended: r.attended },
          create: { tenantId: auth.tenantId!, eventId, studentId: r.studentId, response: 'GOING', attended: r.attended, respondedBy: auth.userId },
        });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'EVENT_ATTENDANCE', entityId: eventId, newValues: { marked: rows.length } }, client);
      return { marked: rows.length };
    });
  }

  // ───────────── Parent app ─────────────

  /** Published events reaching the child, from 30 days ago, with the child's answer. */
  async forStudentTx(tx: Tx, studentId: string) {
    const [a] = await audiencesOf(tx, [studentId]);
    if (!a) return [];
    const rows = await tx.event.findMany({ where: { status: 'PUBLISHED', endDate: { gte: day(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)) } }, orderBy: { startDate: 'asc' }, include: { targets: true, participants: { where: { studentId } } } });
    return rows.filter((e) => reaches(e.targets, a)).map(({ participants, targets: _t, ...e }) => ({ ...this.view(e), response: participants[0]?.response ?? null, billed: !!participants[0]?.invoiceId, attended: participants[0]?.attended ?? null }));
  }

  // ───────────── Calendar ─────────────

  /** Events, holidays, exam papers and PTM days between two dates, for a viewer (staff scope or one child). */
  async calendarTx(tx: Tx, from: string, to: string, who: { audience: Audience } | { campusIds: string[] | 'ALL' }) {
    const range = { gte: day(from), lte: day(to) };
    const items: { date: string; endDate?: string; kind: 'EVENT' | 'HOLIDAY' | 'EXAM' | 'PTM'; title: string; time?: string | null; id?: string }[] = [];
    const campusOk = (c: string | null) => ('audience' in who ? !c || c === who.audience.campusId : who.campusIds === 'ALL' || !c || who.campusIds.includes(c));
    const events = await tx.event.findMany({ where: { status: 'PUBLISHED', startDate: { lte: day(to) }, endDate: { gte: day(from) } }, include: { targets: true } });
    for (const e of events) if (campusOk(e.campusId) && (!('audience' in who) || reaches(e.targets, who.audience))) items.push({ date: iso(e.startDate)!, endDate: iso(e.endDate)!, kind: 'EVENT', title: e.title, time: e.startTime, id: e.id });
    for (const h of await tx.holiday.findMany({ where: { holidayDate: range } })) if (campusOk(h.campusId)) items.push({ date: iso(h.holidayDate)!, kind: 'HOLIDAY', title: h.name });
    const papers = await tx.examSubject.findMany({ where: { status: 'ACTIVE', examDate: range, ...('audience' in who ? { programLevelId: who.audience.programLevelId } : {}) }, include: { exam: { select: { name: true, campusId: true } } } });
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: papers.map((p) => p.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    if ('audience' in who) for (const p of papers) { if (campusOk(p.exam.campusId)) items.push({ date: iso(p.examDate)!, kind: 'EXAM', title: `${p.exam.name}: ${subjects.get(p.subjectId) ?? ''}`, time: p.startTime }); }
    else for (const k of new Set(papers.filter((p) => campusOk(p.exam.campusId)).map((p) => `${iso(p.examDate)}|${p.exam.name}`))) { const [d, n] = k.split('|'); items.push({ date: d, kind: 'EXAM', title: n }); }
    const ptms = await tx.ptmSession.findMany({ where: { status: 'OPEN', ptmDate: range }, include: { levels: true } });
    for (const s of ptms) if (campusOk(s.campusId) && (!('audience' in who) || s.levels.some((l) => l.programLevelId === who.audience.programLevelId))) items.push({ date: iso(s.ptmDate)!, kind: 'PTM', title: s.title, time: s.startTime, id: s.id });
    return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
  }

  calendar(from: string, to: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => {
      const s = this.scope(auth);
      return this.calendarTx(tx, from, to, { campusIds: s.all ? 'ALL' : s.campusIds });
    });
  }
}
