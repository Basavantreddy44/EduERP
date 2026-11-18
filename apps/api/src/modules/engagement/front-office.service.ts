import { Injectable } from '@nestjs/common';
import { CallLogInput, GatePassInput, PERMISSIONS, PostalInput, FrontVisitorInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { unprocessable } from './audience';
import { staffOptions } from './meetings.service';

const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
const dayStartIST = (d: string) => new Date(`${d}T00:00:00+05:30`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Front office (M12.3): visitor log (only the last 4 characters of an ID are kept), gate passes for
 * students leaving early — straight away to a guardian on record, otherwise only after someone with
 * approval rights (not the requester) approves — and for staff, the call log with follow-ups, and the
 * postal register. A visitor or a pass goes out once and comes back once.
 */
@Injectable()
export class FrontOfficeService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private desk(auth: AuthContext, campusId: string) {
    const s = scopeFor(auth, PERMISSIONS.FRONT_DESK);
    if (!s || !canAccessCampus(s, campusId)) throw NotFound('Campus');
  }
  private async yearName(tx: Tx) {
    return (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true } }))?.name ?? todayIST().slice(0, 4);
  }

  /** Campuses this desk works for. */
  campuses(auth: AuthContext) {
    const s = scopeFor(auth, PERMISSIONS.FRONT_DESK)!;
    return this.db.run(this.ctx(auth), (tx) => tx.campus.findMany({ where: s.all ? {} : { id: { in: s.campusIds } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }));
  }

  /** Staff to meet / address post to. */
  staff(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => staffOptions(tx));
  }

  /** Find a student on the campus by name or admission number (for visitors and gate passes). */
  findStudents(campusId: string, q: string, auth: AuthContext) {
    this.desk(auth, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 3);
      if (!words.length) return [];
      const rows = await tx.student.findMany({
        where: { campusId, status: 'ACTIVE', AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { admissionNo: { contains: w, mode: 'insensitive' as const } }] })) },
        orderBy: { firstName: 'asc' }, take: 10, select: { id: true, firstName: true, lastName: true, admissionNo: true },
      });
      return rows.map((s) => ({ id: s.id, name: name(s), admissionNo: s.admissionNo }));
    });
  }

  // ───────────── Visitors ─────────────

  visitorIn(input: FrontVisitorInput, auth: AuthContext, client: ClientInfo) {
    this.desk(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      if (input.studentId && !(await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true } }))) throw NotFound('Student');
      if (input.whomToMeetEmployeeId && !(await tx.employee.findUnique({ where: { id: input.whomToMeetEmployeeId }, select: { id: true } }))) throw NotFound('Staff member');
      const passNo = await allocateNo(this.numbering, tx, 'VISITOR_PASS', input.campusId, await this.yearName(tx), auth.userId);
      const v = await tx.visitor.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, visitorName: input.visitorName, phone: input.phone, idProofType: input.idProofType ?? null, idProofLast4: input.idProofLast4?.toUpperCase() ?? null, purpose: input.purpose, purposeNote: input.purposeNote ?? null, whomToMeetEmployeeId: input.whomToMeetEmployeeId ?? null, studentId: input.studentId ?? null, passNo, vehicleNo: input.vehicleNo?.toUpperCase() ?? null, recordedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'VISITOR', entityId: v.id, newValues: { ...input, phone: '…' + input.phone.slice(-4) } }, client);
      return { id: v.id, passNo };
    });
  }

  visitorOut(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.visitor.findUnique({ where: { id } });
      if (!v) throw NotFound('Visitor');
      this.desk(auth, v.campusId);
      if (v.outTime) throw Conflict('already-out', 'This visitor has already left');
      await tx.visitor.update({ where: { id }, data: { outTime: new Date() } });
      return { id, out: true };
    });
  }

  /** A day's visitors (inside first). */
  visitors(campusId: string, date: string, auth: AuthContext) {
    this.desk(auth, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const from = dayStartIST(date);
      const rows = await tx.visitor.findMany({ where: { campusId, inTime: { gte: from, lt: new Date(from.getTime() + 86_400_000) } }, orderBy: { inTime: 'desc' } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.whomToMeetEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((s) => [s.id, name(s)]));
      return rows.map((v) => ({ id: v.id, passNo: v.passNo, visitorName: v.visitorName, phone: v.phone, purpose: v.purpose, purposeNote: v.purposeNote, idProofType: v.idProofType, idProofLast4: v.idProofLast4, vehicleNo: v.vehicleNo, whomToMeet: v.whomToMeetEmployeeId ? staff.get(v.whomToMeetEmployeeId) ?? null : null, student: v.studentId ? students.get(v.studentId) ?? null : null, inTime: v.inTime, outTime: v.outTime }))
        .sort((a, b) => Number(!!a.outTime) - Number(!!b.outTime));
    });
  }

  // ───────────── Gate passes ─────────────

  gatePass(input: GatePassInput, auth: AuthContext, client: ClientInfo) {
    this.desk(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      let status = 'REQUESTED';
      if (input.passType === 'STUDENT') {
        const st = await tx.student.findUnique({ where: { id: input.studentId! }, select: { campusId: true, status: true } });
        if (!st || st.campusId !== input.campusId) throw NotFound('Student');
        if (input.pickupGuardianId) {
          if (!(await tx.studentGuardian.findUnique({ where: { studentId_guardianId: { studentId: input.studentId!, guardianId: input.pickupGuardianId } }, select: { studentId: true } }))) throw unprocessable('not-a-guardian', 'This person is not a guardian of the student', 'pickupGuardianId');
          status = 'APPROVED'; // a guardian on record may collect the child
        }
      } else if (!(await tx.employee.findUnique({ where: { id: input.employeeId! }, select: { id: true } }))) throw NotFound('Staff member');
      const passNo = await allocateNo(this.numbering, tx, 'GATE_PASS', input.campusId, await this.yearName(tx), auth.userId);
      const g = await tx.gatePass.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, passNo, passType: input.passType, studentId: input.studentId ?? null, employeeId: input.employeeId ?? null, reason: input.reason, pickupGuardianId: input.pickupGuardianId ?? null, pickupPersonName: input.pickupGuardianId ? null : input.pickupPersonName ?? null, pickupPersonPhone: input.pickupGuardianId ? null : input.pickupPersonPhone ?? null, expectedReturn: input.expectedReturn ? new Date(input.expectedReturn) : null, status, requestedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'GATE_PASS', entityId: g.id, newValues: { ...input, status } }, client);
      return { id: g.id, passNo, status };
    });
  }

  /** Approve or refuse a pass — someone with approval rights, never the person who asked. */
  decide(id: string, approve: boolean, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const g = await tx.gatePass.findUnique({ where: { id } });
      if (!g) throw NotFound('Gate pass');
      const s = scopeFor(auth, PERMISSIONS.FRONT_APPROVE);
      if (!s || !canAccessCampus(s, g.campusId)) throw Forbidden('cannot-approve', 'You cannot approve gate passes');
      if (g.requestedBy === auth.userId) throw Forbidden('own-request', 'Someone else must approve a pass you asked for');
      if (g.status !== 'REQUESTED') throw Conflict('pass-decided', 'This pass is already decided');
      await tx.gatePass.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: g.campusId, action: approve ? 'APPROVE' : 'REJECT', entityType: 'GATE_PASS', entityId: id }, client);
      return { id, status: approve ? 'APPROVED' : 'REJECTED' };
    });
  }

  /** At the gate: out (only an approved pass), back (staff, or a student returning the same day). */
  movement(id: string, move: 'OUT' | 'RETURNED', auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const g = await tx.gatePass.findUnique({ where: { id } });
      if (!g) throw NotFound('Gate pass');
      this.desk(auth, g.campusId);
      if (move === 'OUT' && g.status !== 'APPROVED') throw Conflict(g.status === 'REQUESTED' ? 'pass-not-approved' : 'pass-used', g.status === 'REQUESTED' ? 'This pass is waiting for approval' : 'This pass cannot be used now');
      if (move === 'RETURNED' && g.status !== 'OUT') throw Conflict('not-out', 'This pass is not out');
      await tx.gatePass.update({ where: { id }, data: move === 'OUT' ? { status: 'OUT', outTime: new Date() } : { status: 'RETURNED', actualReturn: new Date() } });
      return { id, status: move };
    });
  }

  gatePasses(campusId: string, date: string, auth: AuthContext) {
    this.desk(auth, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const from = dayStartIST(date);
      const rows = await tx.gatePass.findMany({ where: { campusId, OR: [{ createdAt: { gte: from, lt: new Date(from.getTime() + 86_400_000) } }, { status: { in: ['REQUESTED', 'APPROVED', 'OUT'] } }] }, orderBy: { createdAt: 'desc' }, take: 200 });
      const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((s) => [s.id, s]));
      const guardians = new Map((await tx.guardian.findMany({ where: { id: { in: rows.map((r) => r.pickupGuardianId).filter((x): x is string => !!x) } }, select: { id: true, name: true, phone: true } })).map((g) => [g.id, g]));
      const s = scopeFor(auth, PERMISSIONS.FRONT_APPROVE);
      return rows.map((g) => ({
        id: g.id, passNo: g.passNo, passType: g.passType, reason: g.reason, status: g.status, createdAt: g.createdAt, outTime: g.outTime, actualReturn: g.actualReturn, expectedReturn: g.expectedReturn,
        person: g.studentId ? `${name(students.get(g.studentId)!)} (${students.get(g.studentId)?.admissionNo})` : g.employeeId ? `${name(staff.get(g.employeeId)!)} (${staff.get(g.employeeId)?.employeeCode})` : '',
        pickup: g.pickupGuardianId ? { name: guardians.get(g.pickupGuardianId)?.name ?? '', phone: guardians.get(g.pickupGuardianId)?.phone ?? null, onRecord: true } : g.pickupPersonName ? { name: g.pickupPersonName, phone: g.pickupPersonPhone, onRecord: false } : null,
        canDecide: g.status === 'REQUESTED' && !!s && canAccessCampus(s, g.campusId) && g.requestedBy !== auth.userId,
      }));
    });
  }

  /** Guardians on record for a student (for the gate pass form). */
  guardians(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const st = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!st) throw NotFound('Student');
      this.desk(auth, st.campusId);
      const rows = await tx.studentGuardian.findMany({ where: { studentId }, orderBy: { isPrimary: 'desc' }, select: { relation: true, guardian: { select: { id: true, name: true, phone: true } } } });
      return rows.map((r) => ({ id: r.guardian.id, name: r.guardian.name, phone: r.guardian.phone, relation: r.relation }));
    });
  }

  // ───────────── Calls & post ─────────────

  call(input: CallLogInput, auth: AuthContext) {
    this.desk(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.callLog.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, callType: input.callType, callerName: input.callerName, phone: input.phone, purpose: input.purpose, followUpDate: input.followUpDate ? new Date(`${input.followUpDate}T00:00:00Z`) : null, recordedBy: auth.userId } });
      return { id: c.id };
    });
  }

  followUpDone(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.callLog.findUnique({ where: { id } });
      if (!c) throw NotFound('Call');
      this.desk(auth, c.campusId);
      await tx.callLog.update({ where: { id }, data: { followUpDone: true } });
      return { id, followUpDone: true };
    });
  }

  calls(campusId: string, auth: AuthContext) {
    this.desk(auth, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.callLog.findMany({ where: { campusId, OR: [{ callTime: { gte: new Date(Date.now() - 14 * 86_400_000) } }, { followUpDate: { not: null }, followUpDone: false }] }, orderBy: { callTime: 'desc' }, take: 200 });
      return rows.map((c) => ({ id: c.id, callType: c.callType, callerName: c.callerName, phone: c.phone, purpose: c.purpose, callTime: c.callTime, followUpDate: c.followUpDate ? c.followUpDate.toISOString().slice(0, 10) : null, followUpDone: c.followUpDone }));
    });
  }

  post(input: PostalInput, auth: AuthContext) {
    this.desk(auth, input.campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      if (input.addressedToEmployeeId && !(await tx.employee.findUnique({ where: { id: input.addressedToEmployeeId }, select: { id: true } }))) throw NotFound('Staff member');
      const p = await tx.postalRecord.create({ data: { tenantId: auth.tenantId!, campusId: input.campusId, direction: input.direction, fromParty: input.fromParty, toParty: input.toParty, courierName: input.courierName ?? null, trackingNo: input.trackingNo ?? null, addressedToEmployeeId: input.addressedToEmployeeId ?? null, remarks: input.remarks ?? null, recordedBy: auth.userId } });
      return { id: p.id };
    });
  }

  handOver(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = await tx.postalRecord.findUnique({ where: { id } });
      if (!p) throw NotFound('Post');
      this.desk(auth, p.campusId);
      if (p.handedOverAt) throw Conflict('already-handed', 'Already handed over');
      await tx.postalRecord.update({ where: { id }, data: { handedOverAt: new Date() } });
      return { id, handedOver: true };
    });
  }

  postal(campusId: string, auth: AuthContext) {
    this.desk(auth, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.postalRecord.findMany({ where: { campusId, OR: [{ recordDate: { gte: new Date(Date.now() - 30 * 86_400_000) } }, { direction: 'INWARD', handedOverAt: null }] }, orderBy: { recordDate: 'desc' }, take: 200 });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.addressedToEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      return rows.map((p) => ({ id: p.id, direction: p.direction, fromParty: p.fromParty, toParty: p.toParty, courierName: p.courierName, trackingNo: p.trackingNo, addressedTo: p.addressedToEmployeeId ? staff.get(p.addressedToEmployeeId) ?? null : null, recordDate: p.recordDate, handedOverAt: p.handedOverAt, remarks: p.remarks }));
    });
  }
}
