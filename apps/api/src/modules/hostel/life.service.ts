import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DecisionInput, HomeGoingInput, MaintenanceInput, OutpassInput, PERMISSIONS, SaveRollCallInput, UpdateMaintenanceInput, VisitorInput,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { HostelSetupService } from './setup.service';

const WARDEN = PERMISSIONS.HOSTEL_WARDEN;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const when = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const digits = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-10);

/**
 * Daily hostel life (M7.3): night roll-call (parents of absent students alerted once — in-app and
 * by email; SMS / WhatsApp coming soon), outpasses (parent and warden must both approve before the
 * student goes out), the home-going register (pickup person checked against the guardians), the
 * visitors log and maintenance requests.
 */
@Injectable()
export class HostelLifeService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly setup: HostelSetupService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** The student's current hostel (checked in) — required for every daily-life record. */
  private async resident(tx: Tx, studentId: string, auth: AuthContext, code = WARDEN) {
    const rows = await tx.$queryRaw<{ allotment_id: string; hostel_id: string; campus_id: string; hostel_name: string; room_no: string; bed_no: string; first_name: string; last_name: string | null; admission_no: string }[]>`
      SELECT a.id AS allotment_id, h.id AS hostel_id, h.campus_id, h.name AS hostel_name, r.room_no, b.bed_no, s.first_name, s.last_name, s.admission_no
        FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id JOIN hostels h ON h.id = r.hostel_id JOIN students s ON s.id = a.student_id
       WHERE a.student_id = ${studentId}::uuid AND a.status = 'CHECKED_IN'`;
    const r = rows[0];
    if (!r || !canAccessCampus(this.setup.scope(auth, code), r.campus_id)) throw NotFound('Hostel resident');
    return { ...r, name: `${r.first_name} ${r.last_name ?? ''}`.trim() };
  }

  /** People who can act for a student in the parent app (guardians with a login). */
  private async parentUsers(tx: Tx, studentId: string) {
    return (await tx.studentGuardian.findMany({ where: { studentId, guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } })).map((g) => g.guardian.userId!);
  }

  // ───────────── Night roll-call ─────────────

  /** Residents on that night, with their mark (saved, or prefilled: on outpass / home-going / present). */
  rollCall(hostelId: string, date: string, auth: AuthContext) {
    if (date > todayIST()) throw unprocessable('date-in-future', 'Roll-call cannot be taken for a future night', 'date');
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.setup.hostelOf(tx, hostelId, auth);
      const residents = await tx.$queryRaw<{ student_id: string; name: string; admission_no: string; room_no: string; bed_no: string }[]>`
        SELECT s.id AS student_id, trim(s.first_name || ' ' || coalesce(s.last_name, '')) AS name, s.admission_no, r.room_no, b.bed_no
          FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id JOIN students s ON s.id = a.student_id
         WHERE r.hostel_id = ${hostelId}::uuid AND a.status IN ('CHECKED_IN', 'VACATED')
           AND a.check_in_date <= ${date}::date AND (a.check_out_date IS NULL OR a.check_out_date > ${date}::date)
         ORDER BY r.room_no, b.bed_no`;
      const ids = residents.map((r) => r.student_id);
      const marks = new Map((await tx.hostelRollCall.findMany({ where: { studentId: { in: ids }, attendanceDate: day(date) } })).map((m) => [m.studentId, m]));
      const night = new Date(`${date}T21:00:00+05:30`);
      const out = new Set((await tx.hostelOutpass.findMany({ where: { studentId: { in: ids }, status: { in: ['APPROVED', 'OUT'] }, outTime: { lte: night }, expectedReturn: { gte: night } }, select: { studentId: true } })).map((o) => o.studentId));
      const home = new Set((await tx.hostelHomeGoing.findMany({ where: { studentId: { in: ids }, status: { in: ['APPROVED', 'DEPARTED'] }, fromDate: { lte: day(date) }, toDate: { gte: day(date) } }, select: { studentId: true } })).map((o) => o.studentId));
      return {
        hostel: { id: h.id, name: h.name }, date, saved: marks.size > 0,
        students: residents.map((r) => {
          const m = marks.get(r.student_id);
          return { studentId: r.student_id, name: r.name, admissionNo: r.admission_no, roomNo: r.room_no, bedNo: r.bed_no, status: m?.status ?? (home.has(r.student_id) ? 'ON_LEAVE' : out.has(r.student_id) ? 'ON_OUTPASS' : 'PRESENT'), saved: !!m, remarks: m?.remarks ?? null, parentNotified: m?.parentNotified ?? false };
        }),
      };
    });
  }

  saveRollCall(input: SaveRollCallInput, auth: AuthContext, client: ClientInfo) {
    if (input.date > todayIST()) throw unprocessable('date-in-future', 'Roll-call cannot be taken for a future night', 'date');
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.setup.hostelOf(tx, input.hostelId, auth, WARDEN);
      const allowed = new Set((await tx.$queryRaw<{ student_id: string }[]>`
        SELECT a.student_id FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
         WHERE r.hostel_id = ${input.hostelId}::uuid AND a.status IN ('CHECKED_IN', 'VACATED')
           AND a.check_in_date <= ${input.date}::date AND (a.check_out_date IS NULL OR a.check_out_date > ${input.date}::date)`).map((r) => r.student_id));
      for (const r of input.records) if (!allowed.has(r.studentId)) throw unprocessable('not-resident', 'A student on the list does not stay in this hostel that night', 'records');
      for (const r of input.records) {
        await tx.hostelRollCall.upsert({
          where: { tenantId_studentId_attendanceDate: { tenantId: auth.tenantId!, studentId: r.studentId, attendanceDate: day(input.date) } },
          create: { tenantId: auth.tenantId!, hostelId: h.id, studentId: r.studentId, attendanceDate: day(input.date), status: r.status, remarks: r.remarks ?? null, markedBy: auth.userId },
          update: { status: r.status, remarks: r.remarks ?? null, markedBy: auth.userId },
        });
      }
      // Parents of absent students: once per student per night, tonight only.
      let alerted = 0;
      if (input.date === todayIST()) {
        const absent = input.records.filter((r) => r.status === 'ABSENT').map((r) => r.studentId);
        const fresh = await tx.hostelRollCall.findMany({ where: { studentId: { in: absent }, attendanceDate: day(input.date), parentNotified: false }, select: { studentId: true } });
        for (const { studentId } of fresh) {
          const s = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true, lastName: true, guardians: { where: { isPrimary: true }, select: { guardian: { select: { email: true, userId: true } } } } } });
          const name = `${s.firstName} ${s.lastName ?? ''}`.trim();
          const users = await this.parentUsers(tx, studentId);
          if (users.length) {
            await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'HOSTEL_ABSENT', vars: { student: name, hostel: h.name, date: pretty(input.date) }, entityType: 'STUDENT', entityId: studentId });
          } else if (s.guardians[0]?.guardian.email) {
            await this.notifications.emailExternal(tx, {
              tenantId: auth.tenantId!, senderUserId: auth.userId, to: s.guardians[0].guardian.email, eventCode: 'HOSTEL_ABSENT', entityType: 'STUDENT', entityId: studentId,
              subject: `${name} was absent at the hostel roll-call`,
              body: `Dear parent,\n\n${name} was not in ${h.name} at the night roll-call on ${pretty(input.date)}.\n\nPlease contact the hostel warden.`,
            });
          } else continue;
          await tx.hostelRollCall.updateMany({ where: { studentId, attendanceDate: day(input.date) }, data: { parentNotified: true } });
          alerted += 1;
        }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'UPDATE', entityType: 'HOSTEL_ROLL_CALL', entityId: h.id, newValues: { date: input.date, marked: input.records.length, absent: input.records.filter((r) => r.status === 'ABSENT').length, alerted } }, client);
      return { saved: input.records.length, alerted };
    });
  }

  // ───────────── Outpasses ─────────────

  requestOutpass(input: OutpassInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.resident(tx, input.studentId, auth);
      if (await tx.hostelOutpass.findFirst({ where: { studentId: input.studentId, status: { in: ['REQUESTED', 'APPROVED', 'OUT'] } }, select: { id: true } })) {
        throw Conflict('outpass-open', `${r.name} already has an outpass that is not closed`);
      }
      const o = await tx.hostelOutpass.create({
        data: { tenantId: auth.tenantId!, hostelId: r.hostel_id, studentId: input.studentId, outTime: new Date(input.outTime), expectedReturn: new Date(input.expectedReturn), destination: input.destination, reason: input.reason, requestedBy: auth.userId },
      });
      const users = await this.parentUsers(tx, input.studentId);
      await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: users, eventCode: 'HOSTEL_OUTPASS', vars: { student: r.name, destination: input.destination, outTime: when(o.outTime), expectedReturn: when(o.expectedReturn) }, entityType: 'HOSTEL_OUTPASS', entityId: o.id });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campus_id, action: 'CREATE', entityType: 'HOSTEL_OUTPASS', entityId: o.id, newValues: input }, client);
      return { ...o, parentHasLogin: users.length > 0 };
    });
  }

  private async outpass(tx: Tx, id: string, auth: AuthContext) {
    const o = await tx.hostelOutpass.findUnique({ where: { id } });
    const h = o && (await tx.hostel.findUnique({ where: { id: o.hostelId }, select: { campusId: true } }));
    if (!o || !h || !canAccessCampus(this.setup.scope(auth, WARDEN), h.campusId)) throw NotFound('Outpass');
    return { o, campusId: h.campusId };
  }

  /** Both approvals given → APPROVED; any refusal → REJECTED. */
  private settle(parent: string, warden: string) {
    return parent === 'REJECTED' || warden === 'REJECTED' ? 'REJECTED' : parent === 'APPROVED' && warden === 'APPROVED' ? 'APPROVED' : 'REQUESTED';
  }

  /** The warden's decision. `parentByPhone` records the parent's answer taken by phone (remarks required). */
  wardenDecide(id: string, input: DecisionInput & { parentByPhone?: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { o, campusId } = await this.outpass(tx, id, auth);
      if (o.status !== 'REQUESTED') throw Conflict('outpass-decided', `This outpass is already ${o.status.toLowerCase()}`);
      const data: Record<string, unknown> = {};
      if (input.parentByPhone) {
        if (!input.remarks) throw unprocessable('remarks-required', 'Write whom you spoke to and when', 'remarks');
        data.parentApproval = input.approve ? 'APPROVED' : 'REJECTED';
        data.parentApprovedBy = auth.userId;
      } else {
        data.wardenApproval = input.approve ? 'APPROVED' : 'REJECTED';
        data.wardenApprovedBy = auth.userId;
      }
      data.remarks = input.remarks ?? o.remarks;
      const parent = (data.parentApproval as string) ?? o.parentApproval;
      const warden = (data.wardenApproval as string) ?? o.wardenApproval;
      const after = await tx.hostelOutpass.update({ where: { id }, data: { ...data, status: this.settle(parent, warden) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'UPDATE', entityType: 'HOSTEL_OUTPASS', entityId: id, oldValues: { status: o.status }, newValues: { ...data, status: after.status } }, client);
      return after;
    });
  }

  /** The parent's decision from the parent app (only for their own child). */
  parentDecide(id: string, input: DecisionInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const o = await tx.hostelOutpass.findUnique({ where: { id } });
      if (!o || !(auth.portalStudentIds ?? []).includes(o.studentId)) throw NotFound('Outpass');
      if (!(await this.parentUsers(tx, o.studentId)).includes(auth.userId)) throw Forbidden('not-guardian', 'Only a parent of the student can decide');
      if (o.status !== 'REQUESTED' || o.parentApproval !== 'PENDING') throw Conflict('outpass-decided', 'This outpass has already been decided');
      const parentApproval = input.approve ? 'APPROVED' : 'REJECTED';
      const after = await tx.hostelOutpass.update({ where: { id }, data: { parentApproval, parentApprovedBy: auth.userId, status: this.settle(parentApproval, o.wardenApproval) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'HOSTEL_OUTPASS', entityId: id, oldValues: { parentApproval: 'PENDING' }, newValues: { parentApproval, remarks: input.remarks ?? null } });
      return after;
    });
  }

  /** Gate: the student leaves (only an approved outpass) and comes back (late if after the expected time). */
  gate(id: string, move: 'OUT' | 'BACK', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { o, campusId } = await this.outpass(tx, id, auth);
      const now = new Date();
      let data: Record<string, unknown>;
      if (move === 'OUT') {
        if (o.status !== 'APPROVED') throw Conflict('outpass-not-approved', o.parentApproval !== 'APPROVED' ? 'The parent has not approved this outpass yet' : 'The warden has not approved this outpass yet');
        data = { status: 'OUT', actualOut: now };
      } else {
        if (o.status !== 'OUT') throw Conflict('not-out', 'The student has not gone out on this outpass');
        data = { status: now > o.expectedReturn ? 'LATE_RETURN' : 'RETURNED', actualReturn: now };
      }
      const after = await tx.hostelOutpass.update({ where: { id }, data });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_OUTPASS', entityId: id, oldValues: { status: o.status }, newValues: data }, client);
      return after;
    });
  }

  cancelOutpass(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { o, campusId } = await this.outpass(tx, id, auth);
      if (!['REQUESTED', 'APPROVED'].includes(o.status)) throw Conflict('outpass-closed', `This outpass is already ${o.status.toLowerCase()}`);
      const after = await tx.hostelOutpass.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_OUTPASS', entityId: id, oldValues: { status: o.status }, newValues: { status: 'CANCELLED' } }, client);
      return after;
    });
  }

  outpasses(hostelId: string, status: string | undefined, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.setup.hostelOf(tx, hostelId, auth);
      const rows = await tx.hostelOutpass.findMany({ where: { hostelId, ...(status ? { status } : {}) }, orderBy: { outTime: 'desc' }, take: 200 });
      const names = await this.studentNames(tx, rows.map((r) => r.studentId));
      return rows.map((r) => ({ ...r, student: names.get(r.studentId) ?? null }));
    });
  }

  private async studentNames(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, { name: string; admissionNo: string }>();
    const rows = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } });
    return new Map(rows.map((s) => [s.id, { name: `${s.firstName} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo }]));
  }

  // ───────────── Home-going register ─────────────

  requestHomeGoing(input: HomeGoingInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await this.resident(tx, input.studentId, auth);
      if (input.pickupGuardianId && !(await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: input.studentId, guardianId: input.pickupGuardianId } }, select: { studentId: true } }))) {
        throw unprocessable('not-a-guardian', 'This person is not a guardian of the student', 'pickupGuardianId');
      }
      const clash = await tx.hostelHomeGoing.findFirst({ where: { studentId: input.studentId, status: { in: ['REQUESTED', 'APPROVED', 'DEPARTED'] }, fromDate: { lte: day(input.toDate) }, toDate: { gte: day(input.fromDate) } }, select: { id: true } });
      if (clash) throw Conflict('home-going-overlap', 'There is already a home-going for these days');
      const g = await tx.hostelHomeGoing.create({
        data: {
          tenantId: auth.tenantId!, hostelId: r.hostel_id, studentId: input.studentId, fromDate: day(input.fromDate), toDate: day(input.toDate), reason: input.reason,
          pickupGuardianId: input.pickupGuardianId ?? null, pickupPersonName: input.pickupGuardianId ? null : input.pickupPersonName ?? null, pickupPersonPhone: input.pickupGuardianId ? null : input.pickupPersonPhone ?? null, requestedBy: auth.userId,
        },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campus_id, action: 'CREATE', entityType: 'HOSTEL_HOME_GOING', entityId: g.id, newValues: input }, client);
      return g;
    });
  }

  private async homeGoing(tx: Tx, id: string, auth: AuthContext) {
    const g = await tx.hostelHomeGoing.findUnique({ where: { id } });
    const h = g && (await tx.hostel.findUnique({ where: { id: g.hostelId }, select: { campusId: true } }));
    if (!g || !h || !canAccessCampus(this.setup.scope(auth, WARDEN), h.campusId)) throw NotFound('Home-going');
    return { g, campusId: h.campusId };
  }

  /** The warden approves or refuses. Someone who is not a guardian on record needs `confirmUnlistedPickup`. */
  decideHomeGoing(id: string, input: DecisionInput & { confirmUnlistedPickup?: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { g, campusId } = await this.homeGoing(tx, id, auth);
      if (g.status !== 'REQUESTED') throw Conflict('home-going-decided', `This home-going is already ${g.status.toLowerCase()}`);
      if (input.approve && !g.pickupGuardianId && !input.confirmUnlistedPickup) {
        throw Conflict('unlisted-pickup', `${g.pickupPersonName} is not a guardian on record — confirm that you have checked with the parents`);
      }
      const status = input.approve ? 'APPROVED' : 'REJECTED';
      const after = await tx.hostelHomeGoing.update({ where: { id }, data: { status, decidedBy: auth.userId, remarks: input.remarks ?? null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'UPDATE', entityType: 'HOSTEL_HOME_GOING', entityId: id, oldValues: { status: g.status }, newValues: { status, unlistedPickupConfirmed: !!input.confirmUnlistedPickup, remarks: input.remarks ?? null } }, client);
      return after;
    });
  }

  /** At the gate: leaving (pickup person seen and checked) and returning. */
  homeGoingGate(id: string, move: 'DEPART' | 'RETURN', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const { g, campusId } = await this.homeGoing(tx, id, auth);
      let data: Record<string, unknown>;
      if (move === 'DEPART') {
        if (g.status !== 'APPROVED') throw Conflict('home-going-not-approved', 'This home-going is not approved');
        data = { status: 'DEPARTED', departedAt: new Date(), pickupVerifiedBy: auth.userId };
      } else {
        if (g.status !== 'DEPARTED') throw Conflict('not-departed', 'The student has not left on this home-going');
        data = { status: 'RETURNED', returnedAt: new Date() };
      }
      const after = await tx.hostelHomeGoing.update({ where: { id }, data });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_HOME_GOING', entityId: id, oldValues: { status: g.status }, newValues: data }, client);
      return after;
    });
  }

  homeGoings(hostelId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.setup.hostelOf(tx, hostelId, auth);
      const rows = await tx.hostelHomeGoing.findMany({ where: { hostelId }, orderBy: { fromDate: 'desc' }, take: 200 });
      const names = await this.studentNames(tx, rows.map((r) => r.studentId));
      const gids = rows.map((r) => r.pickupGuardianId).filter((x): x is string => !!x);
      const gs = new Map((await tx.guardian.findMany({ where: { id: { in: gids } }, select: { id: true, name: true, phone: true } })).map((g) => [g.id, g]));
      return rows.map((r) => ({ ...r, fromDate: iso(r.fromDate), toDate: iso(r.toDate), student: names.get(r.studentId) ?? null, pickupGuardian: r.pickupGuardianId ? gs.get(r.pickupGuardianId) ?? null : null }));
    });
  }

  // ───────────── Visitors ─────────────

  visitorIn(input: VisitorInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.setup.hostelOf(tx, input.hostelId, auth, WARDEN);
      const r = await this.resident(tx, input.studentId, auth);
      if (r.hostel_id !== h.id) throw unprocessable('not-resident', 'The student does not stay in this hostel', 'studentId');
      const guardians = await tx.studentGuardian.findMany({ where: { studentId: input.studentId }, select: { guardian: { select: { phone: true } } } });
      const isAuthorisedGuardian = guardians.some((g) => digits(g.guardian.phone) === digits(input.phone));
      const v = await tx.hostelVisitor.create({ data: { tenantId: auth.tenantId!, hostelId: h.id, studentId: input.studentId, visitorName: input.visitorName, relation: input.relation, phone: input.phone, isAuthorisedGuardian, recordedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'CREATE', entityType: 'HOSTEL_VISITOR', entityId: v.id, newValues: { ...input, isAuthorisedGuardian } }, client);
      return v;
    });
  }

  visitorOut(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.hostelVisitor.findUnique({ where: { id } });
      if (!v) throw NotFound('Visitor');
      await this.setup.hostelOf(tx, v.hostelId, auth, WARDEN);
      if (v.outTime) throw Conflict('visitor-left', 'This visitor has already left');
      return tx.hostelVisitor.update({ where: { id }, data: { outTime: new Date() } });
    });
  }

  visitors(hostelId: string, date: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.setup.hostelOf(tx, hostelId, auth);
      const from = new Date(`${date}T00:00:00+05:30`);
      const rows = await tx.hostelVisitor.findMany({ where: { hostelId, inTime: { gte: from, lt: new Date(from.getTime() + 86_400_000) } }, orderBy: { inTime: 'desc' } });
      const names = await this.studentNames(tx, rows.map((r) => r.studentId));
      return rows.map((r) => ({ ...r, student: names.get(r.studentId) ?? null }));
    });
  }

  // ───────────── Maintenance ─────────────

  raise(input: MaintenanceInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.setup.hostelOf(tx, input.hostelId, auth, WARDEN);
      if (input.roomId && !(await tx.hostelRoom.findFirst({ where: { id: input.roomId, hostelId: h.id }, select: { id: true } }))) throw unprocessable('room-other-hostel', 'Choose a room of this hostel', 'roomId');
      const m = await tx.hostelMaintenance.create({ data: { tenantId: auth.tenantId!, hostelId: h.id, roomId: input.roomId ?? null, raisedBy: auth.userId, category: input.category, description: input.description, priority: input.priority } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'CREATE', entityType: 'HOSTEL_MAINTENANCE', entityId: m.id, newValues: input }, client);
      return m;
    });
  }

  updateMaintenance(id: string, input: UpdateMaintenanceInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.hostelMaintenance.findUnique({ where: { id } });
      if (!m) throw NotFound('Request');
      const h = await this.setup.hostelOf(tx, m.hostelId, auth, WARDEN);
      if (input.assignedToEmployeeId) {
        const e = await tx.employee.findUnique({ where: { id: input.assignedToEmployeeId }, select: { campusId: true, status: true } });
        if (!e || e.campusId !== h.campusId || e.status === 'LEFT') throw unprocessable('staff-invalid', 'Choose a current staff member of this campus', 'assignedToEmployeeId');
      }
      if (m.status === 'CLOSED') throw Conflict('request-closed', 'This request is closed');
      const status = input.status ?? (input.assignedToEmployeeId && m.status === 'OPEN' ? 'ASSIGNED' : m.status);
      const after = await tx.hostelMaintenance.update({
        where: { id },
        data: { status, assignedToEmployeeId: input.assignedToEmployeeId === undefined ? m.assignedToEmployeeId : input.assignedToEmployeeId, remarks: input.remarks ?? m.remarks, resolvedAt: status === 'RESOLVED' && !m.resolvedAt ? new Date() : m.resolvedAt },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'UPDATE', entityType: 'HOSTEL_MAINTENANCE', entityId: id, oldValues: { status: m.status }, newValues: { ...input, status } }, client);
      return after;
    });
  }

  maintenance(hostelId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.setup.hostelOf(tx, hostelId, auth);
      const rows = await tx.hostelMaintenance.findMany({ where: { hostelId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
      const rooms = new Map((await tx.hostelRoom.findMany({ where: { id: { in: rows.map((r) => r.roomId).filter((x): x is string => !!x) } }, select: { id: true, roomNo: true } })).map((r) => [r.id, r.roomNo]));
      const staff = await this.setup.staffNames(tx, rows.map((r) => r.assignedToEmployeeId).filter((x): x is string => !!x));
      return rows.map((r) => ({ ...r, roomNo: r.roomId ? rooms.get(r.roomId) ?? null : null, assignedTo: r.assignedToEmployeeId ? staff.get(r.assignedToEmployeeId) ?? null : null }));
    });
  }

  /** For the parent app: the child's stay, last 7 nights, open outpasses and home-goings. */
  async forParent(tx: Tx, studentId: string) {
    const nights = await tx.hostelRollCall.findMany({ where: { studentId }, orderBy: { attendanceDate: 'desc' }, take: 7, select: { attendanceDate: true, status: true } });
    const outpasses = await tx.hostelOutpass.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 10 });
    const homeGoings = await tx.hostelHomeGoing.findMany({ where: { studentId }, orderBy: { fromDate: 'desc' }, take: 5 });
    return {
      nights: nights.map((n) => ({ date: iso(n.attendanceDate), status: n.status })),
      outpasses: outpasses.map((o) => ({ id: o.id, destination: o.destination, reason: o.reason, outTime: o.outTime, expectedReturn: o.expectedReturn, actualOut: o.actualOut, actualReturn: o.actualReturn, status: o.status, parentApproval: o.parentApproval, wardenApproval: o.wardenApproval })),
      homeGoings: homeGoings.map((g) => ({ id: g.id, fromDate: iso(g.fromDate), toDate: iso(g.toDate), reason: g.reason, status: g.status })),
    };
  }
}
