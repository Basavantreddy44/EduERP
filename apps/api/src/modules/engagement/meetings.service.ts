import { Injectable } from '@nestjs/common';
import { ActionItemInput, CommitteeInput, MeetingInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { unprocessable } from './audience';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
const whenText = (d: Date) => d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/**
 * Staff meetings & minutes (M12.1). Committees have one chair; meetings invite a committee's members,
 * a department's staff or chosen staff, with an agenda. Invitees answer in the app; the organiser (or
 * the committee's secretary) records attendance and minutes; minutes are circulated, then approved by
 * the chair (or the organiser for other meetings) — after which they never change. Action items have an
 * owner and a due date; the owner or the organiser updates them.
 */
/** Active staff for pickers (name, designation, department) — no HR details. */
export async function staffOptions(tx: Tx) {
  const rows = await tx.employee.findMany({ where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: 1000, select: { id: true, firstName: true, lastName: true, designation: true, departmentId: true, campusId: true, employeeCode: true } });
  return rows.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), code: e.employeeCode, designation: e.designation, departmentId: e.departmentId, campusId: e.campusId }));
}

@Injectable()
export class MeetingsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private manager(auth: AuthContext, campusId: string | null) {
    const s = scopeFor(auth, PERMISSIONS.MEETING_MANAGE);
    return !!s && (campusId ? canAccessCampus(s, campusId) : s.all);
  }
  private async me(tx: Tx, auth: AuthContext) {
    return tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
  }

  /** Staff and departments to invite. */
  inviteOptions(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => ({ staff: await staffOptions(tx), departments: await tx.department.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) }));
  }

  // ───────────── Committees ─────────────

  committees(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.committee.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, include: { members: true } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.flatMap((r) => r.members.map((m) => m.employeeId)) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      return rows.map(({ members, ...c }) => ({ ...c, members: members.map((m) => ({ employeeId: m.employeeId, name: staff.get(m.employeeId) ?? '', memberRole: m.memberRole })).sort((a, b) => ['CHAIR', 'SECRETARY', 'MEMBER'].indexOf(a.memberRole) - ['CHAIR', 'SECRETARY', 'MEMBER'].indexOf(b.memberRole) || a.name.localeCompare(b.name)) }));
    });
  }

  saveCommittee(id: string | null, input: CommitteeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.manager(auth, input.campusId ?? null)) throw Forbidden('cannot-manage', 'You cannot manage committees');
      const clash = await tx.committee.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } });
      if (clash && clash.id !== id) throw Conflict('committee-name-taken', `${input.name} already exists`);
      if ((await tx.employee.count({ where: { id: { in: input.members.map((m) => m.employeeId) } } })) !== input.members.length) throw NotFound('Staff member');
      const c = id ? await tx.committee.update({ where: { id }, data: { name: input.name, description: input.description ?? null, campusId: input.campusId ?? null } }) : await tx.committee.create({ data: { tenantId: auth.tenantId!, name: input.name, description: input.description ?? null, campusId: input.campusId ?? null, createdBy: auth.userId } });
      if (id) await tx.$executeRaw`DELETE FROM committee_members WHERE committee_id = ${id}::uuid`;
      await tx.committeeMember.createMany({ data: input.members.map((m) => ({ tenantId: auth.tenantId!, committeeId: c.id, employeeId: m.employeeId, memberRole: m.memberRole })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'COMMITTEE', entityId: c.id, newValues: input }, client);
      return { id: c.id };
    });
  }

  // ───────────── Meetings ─────────────

  create(input: MeetingInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!this.manager(auth, input.campusId ?? null)) throw Forbidden('cannot-manage', 'You cannot schedule meetings');
      const invite = new Set(input.employeeIds);
      if (input.committeeId) {
        const c = await tx.committee.findUnique({ where: { id: input.committeeId }, include: { members: true } });
        if (!c) throw NotFound('Committee');
        c.members.forEach((m) => invite.add(m.employeeId));
      }
      if (input.departmentId) {
        if (!(await tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true } }))) throw NotFound('Department');
        (await tx.employee.findMany({ where: { departmentId: input.departmentId, status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true } })).forEach((e) => invite.add(e.id));
      }
      if (!invite.size) throw unprocessable('no-invitees', 'Choose who to invite', 'employeeIds');
      const staff = await tx.employee.findMany({ where: { id: { in: [...invite] } }, select: { id: true, userId: true } });
      if (staff.length !== invite.size) throw NotFound('Staff member');
      const m = await tx.meeting.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId ?? null, meetingType: input.meetingType, committeeId: input.committeeId ?? null, departmentId: input.departmentId ?? null, title: input.title, startAt: new Date(input.startAt), endAt: new Date(input.endAt), venue: input.venue ?? null, meetingLink: input.meetingLink ?? null, organiserUserId: auth.userId } });
      await tx.meetingParticipant.createMany({ data: [...invite].map((employeeId) => ({ tenantId: auth.tenantId!, meetingId: m.id, employeeId })) });
      if (input.agenda.length) await tx.meetingAgendaItem.createMany({ data: input.agenda.map((title, i) => ({ tenantId: auth.tenantId!, meetingId: m.id, itemNo: i + 1, title })) });
      const users = staff.map((s) => s.userId).filter((u): u is string => !!u && u !== auth.userId);
      if (users.length) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'MEETING_INVITE', vars: { title: input.title, when: whenText(m.startAt) }, entityType: 'MEETING', entityId: m.id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId ?? null, action: 'CREATE', entityType: 'MEETING', entityId: m.id, newValues: { ...input, invitees: invite.size } }, client);
      return { id: m.id, invitees: invite.size };
    });
  }

  /** Meetings I am invited to or organise (managers: all on their campuses), recent and upcoming. */
  list(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await this.me(tx, auth);
      const s = scopeFor(auth, PERMISSIONS.MEETING_MANAGE);
      const since = new Date(Date.now() - 60 * 86_400_000);
      const rows = await tx.meeting.findMany({
        where: { startAt: { gte: since }, OR: [{ organiserUserId: auth.userId }, ...(me ? [{ participants: { some: { employeeId: me.id } } }] : []), ...(s ? [s.all ? {} : { OR: [{ campusId: null }, { campusId: { in: s.campusIds } }] }] : [])] },
        orderBy: { startAt: 'asc' }, include: { participants: true, _count: { select: { actions: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } } } } },
      });
      return rows.map(({ participants, _count, ...m }) => {
        const mine = me ? participants.find((p) => p.employeeId === me.id) : null;
        return { id: m.id, title: m.title, meetingType: m.meetingType, startAt: m.startAt, endAt: m.endAt, venue: m.venue, status: m.status, minutesStatus: m.minutesStatus, invited: participants.length, accepted: participants.filter((p) => p.rsvp === 'ACCEPTED').length, myRsvp: mine?.rsvp ?? null, openActions: _count.actions };
      });
    });
  }

  private async visible(tx: Tx, id: string, auth: AuthContext) {
    const m = await tx.meeting.findUnique({ where: { id }, include: { participants: true, agenda: { orderBy: { itemNo: 'asc' } }, actions: { orderBy: { createdAt: 'asc' } } } });
    if (!m) throw NotFound('Meeting');
    const me = await this.me(tx, auth);
    const invitee = !!me && m.participants.some((p) => p.employeeId === me.id);
    const organiser = m.organiserUserId === auth.userId || this.manager(auth, m.campusId);
    if (!invitee && !organiser) throw NotFound('Meeting');
    const committee = m.committeeId ? await tx.committee.findUnique({ where: { id: m.committeeId }, include: { members: true } }) : null;
    const role = me ? committee?.members.find((x) => x.employeeId === me.id)?.memberRole ?? null : null;
    return { m, me, invitee, organiser, committee, isChair: role === 'CHAIR', isSecretary: role === 'SECRETARY' };
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.visible(tx, id, auth);
      const { m } = v;
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: [...m.participants.map((p) => p.employeeId), ...m.actions.map((a) => a.ownerEmployeeId)] } }, select: { id: true, firstName: true, lastName: true, designation: true } })).map((e) => [e.id, e]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: [m.organiserUserId, m.minutesRecordedBy, m.minutesApprovedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const canRecord = v.organiser || v.isSecretary;
      // Minutes are seen by everyone invited once circulated; drafts only by those who write them.
      const showMinutes = m.minutesStatus && (m.minutesStatus !== 'DRAFT' || canRecord);
      return {
        meeting: { id: m.id, title: m.title, meetingType: m.meetingType, startAt: m.startAt, endAt: m.endAt, venue: m.venue, meetingLink: m.meetingLink, status: m.status, organiser: users.get(m.organiserUserId) ?? '', committee: v.committee?.name ?? null },
        myEmployeeId: v.me?.id ?? null, canRecord, canApprove: m.committeeId ? v.isChair : v.organiser,
        agenda: m.agenda.map((a) => ({ itemNo: a.itemNo, title: a.title })),
        participants: m.participants.map((p) => ({ employeeId: p.employeeId, name: staff.get(p.employeeId) ? name(staff.get(p.employeeId)!) : '', designation: staff.get(p.employeeId)?.designation ?? null, rsvp: p.rsvp, attended: p.attended })).sort((a, b) => a.name.localeCompare(b.name)),
        minutes: showMinutes ? { text: m.minutesText, status: m.minutesStatus, recordedBy: m.minutesRecordedBy ? users.get(m.minutesRecordedBy) ?? null : null, approvedBy: m.minutesApprovedBy ? users.get(m.minutesApprovedBy) ?? null : null, approvedAt: m.minutesApprovedAt } : null,
        actions: m.actions.map((a) => ({ id: a.id, description: a.description, ownerEmployeeId: a.ownerEmployeeId, owner: staff.get(a.ownerEmployeeId) ? name(staff.get(a.ownerEmployeeId)!) : '', dueDate: iso(a.dueDate), status: a.status, note: a.note, overdue: ['OPEN', 'IN_PROGRESS'].includes(a.status) && iso(a.dueDate)! < todayIST() })),
      };
    });
  }

  rsvp(id: string, accept: boolean, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.visible(tx, id, auth);
      if (!v.invitee) throw Forbidden('not-invited', 'You are not invited to this meeting');
      if (v.m.status !== 'SCHEDULED' || v.m.startAt.getTime() < Date.now()) throw Conflict('meeting-started', 'The meeting has already started');
      await tx.meetingParticipant.update({ where: { tenantId_meetingId_employeeId: { tenantId: auth.tenantId!, meetingId: id, employeeId: v.me!.id } }, data: { rsvp: accept ? 'ACCEPTED' : 'DECLINED' } });
      return { rsvp: accept ? 'ACCEPTED' : 'DECLINED' };
    });
  }

  attendance(id: string, rows: { employeeId: string; attended: boolean }[], auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.visible(tx, id, auth);
      if (!v.organiser && !v.isSecretary) throw Forbidden('cannot-record', 'Only the organiser or secretary records attendance');
      if (v.m.startAt.getTime() > Date.now()) throw Conflict('meeting-future', 'Attendance is taken once the meeting starts');
      for (const r of rows) {
        if (!v.m.participants.some((p) => p.employeeId === r.employeeId)) throw NotFound('Invitee');
        await tx.meetingParticipant.update({ where: { tenantId_meetingId_employeeId: { tenantId: auth.tenantId!, meetingId: id, employeeId: r.employeeId } }, data: { attended: r.attended } });
      }
      if (v.m.status === 'SCHEDULED') await tx.meeting.update({ where: { id }, data: { status: 'COMPLETED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'MEETING_ATTENDANCE', entityId: id, newValues: { marked: rows.length } }, client);
      return { marked: rows.length };
    });
  }

  /** Write / edit the minutes (draft), circulate them, or approve them (then they never change). */
  minutes(id: string, action: 'SAVE' | 'CIRCULATE' | 'APPROVE', text: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.visible(tx, id, auth);
      const { m } = v;
      if (m.minutesStatus === 'APPROVED') throw Conflict('minutes-approved', 'Approved minutes cannot change');
      if (action === 'APPROVE') {
        if (!(m.committeeId ? v.isChair : v.organiser)) throw Forbidden('cannot-approve', m.committeeId ? 'The committee’s chair approves the minutes' : 'The organiser approves the minutes');
        if (m.minutesStatus !== 'CIRCULATED') throw Conflict('minutes-not-circulated', 'Circulate the minutes first');
        await tx.meeting.update({ where: { id }, data: { minutesStatus: 'APPROVED', minutesApprovedBy: auth.userId, minutesApprovedAt: new Date() } });
      } else {
        if (!v.organiser && !v.isSecretary) throw Forbidden('cannot-record', 'Only the organiser or secretary writes the minutes');
        if (m.startAt.getTime() > Date.now()) throw Conflict('meeting-future', 'Minutes are written once the meeting starts');
        if (action === 'SAVE') await tx.meeting.update({ where: { id }, data: { minutesText: text, minutesStatus: m.minutesStatus === 'CIRCULATED' ? 'CIRCULATED' : 'DRAFT', minutesRecordedBy: auth.userId } });
        else {
          if (!m.minutesText) throw Conflict('minutes-empty', 'Write the minutes first');
          await tx.meeting.update({ where: { id }, data: { minutesStatus: 'CIRCULATED', status: 'COMPLETED' } });
        }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'MEETING_MINUTES', entityId: id, newValues: { action } }, client);
      return { id, action };
    });
  }

  addAction(id: string, input: ActionItemInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await this.visible(tx, id, auth);
      if (!v.organiser && !v.isSecretary) throw Forbidden('cannot-record', 'Only the organiser or secretary adds action items');
      const owner = await tx.employee.findUnique({ where: { id: input.ownerEmployeeId }, select: { id: true, userId: true } });
      if (!owner) throw NotFound('Staff member');
      const a = await tx.meetingActionItem.create({ data: { tenantId: auth.tenantId!, meetingId: id, description: input.description, ownerEmployeeId: input.ownerEmployeeId, dueDate: new Date(`${input.dueDate}T00:00:00Z`), createdBy: auth.userId } });
      if (owner.userId) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: [owner.userId], eventCode: 'ACTION_ASSIGNED', vars: { description: input.description, due: input.dueDate }, entityType: 'MEETING', entityId: id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'MEETING_ACTION', entityId: a.id, newValues: input }, client);
      return { id: a.id };
    });
  }

  actionStatus(actionId: string, status: string, note: string | null, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.meetingActionItem.findUnique({ where: { id: actionId }, include: { meeting: true } });
      if (!a) throw NotFound('Action item');
      const me = await this.me(tx, auth);
      const organiser = a.meeting.organiserUserId === auth.userId || this.manager(auth, a.meeting.campusId);
      if (me?.id !== a.ownerEmployeeId && !organiser) throw Forbidden('not-your-action', 'Only the owner or the organiser updates this');
      if (status === 'CANCELLED' && !organiser) throw Forbidden('cannot-cancel', 'Only the organiser cancels an action item');
      await tx.meetingActionItem.update({ where: { id: actionId }, data: { status, note: note ?? a.note, completedAt: status === 'DONE' ? new Date() : null } });
      return { id: actionId, status };
    });
  }

  /** My open action items across meetings. */
  myActions(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await this.me(tx, auth);
      if (!me) return [];
      const rows = await tx.meetingActionItem.findMany({ where: { ownerEmployeeId: me.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { dueDate: 'asc' }, include: { meeting: { select: { id: true, title: true } } } });
      return rows.map((a) => ({ id: a.id, description: a.description, dueDate: iso(a.dueDate), status: a.status, overdue: iso(a.dueDate)! < todayIST(), meeting: a.meeting }));
    });
  }
}
