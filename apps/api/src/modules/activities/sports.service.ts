import { Injectable } from '@nestjs/common';
import { AchievementInput, ActivityInput, COMPETITION_LEVELS, CompetitionInput, MemberInput, PERMISSIONS, RESULT_TITLE } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { unprocessable } from '../accounts/books';
import { day, fullName, iso, searchPeople, tellParents } from '../campuslife/common';

type Perm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
const READ = PERMISSIONS.ACT_READ, MANAGE = PERMISSIONS.ACT_MANAGE, ADD = PERMISSIONS.ACH_ADD;
const READERS: Perm[] = [READ, MANAGE, ADD];
const LEVEL_TEXT: Record<string, string> = { INTRA: 'school level', INTER_SCHOOL: 'inter-school', ZONAL: 'zonal', DISTRICT: 'district', STATE: 'state', NATIONAL: 'national', INTERNATIONAL: 'international' };

/**
 * Sports & activities (M18.3, M18.4): sports, clubs and houses with a coordinator; members per year
 * with team and role; competitions with participants and results; achievements for students and staff,
 * verified by a coordinator before they reach the profile, the parent app, the parents and the news feed.
 */
@Injectable()
export class SportsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  can(auth: AuthContext, perm: Perm, campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  private readable(auth: AuthContext): string[] | null {
    const scopes = READERS.map((p) => scopeFor(auth, p)).filter((s): s is CampusScope => !!s);
    if (scopes.some((s) => s.all)) return null;
    return [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))];
  }
  private async activity(tx: Tx, id: string, auth: AuthContext, perm?: Perm) {
    const a = await tx.activity.findUnique({ where: { id } });
    const c = this.readable(auth);
    if (!a || (c && !c.includes(a.campusId)) || (perm && !this.can(auth, perm, a.campusId))) throw NotFound('Activity');
    return a;
  }
  private async currentYear(tx: Tx) {
    const y = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    if (!y) throw Conflict('no-current-year', 'Set the current academic year first');
    return y;
  }
  private async students(tx: Tx, ids: string[]) {
    const rows = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, enrollments: { where: { status: 'ACTIVE' }, take: 1, select: { section: { select: { name: true, level: { select: { name: true } } } } } } } });
    return new Map(rows.map((s) => [s.id, { id: s.id, name: fullName(s), admissionNo: s.admissionNo, campusId: s.campusId, className: s.enrollments[0] ? `${s.enrollments[0].section.level.name} ${s.enrollments[0].section.name}` : null }]));
  }

  // ───────────── Activities & members ─────────────

  options(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const [campuses, staff, year] = await Promise.all([
        tx.campus.findMany({ where: c ? { id: { in: c } } : {}, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.employee.findMany({ where: { ...(c ? { campusId: { in: c } } : {}), status: { notIn: ['RESIGNED', 'TERMINATED'] } }, orderBy: { firstName: 'asc' }, take: 1000, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true } }),
        tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } }),
      ]);
      return { campuses, year, staff: staff.map((e) => ({ id: e.id, name: `${fullName(e)} (${e.employeeCode})`, campusId: e.campusId })), can: { manage: !!scopeFor(auth, MANAGE), add: !!scopeFor(auth, ADD) || !!scopeFor(auth, MANAGE) } };
    });
  }

  activities(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const rows = await tx.activity.findMany({ where: c ? { campusId: { in: c } } : {}, orderBy: [{ isActive: 'desc' }, { activityType: 'asc' }, { name: 'asc' }] });
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const ids = rows.map((r) => r.id);
      const [members, comps, campus, people] = await Promise.all([
        tx.activityMember.groupBy({ by: ['activityId'], where: { activityId: { in: ids }, academicYearId: year?.id ?? '00000000-0000-0000-0000-000000000000' }, _count: { _all: true } }),
        tx.competition.groupBy({ by: ['activityId'], where: { activityId: { in: ids } }, _count: { _all: true } }),
        tx.campus.findMany({ select: { id: true, name: true } }),
        tx.employee.findMany({ where: { id: { in: rows.map((r) => r.coordinatorEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
      ]);
      return rows.map((a) => ({
        id: a.id, name: a.name, activityType: a.activityType, campusId: a.campusId, campus: campus.find((x) => x.id === a.campusId)?.name ?? '', coordinatorEmployeeId: a.coordinatorEmployeeId,
        coordinator: a.coordinatorEmployeeId ? (people.find((p) => p.id === a.coordinatorEmployeeId) ? fullName(people.find((p) => p.id === a.coordinatorEmployeeId)!) : null) : null,
        description: a.description, isActive: a.isActive, members: members.find((m) => m.activityId === a.id)?._count._all ?? 0, competitions: comps.find((m) => m.activityId === a.id)?._count._all ?? 0,
        can: { manage: this.can(auth, MANAGE, a.campusId) },
      }));
    });
  }

  saveActivity(id: string | null, input: ActivityInput, auth: AuthContext, client: ClientInfo) {
    if (!this.can(auth, MANAGE, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await this.activity(tx, id, auth, MANAGE) : null;
      if (await tx.activity.findFirst({ where: { campusId: input.campusId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists at this campus`);
      if (input.coordinatorEmployeeId && !(await tx.employee.findUnique({ where: { id: input.coordinatorEmployeeId }, select: { id: true } }))) throw unprocessable('not-found', 'Staff member not found', 'coordinatorEmployeeId');
      const data = { campusId: input.campusId, name: input.name, activityType: input.activityType, coordinatorEmployeeId: input.coordinatorEmployeeId ?? null, description: input.description, isActive: input.isActive };
      const row = old ? await tx.activity.update({ where: { id: old.id }, data }) : await tx.activity.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'ACTIVITY', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  /** One activity: members of a year (current by default) and its competitions. */
  detail(id: string, auth: AuthContext, yearId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.activity(tx, id, auth);
      const years = await tx.academicYear.findMany({ orderBy: { startDate: 'desc' }, take: 6, select: { id: true, name: true, isCurrent: true } });
      const year = yearId ? years.find((y) => y.id === yearId) : years.find((y) => y.isCurrent) ?? years[0];
      const members = year ? await tx.activityMember.findMany({ where: { activityId: a.id, academicYearId: year.id }, orderBy: [{ teamName: 'asc' }, { createdAt: 'asc' }] }) : [];
      const st = await this.students(tx, members.map((m) => m.studentId));
      const comps = await tx.competition.findMany({ where: { activityId: a.id }, orderBy: { startDate: 'desc' }, take: 100 });
      const parts = await tx.competitionParticipant.groupBy({ by: ['competitionId', 'result'], where: { competitionId: { in: comps.map((c) => c.id) } }, _count: { _all: true } });
      const coord = a.coordinatorEmployeeId ? await tx.employee.findUnique({ where: { id: a.coordinatorEmployeeId }, select: { firstName: true, lastName: true } }) : null;
      return {
        id: a.id, name: a.name, activityType: a.activityType, campusId: a.campusId, description: a.description, isActive: a.isActive, coordinator: coord ? fullName(coord) : null, coordinatorEmployeeId: a.coordinatorEmployeeId,
        years, yearId: year?.id ?? null, can: { manage: this.can(auth, MANAGE, a.campusId) },
        members: members.map((m) => ({ id: m.id, studentId: m.studentId, name: st.get(m.studentId)?.name ?? '', admissionNo: st.get(m.studentId)?.admissionNo ?? '', className: st.get(m.studentId)?.className ?? null, teamName: m.teamName, memberRole: m.memberRole })),
        competitions: comps.map((c) => {
          const p = parts.filter((x) => x.competitionId === c.id);
          const n = (r: string) => p.find((x) => x.result === r)?._count._all ?? 0;
          return { id: c.id, name: c.name, level: c.level, venue: c.venue, startDate: iso(c.startDate), endDate: iso(c.endDate), participants: p.reduce((t, x) => t + x._count._all, 0), winners: n('WINNER'), runnersUp: n('RUNNER_UP'), third: n('THIRD') };
        }),
      };
    });
  }

  addMembers(activityId: string, input: MemberInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.activity(tx, activityId, auth, MANAGE);
      const year = await this.currentYear(tx);
      const st = await this.students(tx, input.studentIds);
      let added = 0, already = 0;
      for (const sid of input.studentIds) {
        const s = st.get(sid);
        if (!s || s.campusId !== a.campusId) throw unprocessable('not-found', 'A student of this campus was not found', 'studentIds');
        const exists = await tx.activityMember.findFirst({ where: { activityId: a.id, studentId: sid, academicYearId: year.id }, select: { id: true } });
        if (exists) { already++; continue; }
        await tx.activityMember.create({ data: { tenantId: auth.tenantId!, activityId: a.id, studentId: sid, academicYearId: year.id, teamName: input.teamName, memberRole: input.memberRole, createdBy: auth.userId } });
        added++;
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'ACTIVITY_MEMBER', entityId: a.id, newValues: { activity: a.name, year: year.name, added, already, team: input.teamName, role: input.memberRole } }, client);
      return { added, already };
    });
  }

  updateMember(id: string, input: { teamName?: string | null; memberRole: string }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.activityMember.findUnique({ where: { id } });
      if (!m) throw NotFound('Member');
      const a = await this.activity(tx, m.activityId, auth, MANAGE);
      await tx.activityMember.update({ where: { id }, data: { teamName: input.teamName ?? null, memberRole: input.memberRole } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'ACTIVITY_MEMBER', entityId: id, oldValues: { teamName: m.teamName, memberRole: m.memberRole }, newValues: input }, client);
      return { id };
    });
  }

  removeMember(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.activityMember.findUnique({ where: { id } });
      if (!m) throw NotFound('Member');
      const a = await this.activity(tx, m.activityId, auth, MANAGE);
      await tx.activityMember.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'DELETE', entityType: 'ACTIVITY_MEMBER', entityId: id, oldValues: m }, client);
      return { removed: true };
    });
  }

  // ───────────── Competitions ─────────────

  saveCompetition(id: string | null, input: CompetitionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.activity(tx, input.activityId, auth, MANAGE);
      const old = id ? await tx.competition.findUnique({ where: { id } }) : null;
      if (id && (!old || old.activityId !== a.id)) throw NotFound('Competition');
      let eventId = old?.eventId ?? null;
      if (input.addToCalendar && !eventId) {
        const e = await tx.event.create({ data: { tenantId: auth.tenantId!, campusId: a.campusId, title: input.name, description: input.description, eventType: 'SPORTS', startDate: day(input.startDate), endDate: day(input.endDate), venue: input.venue, organiserEmployeeId: a.coordinatorEmployeeId, status: 'PUBLISHED', createdBy: auth.userId } });
        await tx.eventTarget.create({ data: { tenantId: auth.tenantId!, eventId: e.id, targetType: 'CAMPUS', targetId: a.campusId } });
        eventId = e.id;
      }
      const data = { activityId: a.id, name: input.name, level: input.level, venue: input.venue, startDate: day(input.startDate), endDate: day(input.endDate), description: input.description, eventId };
      const row = old ? await tx.competition.update({ where: { id: old.id }, data }) : await tx.competition.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'COMPETITION', entityId: row.id, oldValues: old ?? undefined, newValues: { ...input, eventId } }, client);
      return { id: row.id, eventId };
    });
  }

  competition(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.competition.findUnique({ where: { id } });
      if (!c) throw NotFound('Competition');
      const a = await this.activity(tx, c.activityId, auth);
      const parts = await tx.competitionParticipant.findMany({ where: { competitionId: c.id }, orderBy: [{ category: 'asc' }, { createdAt: 'asc' }] });
      const st = await this.students(tx, parts.map((p) => p.studentId));
      const ach = await tx.achievement.findMany({ where: { competitionParticipantId: { in: parts.map((p) => p.id) } }, select: { id: true, competitionParticipantId: true, isVerified: true } });
      return {
        id: c.id, name: c.name, level: c.level, venue: c.venue, startDate: iso(c.startDate), endDate: iso(c.endDate), description: c.description, eventId: c.eventId,
        activity: { id: a.id, name: a.name, activityType: a.activityType }, can: { manage: this.can(auth, MANAGE, a.campusId) },
        participants: parts.map((p) => {
          const x = ach.find((y) => y.competitionParticipantId === p.id);
          return { id: p.id, studentId: p.studentId, name: st.get(p.studentId)?.name ?? '', admissionNo: st.get(p.studentId)?.admissionNo ?? '', className: st.get(p.studentId)?.className ?? null, category: p.category, result: p.result, remarks: p.remarks, achievementId: x?.id ?? null, achievementVerified: x?.isVerified ?? false };
        }),
      };
    });
  }

  addParticipants(competitionId: string, studentIds: string[], category: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.competition.findUnique({ where: { id: competitionId } });
      if (!c) throw NotFound('Competition');
      const a = await this.activity(tx, c.activityId, auth, MANAGE);
      const st = await this.students(tx, studentIds);
      let added = 0, already = 0;
      for (const sid of studentIds) {
        const s = st.get(sid);
        if (!s || s.campusId !== a.campusId) throw unprocessable('not-found', 'A student of this campus was not found', 'studentIds');
        if (await tx.competitionParticipant.findFirst({ where: { competitionId: c.id, studentId: sid, category }, select: { id: true } })) { already++; continue; }
        await tx.competitionParticipant.create({ data: { tenantId: auth.tenantId!, competitionId: c.id, studentId: sid, category, createdBy: auth.userId } });
        added++;
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'COMPETITION_PARTICIPANT', entityId: c.id, newValues: { competition: c.name, category, added, already } }, client);
      return { added, already };
    });
  }

  private async participant(tx: Tx, id: string, auth: AuthContext) {
    const p = await tx.competitionParticipant.findUnique({ where: { id } });
    if (!p) throw NotFound('Participant');
    const c = await tx.competition.findUniqueOrThrow({ where: { id: p.competitionId } });
    const a = await this.activity(tx, c.activityId, auth, MANAGE);
    return { p, c, a };
  }

  setResult(id: string, result: string, remarks: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { p, a } = await this.participant(tx, id, auth);
      if (await tx.achievement.findFirst({ where: { competitionParticipantId: p.id, isVerified: true }, select: { id: true } })) throw Conflict('result-verified', 'A verified achievement is based on this result');
      await tx.competitionParticipant.update({ where: { id }, data: { result, remarks } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'UPDATE', entityType: 'COMPETITION_PARTICIPANT', entityId: id, oldValues: { result: p.result }, newValues: { result, remarks } }, client);
      return { result };
    });
  }

  removeParticipant(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { p, a } = await this.participant(tx, id, auth);
      if (await tx.achievement.findFirst({ where: { competitionParticipantId: p.id }, select: { id: true } })) throw Conflict('has-achievement', 'An achievement is based on this entry — remove it first');
      await tx.competitionParticipant.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'DELETE', entityType: 'COMPETITION_PARTICIPANT', entityId: id, oldValues: p }, client);
      return { removed: true };
    });
  }

  /** An achievement from a result (winner, runner-up, third, special mention), verified at once by the coordinator. */
  achievementFromResult(participantId: string, postToFeed: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { p, c, a } = await this.participant(tx, participantId, auth);
      if (p.result === 'PARTICIPATED') throw Conflict('no-result', 'Record a result (winner, runner-up, third or special mention) first');
      if (await tx.achievement.findFirst({ where: { competitionParticipantId: p.id }, select: { id: true } })) throw Conflict('already-recorded', 'This result is already an achievement');
      const title = `${RESULT_TITLE[p.result as keyof typeof RESULT_TITLE]}${p.category ? ` — ${p.category}` : ''}, ${c.name}`.slice(0, 200);
      const category = a.activityType === 'SPORT' ? 'SPORTS' : a.activityType === 'CLUB' && /ncc|nss/i.test(a.name) ? 'NCC_NSS' : a.activityType === 'CLUB' ? 'CULTURAL' : 'OTHER';
      const s = await tx.student.findUniqueOrThrow({ where: { id: p.studentId }, select: { campusId: true } });
      const row = await tx.achievement.create({ data: { tenantId: auth.tenantId!, campusId: s.campusId, studentId: p.studentId, title, category, level: c.level, achievementDate: c.endDate, competitionParticipantId: p.id, createdBy: auth.userId } });
      await this.verifyInTx(tx, row.id, postToFeed, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.campusId, action: 'CREATE', entityType: 'ACHIEVEMENT', entityId: row.id, newValues: { title, level: c.level, fromResult: p.id, verified: true, postToFeed } }, client);
      return { id: row.id, title };
    });
  }

  // ───────────── Achievements ─────────────

  achievements(auth: AuthContext, o: { status?: 'PENDING' | 'VERIFIED'; studentId?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const rows = await tx.achievement.findMany({
        where: { ...(c ? { campusId: { in: c } } : {}), ...(o.status ? { isVerified: o.status === 'VERIFIED' } : {}), ...(o.studentId ? { studentId: o.studentId } : {}) },
        orderBy: [{ achievementDate: 'desc' }, { createdAt: 'desc' }], take: 300,
      });
      const st = await this.students(tx, rows.map((r) => r.studentId).filter((x): x is string => !!x));
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((e) => [e.id, e]));
      return rows.map((r) => {
        const s = r.studentId ? st.get(r.studentId) : null;
        const e = r.employeeId ? staff.get(r.employeeId) : null;
        return {
          id: r.id, studentId: r.studentId, employeeId: r.employeeId, person: s ? s.name : e ? fullName(e) : '', personDetail: s ? [s.admissionNo, s.className].filter(Boolean).join(' · ') : e ? e.employeeCode : '', kind: s ? 'STUDENT' : 'STAFF',
          title: r.title, category: r.category, level: r.level, achievementDate: iso(r.achievementDate), description: r.description, isVerified: r.isVerified, onFeed: !!r.feedPostId, fromResult: !!r.competitionParticipantId,
          can: { verify: !r.isVerified && this.can(auth, MANAGE, r.campusId), remove: !r.isVerified && (r.createdBy === auth.userId || this.can(auth, MANAGE, r.campusId)) },
        };
      });
    });
  }

  addAchievement(input: AchievementInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      let campusId: string;
      if (input.studentId) { const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { campusId: true } }); if (!s) throw unprocessable('not-found', 'Student not found', 'studentId'); campusId = s.campusId; }
      else { const e = await tx.employee.findUnique({ where: { id: input.employeeId! }, select: { campusId: true } }); if (!e) throw unprocessable('not-found', 'Staff member not found', 'employeeId'); campusId = e.campusId; }
      const coordinator = this.can(auth, MANAGE, campusId);
      if (!coordinator && !this.can(auth, ADD, campusId)) throw NotFound('Campus');
      const row = await tx.achievement.create({ data: { tenantId: auth.tenantId!, campusId, studentId: input.studentId ?? null, employeeId: input.employeeId ?? null, title: input.title, category: input.category, level: input.level, achievementDate: day(input.achievementDate), description: input.description, createdBy: auth.userId } });
      if (coordinator) await this.verifyInTx(tx, row.id, false, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'CREATE', entityType: 'ACHIEVEMENT', entityId: row.id, newValues: { ...input, verified: coordinator } }, client);
      return { id: row.id, isVerified: coordinator };
    });
  }

  verify(id: string, postToFeed: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.achievement.findUnique({ where: { id } });
      if (!r || !this.can(auth, MANAGE, r.campusId)) throw NotFound('Achievement');
      if (r.isVerified) throw Conflict('already-verified', 'This achievement is already verified');
      await this.verifyInTx(tx, id, postToFeed, auth);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'STATUS_CHANGE', entityType: 'ACHIEVEMENT', entityId: id, newValues: { verified: true, postToFeed } }, client);
      return { isVerified: true };
    });
  }

  /** Marks verified, tells the student's parents and (optionally) posts it to the school news feed. */
  private async verifyInTx(tx: Tx, id: string, postToFeed: boolean, auth: AuthContext) {
    const r = await tx.achievement.update({ where: { id }, data: { isVerified: true, verifiedBy: auth.userId, verifiedAt: new Date() } });
    const level = LEVEL_TEXT[r.level] ?? r.level.toLowerCase();
    let who = '';
    if (r.studentId) {
      const s = await tx.student.findUniqueOrThrow({ where: { id: r.studentId }, select: { firstName: true, lastName: true } });
      who = fullName(s);
      await tellParents(tx, this.notifications, { tenantId: r.tenantId, senderUserId: auth.userId, studentId: r.studentId, eventCode: 'ACHIEVEMENT', vars: { student: who, title: r.title, level }, emailSubject: `Well done, ${who}!`, emailBody: `Dear parent,\n\nWe are happy to share that ${who} has achieved: ${r.title} (${level}).\n\nIt is now on ${who}’s record in the parent app.`, entityType: 'ACHIEVEMENT', entityId: r.id });
    } else if (r.employeeId) {
      const e = await tx.employee.findUniqueOrThrow({ where: { id: r.employeeId }, select: { firstName: true, lastName: true } });
      who = fullName(e);
    }
    if (postToFeed && !r.feedPostId) {
      const p = await tx.feedPost.create({ data: { tenantId: r.tenantId, authorUserId: auth.userId, postType: 'ACHIEVEMENT', title: `Congratulations, ${who}!`.slice(0, 200), body: `${who}: ${r.title} (${level}).${r.description ? `\n\n${r.description}` : ''}`, fileIds: [], allowComments: true, status: 'PUBLISHED', publishedAt: new Date(), approvedBy: auth.userId } });
      await tx.feedPostTarget.create({ data: { tenantId: r.tenantId, postId: p.id, targetType: 'CAMPUS', targetId: r.campusId } });
      await tx.achievement.update({ where: { id: r.id }, data: { feedPostId: p.id } });
    }
  }

  removeAchievement(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.achievement.findUnique({ where: { id } });
      if (!r || !(r.createdBy === auth.userId || this.can(auth, MANAGE, r.campusId))) throw NotFound('Achievement');
      if (r.isVerified) throw Conflict('achievement-verified', 'A verified achievement cannot be removed');
      await tx.achievement.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'DELETE', entityType: 'ACHIEVEMENT', entityId: id, oldValues: r }, client);
      return { removed: true };
    });
  }

  // ───────────── Student record, parent app, reports ─────────────

  /** A student's activities this year, competition entries and verified achievements. */
  async forStudentTx(tx: Tx, studentId: string) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const members = await tx.activityMember.findMany({ where: { studentId, ...(year ? { academicYearId: year.id } : {}) } });
    const acts = new Map((await tx.activity.findMany({ where: { id: { in: members.map((m) => m.activityId) } }, select: { id: true, name: true, activityType: true } })).map((a) => [a.id, a]));
    const parts = await tx.competitionParticipant.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const comps = new Map((await tx.competition.findMany({ where: { id: { in: parts.map((p) => p.competitionId) } }, select: { id: true, name: true, level: true, startDate: true } })).map((c) => [c.id, c]));
    const ach = await tx.achievement.findMany({ where: { studentId, isVerified: true }, orderBy: { achievementDate: 'desc' }, take: 100 });
    return {
      activities: members.map((m) => ({ id: m.id, name: acts.get(m.activityId)?.name ?? '', activityType: acts.get(m.activityId)?.activityType ?? 'CLUB', teamName: m.teamName, memberRole: m.memberRole })),
      competitions: parts.map((p) => ({ id: p.id, name: comps.get(p.competitionId)?.name ?? '', level: comps.get(p.competitionId)?.level ?? 'INTRA', date: iso(comps.get(p.competitionId)?.startDate), category: p.category, result: p.result })),
      achievements: ach.map((a) => ({ id: a.id, title: a.title, category: a.category, level: a.level, achievementDate: iso(a.achievementDate), description: a.description })),
    };
  }

  forStudent(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      const ok = s && (READERS.some((p) => this.can(auth, p, s.campusId)) || this.can(auth, PERMISSIONS.STU_STUDENT_READ as Perm, s.campusId));
      if (!ok) throw NotFound('Student');
      return this.forStudentTx(tx, studentId);
    });
  }

  forChild(studentId: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(studentId)) throw NotFound('Student');
    return this.db.run(this.ctx(auth), (tx) => this.forStudentTx(tx, studentId));
  }

  /** Participation and medals by activity and level for a period. */
  report(auth: AuthContext, o: { from?: string; to?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const acts = await tx.activity.findMany({ where: c ? { campusId: { in: c } } : {}, select: { id: true, name: true, activityType: true } });
      const comps = await tx.competition.findMany({ where: { activityId: { in: acts.map((a) => a.id) }, ...(o.from || o.to ? { startDate: { ...(o.from ? { gte: day(o.from) } : {}), ...(o.to ? { lte: day(o.to) } : {}) } } : {}) }, select: { id: true, activityId: true, level: true } });
      const parts = await tx.competitionParticipant.findMany({ where: { competitionId: { in: comps.map((x) => x.id) } }, select: { competitionId: true, result: true, studentId: true } });
      const rows = acts.map((a) => {
        const mine = comps.filter((x) => x.activityId === a.id);
        const ps = parts.filter((p) => mine.some((m) => m.id === p.competitionId));
        const byLevel = Object.fromEntries(COMPETITION_LEVELS.map((l) => [l, ps.filter((p) => mine.find((m) => m.id === p.competitionId)?.level === l && ['WINNER', 'RUNNER_UP', 'THIRD'].includes(p.result)).length]));
        return { activityId: a.id, activity: a.name, activityType: a.activityType, competitions: mine.length, entries: ps.length, students: new Set(ps.map((p) => p.studentId)).size, gold: ps.filter((p) => p.result === 'WINNER').length, silver: ps.filter((p) => p.result === 'RUNNER_UP').length, bronze: ps.filter((p) => p.result === 'THIRD').length, medalsByLevel: byLevel };
      }).filter((r) => r.competitions > 0).sort((a, b) => b.gold - a.gold || b.entries - a.entries);
      const verified = await tx.achievement.count({ where: { ...(c ? { campusId: { in: c } } : {}), isVerified: true, ...(o.from || o.to ? { achievementDate: { ...(o.from ? { gte: day(o.from) } : {}), ...(o.to ? { lte: day(o.to) } : {}) } } : {}) } });
      return { rows, totals: { competitions: rows.reduce((t, r) => t + r.competitions, 0), entries: rows.reduce((t, r) => t + r.entries, 0), gold: rows.reduce((t, r) => t + r.gold, 0), silver: rows.reduce((t, r) => t + r.silver, 0), bronze: rows.reduce((t, r) => t + r.bronze, 0), achievements: verified } };
    });
  }

  people(auth: AuthContext, q: string, kinds: ('STUDENT' | 'EMPLOYEE')[]) {
    const c = this.readable(auth);
    return this.db.run(this.ctx(auth), (tx) => searchPeople(tx, q, c, kinds));
  }
}
