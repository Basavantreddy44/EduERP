import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@eduerp/db';
import {
  ApplyLeaveInput, LeaveQuery, LeaveTypeInput, PERMISSIONS, PermissionCode, UpdateLeaveTypeInput, WeeklyOff, leaveDays,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { SettingsService } from '../settings/settings.service';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const NONE: CampusScope = { all: false, campusIds: [] };

/** Approved leave of these applicants that covers a day (for attendance sheets). */
export async function onLeave(tx: Tx, kind: 'STUDENT' | 'EMPLOYEE', ids: string[], date: string) {
  if (!ids.length) return new Map<string, { typeName: string; halfDay: boolean }>();
  const rows = await tx.leaveRequest.findMany({
    where: { status: 'APPROVED', fromDate: { lte: day(date) }, toDate: { gte: day(date) }, ...(kind === 'STUDENT' ? { studentId: { in: ids } } : { employeeId: { in: ids } }) },
    select: { studentId: true, employeeId: true, halfDay: true, leaveType: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [(r.studentId ?? r.employeeId)!, { typeName: r.leaveType.name, halfDay: r.halfDay }]));
}

/**
 * Leave (M3.4): leave types (students / staff, optional yearly limit), requests (working days only,
 * no overlap, within the limit; through the approvals engine as "Leave request" — approved at once
 * when there is no rule), cancel, balances. Approved leave shows as LEAVE on later sheets.
 */
@Injectable()
export class LeaveService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('LEAVE', (tx, d) => this.decided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, p: PermissionCode) {
    return scopeFor(auth, p) ?? NONE;
  }

  // ───────────── Types ─────────────

  types(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) =>
      (await tx.leaveType.findMany({ orderBy: [{ appliesTo: 'asc' }, { status: 'asc' }, { name: 'asc' }] })).map((t) => ({ ...t, daysPerYear: num(t.daysPerYear) })),
    );
  }

  createType(input: LeaveTypeInput, auth: AuthContext, client: ClientInfo) {
    if (!this.scope(auth, PERMISSIONS.LEAVE_STAFF).all) throw Forbidden('scope-insufficient', 'Only institution-wide users set up leave types');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.leaveType.findFirst({ where: { appliesTo: input.appliesTo, code: input.code }, select: { id: true } })) {
        throw new AppError(HttpStatus.CONFLICT, 'leave-code-taken', `Code ${input.code} is already used`, [{ field: 'code', message: 'Already used' }]);
      }
      const t = await tx.leaveType.create({ data: { tenantId: auth.tenantId!, name: input.name, code: input.code, appliesTo: input.appliesTo, isPaid: input.appliesTo === 'EMPLOYEE' ? input.isPaid : false, daysPerYear: input.daysPerYear, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'LEAVE_TYPE', entityId: t.id, newValues: { ...input } }, client);
      return { ...t, daysPerYear: num(t.daysPerYear) };
    });
  }

  updateType(id: string, input: UpdateLeaveTypeInput, auth: AuthContext, client: ClientInfo) {
    if (!this.scope(auth, PERMISSIONS.LEAVE_STAFF).all) throw Forbidden('scope-insufficient', 'Only institution-wide users set up leave types');
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.leaveType.findUnique({ where: { id } });
      if (!before) throw NotFound('Leave type');
      const t = await tx.leaveType.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'LEAVE_TYPE', entityId: id, oldValues: { ...before, daysPerYear: num(before.daysPerYear) }, newValues: input }, client);
      return { ...t, daysPerYear: num(t.daysPerYear) };
    });
  }

  // ───────────── Requests ─────────────

  private async ownEmployee(tx: Tx, auth: AuthContext) {
    return tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true, campusId: true, firstName: true, lastName: true, employeeCode: true, status: true, joiningDate: true, leftOn: true } });
  }

  /** Who the leave is for, and whether this user may apply for them. */
  private async applicant(tx: Tx, input: Pick<ApplyLeaveInput, 'applicantType' | 'studentId' | 'employeeId'>, auth: AuthContext) {
    if (input.applicantType === 'STUDENT') {
      const s = await tx.student.findUnique({ where: { id: input.studentId! }, select: { id: true, campusId: true, firstName: true, lastName: true, admissionNo: true, status: true, admissionDate: true } });
      if (!s || !canAccessCampus(this.scope(auth, PERMISSIONS.LEAVE_STUDENT), s.campusId)) throw NotFound('Student');
      if (!['ACTIVE', 'INACTIVE'].includes(s.status)) throw Conflict('student-not-studying', 'This student is no longer studying here');
      return { kind: 'STUDENT' as const, id: s.id, campusId: s.campusId, label: `${s.firstName} ${s.lastName ?? ''}`.trim(), code: s.admissionNo, startDate: s.admissionDate };
    }
    const own = await this.ownEmployee(tx, auth);
    const wantsOther = input.employeeId && input.employeeId !== own?.id;
    let e = own;
    if (wantsOther || !own) {
      if (!input.employeeId) throw unprocessable('no-staff-record', 'Your login is not linked to a staff record — ask the office to link it', 'employeeId');
      e = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, campusId: true, firstName: true, lastName: true, employeeCode: true, status: true, joiningDate: true, leftOn: true } });
      if (!e || !canAccessCampus(this.scope(auth, PERMISSIONS.LEAVE_STAFF), e.campusId)) throw NotFound('Staff member');
    } else if (!auth.permissions.has(PERMISSIONS.LEAVE_SELF) && !canAccessCampus(this.scope(auth, PERMISSIONS.LEAVE_STAFF), own.campusId)) {
      throw Forbidden();
    }
    if (!['ACTIVE', 'ON_LEAVE'].includes(e!.status)) throw Conflict('staff-left', 'This staff member has left');
    return { kind: 'EMPLOYEE' as const, id: e!.id, campusId: e!.campusId, label: `${e!.firstName} ${e!.lastName ?? ''}`.trim(), code: e!.employeeCode, startDate: e!.joiningDate };
  }

  private async usedDays(tx: Tx, kind: 'STUDENT' | 'EMPLOYEE', applicantId: string, typeId: string, yearId: string | null, exceptId?: string) {
    const rows = await tx.leaveRequest.groupBy({
      by: ['status'],
      where: { leaveTypeId: typeId, academicYearId: yearId, status: { in: ['PENDING', 'APPROVED'] }, ...(kind === 'STUDENT' ? { studentId: applicantId } : { employeeId: applicantId }), ...(exceptId ? { id: { not: exceptId } } : {}) },
      _sum: { days: true },
    });
    const of = (s: string) => Number(rows.find((r) => r.status === s)?._sum.days ?? 0);
    return { approved: of('APPROVED'), pending: of('PENDING') };
  }

  apply(input: ApplyLeaveInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const who = await this.applicant(tx, input, auth);
      const type = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
      if (!type || type.status !== 'ACTIVE' || type.appliesTo !== who.kind) throw unprocessable('leave-type-invalid', 'Choose a leave type for ' + (who.kind === 'STUDENT' ? 'students' : 'staff'), 'leaveTypeId');
      if (input.fromDate < iso(who.startDate)) throw unprocessable('before-joining', who.kind === 'STUDENT' ? 'The leave starts before the admission date' : 'The leave starts before the joining date', 'fromDate');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${who.id}`}))`;
      const clash = await tx.leaveRequest.findFirst({
        where: { status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: day(input.toDate) }, toDate: { gte: day(input.fromDate) }, ...(who.kind === 'STUDENT' ? { studentId: who.id } : { employeeId: who.id }) },
        select: { fromDate: true, toDate: true, status: true },
      });
      if (clash) throw new AppError(HttpStatus.CONFLICT, 'leave-overlap', `Leave from ${pretty(iso(clash.fromDate))} to ${pretty(iso(clash.toDate))} is already ${clash.status === 'APPROVED' ? 'approved' : 'waiting'} for these days`, [{ field: 'fromDate', message: 'Overlaps other leave' }]);

      const off = await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', who.campusId);
      const hol = new Set((await tx.holiday.findMany({ where: { holidayDate: { gte: day(input.fromDate), lte: day(input.toDate) }, OR: [{ campusId: null }, { campusId: who.campusId }] }, select: { holidayDate: true } })).map((h) => iso(h.holidayDate)));
      const days = leaveDays(input.fromDate, input.toDate, input.halfDay, off, hol);
      if (days === 0) throw unprocessable('no-working-days', 'These days are all holidays — no leave is needed', 'fromDate');

      const year = await tx.academicYear.findFirst({ where: { startDate: { lte: day(input.fromDate) }, endDate: { gte: day(input.fromDate) } }, select: { id: true, name: true } });
      if (type.daysPerYear !== null) {
        const used = await this.usedDays(tx, who.kind, who.id, type.id, year?.id ?? null);
        const adj = who.kind === 'EMPLOYEE' && year ? Number((await tx.leaveBalanceAdjustment.aggregate({ where: { employeeId: who.id, leaveTypeId: type.id, academicYearId: year.id }, _sum: { days: true } }))._sum.days ?? 0) : 0;
        const left = Number(type.daysPerYear) + adj - used.approved - used.pending;
        if (days > left) throw unprocessable('leave-balance', `Only ${Math.max(left, 0)} day(s) of ${type.name} left${year ? ` in ${year.name}` : ''} (${used.approved} taken, ${used.pending} waiting)`, 'toDate');
      }

      let r = await tx.leaveRequest.create({
        data: {
          tenantId: auth.tenantId!, campusId: who.campusId, applicantType: who.kind, studentId: who.kind === 'STUDENT' ? who.id : null, employeeId: who.kind === 'EMPLOYEE' ? who.id : null,
          leaveTypeId: type.id, academicYearId: year?.id ?? null, fromDate: day(input.fromDate), toDate: day(input.toDate), halfDay: input.halfDay, days, reason: input.reason, appliedBy: auth.userId,
        },
      });
      const span = input.fromDate === input.toDate ? pretty(input.fromDate) : `${pretty(input.fromDate)} – ${pretty(input.toDate)}`;
      const summary = `${who.label} (${who.code}) · ${type.name} · ${span}${input.halfDay ? ' (half day)' : ''} · ${days} day${days === 1 ? '' : 's'}`;
      const approval = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'LEAVE', entityId: r.id, campusId: who.campusId, summary }, client);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: who.campusId, action: 'CREATE', entityType: 'LEAVE_REQUEST', entityId: r.id, newValues: { summary, reason: input.reason, needsApproval: !!approval } }, client);
      if (approval) r = await tx.leaveRequest.update({ where: { id: r.id }, data: { approvalRequestId: approval.id } });
      else r = await tx.leaveRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', decidedBy: auth.userId, decidedAt: new Date() } });
      return { ...r, days: Number(r.days), fromDate: iso(r.fromDate), toDate: iso(r.toDate) };
    });
  }

  private async decided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string }) {
    const r = await tx.leaveRequest.findUnique({ where: { id: d.entityId } });
    if (!r || r.status !== 'PENDING') return;
    await tx.leaveRequest.update({ where: { id: r.id }, data: { status: d.decision, decidedBy: d.userId, decidedAt: new Date(), decisionRemarks: d.remarks } });
  }

  /** Withdraw a request: waiting ones by the person who applied; approved ones only before they start. */
  async cancel(id: string, auth: AuthContext, client: ClientInfo) {
    const r = await this.db.run(this.ctx(auth), (tx) => tx.leaveRequest.findUnique({ where: { id } }));
    const manager = r && (r.applicantType === 'STUDENT' ? canAccessCampus(this.scope(auth, PERMISSIONS.LEAVE_STUDENT), r.campusId) : canAccessCampus(this.scope(auth, PERMISSIONS.LEAVE_STAFF), r.campusId));
    if (!r || (r.appliedBy !== auth.userId && !manager)) throw NotFound('Leave request');
    if (r.status === 'PENDING') {
      if (r.appliedBy !== auth.userId) throw Forbidden('not-requester', 'Only the person who applied can withdraw a waiting request');
      await this.approvals.cancel(r.approvalRequestId!, auth, client);
    } else if (r.status === 'APPROVED') {
      if (iso(r.fromDate) <= todayIST()) throw Conflict('leave-started', 'This leave has already started — it cannot be withdrawn');
      await this.db.run(this.ctx(auth), async (tx) => {
        await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', decisionRemarks: 'Withdrawn' } });
        await this.audit.log(tx, { tenantId: r.tenantId, userId: auth.userId, campusId: r.campusId, action: 'STATUS_CHANGE', entityType: 'LEAVE_REQUEST', entityId: id, oldValues: { status: 'APPROVED' }, newValues: { status: 'CANCELLED' } }, client);
      });
    } else throw Conflict('leave-closed', `This request is already ${r.status.toLowerCase()}`);
    const after = await this.db.run(this.ctx(auth), (tx) => tx.leaveRequest.findUniqueOrThrow({ where: { id } }));
    return { ...after, days: Number(after.days), fromDate: iso(after.fromDate), toDate: iso(after.toDate) };
  }

  list(q: LeaveQuery, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const own = await this.ownEmployee(tx, auth);
      const read = this.scope(auth, PERMISSIONS.LEAVE_READ);
      const mine: Prisma.LeaveRequestWhereInput = { OR: [{ appliedBy: auth.userId }, ...(own ? [{ employeeId: own.id }] : [])] };
      const visible: Prisma.LeaveRequestWhereInput = q.mine === 'true' ? mine : read.all ? {} : { OR: [mine, { campusId: { in: read.campusIds } }] };
      const where: Prisma.LeaveRequestWhereInput = {
        AND: [visible, {
          ...(q.status ? { status: q.status } : {}), ...(q.applicantType ? { applicantType: q.applicantType } : {}),
          ...(q.studentId ? { studentId: q.studentId } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}), ...(q.campusId ? { campusId: q.campusId } : {}),
        }],
      };
      const [total, rows] = await Promise.all([
        tx.leaveRequest.count({ where }),
        tx.leaveRequest.findMany({
          where, orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: { leaveType: { select: { name: true, code: true } }, student: { select: { firstName: true, lastName: true, admissionNo: true } }, employee: { select: { firstName: true, lastName: true, employeeCode: true, designation: true } } },
        }),
      ]);
      const users = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.appliedBy, r.decidedBy].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return {
        total, page: q.page, pageSize: q.pageSize,
        items: rows.map((r) => ({
          ...r, days: Number(r.days), fromDate: iso(r.fromDate), toDate: iso(r.toDate), appliedByName: users.get(r.appliedBy) ?? null, decidedByName: r.decidedBy ? users.get(r.decidedBy) ?? null : null,
          canCancel: (r.status === 'PENDING' && r.appliedBy === auth.userId) || (r.status === 'APPROVED' && iso(r.fromDate) > todayIST() && (r.appliedBy === auth.userId || canAccessCampus(this.scope(auth, r.applicantType === 'STUDENT' ? PERMISSIONS.LEAVE_STUDENT : PERMISSIONS.LEAVE_STAFF), r.campusId))),
        })),
      };
    });
  }

  /** Days allowed / taken / waiting per leave type in the current academic year. */
  balance(kind: 'STUDENT' | 'EMPLOYEE', applicantId: string | null, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const who = await this.applicant(tx, { applicantType: kind, studentId: kind === 'STUDENT' ? applicantId : null, employeeId: kind === 'EMPLOYEE' ? applicantId : null }, auth);
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
      const types = await tx.leaveType.findMany({ where: { appliesTo: kind, status: 'ACTIVE' }, orderBy: { name: 'asc' } });
      const out = [];
      for (const t of types) {
        const used = await this.usedDays(tx, kind, who.id, t.id, year?.id ?? null);
        // Staff: HR adjustments (opening, carry-forward, encashment) count towards what is allowed.
        const adj = kind === 'EMPLOYEE' && year && t.daysPerYear !== null ? Number((await tx.leaveBalanceAdjustment.aggregate({ where: { employeeId: who.id, leaveTypeId: t.id, academicYearId: year.id }, _sum: { days: true } }))._sum.days ?? 0) : 0;
        const allowed = t.daysPerYear === null ? null : Number(t.daysPerYear) + adj;
        out.push({ id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, allowed, taken: used.approved, waiting: used.pending, left: allowed === null ? null : allowed - used.approved - used.pending });
      }
      return { applicant: { id: who.id, name: who.label, code: who.code, campusId: who.campusId }, year: year?.name ?? null, types: out };
    });
  }

  /** The signed-in staff member (if linked) — for the "My leave" page. */
  me(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.ownEmployee(tx, auth);
      return { employee: e ? { id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), code: e.employeeCode, campusId: e.campusId } : null, canApply: !!e && (auth.permissions.has(PERMISSIONS.LEAVE_SELF) || auth.permissions.has(PERMISSIONS.LEAVE_STAFF)) };
    });
  }
}
