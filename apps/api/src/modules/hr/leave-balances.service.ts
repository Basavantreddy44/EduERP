import { Injectable } from '@nestjs/common';
import { LeaveAdjustmentInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { unprocessable } from '../accounts/books';

const r1 = (n: number) => Math.round(n * 10) / 10;
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();

/** Balance of one staff leave type for a year: allowance + adjustments − approved − waiting. */
export async function staffLeaveBalance(tx: Tx, employeeId: string, type: { id: string; daysPerYear: { toString(): string } | null }, yearId: string | null, exceptRequestId?: string) {
  const used = await tx.leaveRequest.groupBy({
    by: ['status'],
    where: { employeeId, leaveTypeId: type.id, academicYearId: yearId, status: { in: ['PENDING', 'APPROVED'] }, ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}) },
    _sum: { days: true },
  });
  const of = (s: string) => Number(used.find((u) => u.status === s)?._sum.days ?? 0);
  const adj = yearId ? Number((await tx.leaveBalanceAdjustment.aggregate({ where: { employeeId, leaveTypeId: type.id, academicYearId: yearId }, _sum: { days: true } }))._sum.days ?? 0) : 0;
  const allowance = type.daysPerYear == null ? null : Number(type.daysPerYear.toString());
  return { allowance, adjustments: r1(adj), approved: r1(of('APPROVED')), pending: r1(of('PENDING')), left: allowance == null ? null : r1(allowance + adj - of('APPROVED') - of('PENDING')) };
}

/**
 * Leave balances (M14.3). The yearly allowance comes from the leave type; opening balances, carry-
 * forward, encashment and corrections are adjustments; approved and waiting leave come from the leave
 * requests themselves (so a balance can never drift). The leave form refuses paid leave beyond the
 * balance (staff take unpaid leave instead); year-end carry-forward respects each type's limit and is
 * safe to run twice.
 */
@Injectable()
export class LeaveBalancesService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** Every staff member's balances for a year (HR: their campuses; others: themselves). */
  balances(yearId: string, auth: AuthContext, employeeId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id: yearId }, select: { id: true, name: true } });
      if (!year) throw NotFound('Academic year');
      const s = scopeFor(auth, PERMISSIONS.HR_PROFILE_READ);
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const where = employeeId ? { id: employeeId } : s ? (s.all ? {} : { campusId: { in: s.campusIds } }) : { id: me?.id ?? '00000000-0000-0000-0000-000000000000' };
      const staff = await tx.employee.findMany({ where: { ...where, status: { notIn: ['RESIGNED', 'TERMINATED'] } }, orderBy: [{ firstName: 'asc' }], select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true, userId: true } });
      if (employeeId && staff[0] && staff[0].userId !== auth.userId && (!s || !canAccessCampus(s, staff[0].campusId))) throw NotFound('Staff member');
      const types = await tx.leaveType.findMany({ where: { appliesTo: 'EMPLOYEE', status: 'ACTIVE' }, orderBy: { name: 'asc' } });
      const rows = [];
      for (const e of staff) {
        const bal = [];
        for (const t of types) bal.push({ leaveTypeId: t.id, code: t.code, name: t.name, isPaid: t.isPaid, ...(await staffLeaveBalance(tx, e.id, t, year.id)) });
        rows.push({ employeeId: e.id, name: name(e), code: e.employeeCode, balances: bal });
      }
      return { year, types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, daysPerYear: t.daysPerYear == null ? null : Number(t.daysPerYear), carryForwardMax: t.carryForwardMax == null ? null : Number(t.carryForwardMax), isPaid: t.isPaid })), rows };
    });
  }

  adjust(input: LeaveAdjustmentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, campusId: true } });
      const s = scopeFor(auth, PERMISSIONS.HR_SETUP);
      if (!e || !s || !canAccessCampus(s, e.campusId)) throw NotFound('Staff member');
      const t = await tx.leaveType.findUnique({ where: { id: input.leaveTypeId } });
      if (!t || t.appliesTo !== 'EMPLOYEE') throw NotFound('Leave type');
      if (t.daysPerYear == null) throw unprocessable('no-allowance', `${t.name} has no yearly allowance to adjust`, 'leaveTypeId');
      if (!(await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { id: true } }))) throw NotFound('Academic year');
      if ((input.kind === 'ENCASHMENT' && input.days > 0) || (['OPENING', 'CARRY_FORWARD'].includes(input.kind) && input.days < 0)) throw unprocessable('wrong-sign', input.kind === 'ENCASHMENT' ? 'Encashment reduces the balance — enter it as minus days' : 'Enter the days to add', 'days');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${e.id}`}))`;
      if (input.days < 0) {
        const b = await staffLeaveBalance(tx, e.id, t, input.academicYearId);
        if ((b.left ?? 0) + input.days < 0) throw unprocessable('balance-short', `Only ${b.left} day(s) left`, 'days');
      }
      if (input.kind === 'CARRY_FORWARD' && (await tx.leaveBalanceAdjustment.findFirst({ where: { employeeId: e.id, leaveTypeId: t.id, academicYearId: input.academicYearId, kind: 'CARRY_FORWARD' }, select: { id: true } }))) throw Conflict('already-carried', 'Leave was already carried forward into this year');
      const a = await tx.leaveBalanceAdjustment.create({ data: { tenantId: auth.tenantId!, employeeId: e.id, leaveTypeId: t.id, academicYearId: input.academicYearId, kind: input.kind, days: input.days, reason: input.reason, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'LEAVE_ADJUSTMENT', entityId: a.id, newValues: input }, client);
      return { id: a.id };
    });
  }

  /** Year-end: unused paid leave moves into the next year, up to each type's carry-forward limit. */
  carryForward(fromYearId: string, toYearId: string, auth: AuthContext, client: ClientInfo) {
    const s = scopeFor(auth, PERMISSIONS.HR_SETUP);
    if (!s?.all) throw NotFound('Academic year');
    return this.db.run(this.ctx(auth), async (tx) => {
      const [from, to] = await Promise.all([tx.academicYear.findUnique({ where: { id: fromYearId } }), tx.academicYear.findUnique({ where: { id: toYearId } })]);
      if (!from || !to) throw NotFound('Academic year');
      if (to.startDate <= from.startDate) throw unprocessable('wrong-order', 'Carry forward into a later year', 'toYearId');
      const types = await tx.leaveType.findMany({ where: { appliesTo: 'EMPLOYEE', status: 'ACTIVE', isPaid: true, daysPerYear: { not: null }, carryForwardMax: { gt: 0 } } });
      const staff = await tx.employee.findMany({ where: { status: { notIn: ['RESIGNED', 'TERMINATED'] } }, select: { id: true } });
      let added = 0; let skipped = 0;
      for (const t of types) {
        for (const e of staff) {
          if (await tx.leaveBalanceAdjustment.findFirst({ where: { employeeId: e.id, leaveTypeId: t.id, academicYearId: to.id, kind: 'CARRY_FORWARD' }, select: { id: true } })) { skipped++; continue; }
          const b = await staffLeaveBalance(tx, e.id, t, from.id);
          const days = Math.min(Math.max(0, (b.left ?? 0) + b.pending), Number(t.carryForwardMax));
          const carry = Math.floor(days * 2) / 2;
          if (carry <= 0) continue;
          await tx.leaveBalanceAdjustment.create({ data: { tenantId: auth.tenantId!, employeeId: e.id, leaveTypeId: t.id, academicYearId: to.id, kind: 'CARRY_FORWARD', days: carry, reason: `Carried from ${from.name}`, createdBy: auth.userId } });
          added++;
        }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'LEAVE_CARRY_FORWARD', entityId: to.id, newValues: { from: from.name, to: to.name, added, skipped } }, client);
      return { added, skipped };
    });
  }

  /** Sets a staff leave type's carry-forward limit (days; empty = none). */
  setCarryLimit(leaveTypeId: string, max: number | null, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.HR_SETUP)?.all) throw NotFound('Leave type');
    return this.db.run(this.ctx(auth), async (tx) => {
      const t = await tx.leaveType.findUnique({ where: { id: leaveTypeId } });
      if (!t || t.appliesTo !== 'EMPLOYEE') throw NotFound('Leave type');
      await tx.leaveType.update({ where: { id: t.id }, data: { carryForwardMax: max } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'LEAVE_TYPE', entityId: t.id, newValues: { carryForwardMax: max } }, client);
      return { id: t.id, carryForwardMax: max };
    });
  }

  /** One person's adjustments in a year (for the balance page). */
  adjustments(employeeId: string, yearId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { campusId: true, userId: true } });
      const s = scopeFor(auth, PERMISSIONS.HR_PROFILE_READ);
      if (!e || (e.userId !== auth.userId && (!s || !canAccessCampus(s, e.campusId)))) throw NotFound('Staff member');
      const rows = await tx.leaveBalanceAdjustment.findMany({ where: { employeeId, academicYearId: yearId }, orderBy: { createdAt: 'asc' } });
      const types = new Map((await tx.leaveType.findMany({ select: { id: true, name: true } })).map((t) => [t.id, t.name]));
      return rows.map((a) => ({ id: a.id, leaveType: types.get(a.leaveTypeId) ?? '', kind: a.kind, days: Number(a.days), reason: a.reason, createdAt: a.createdAt }));
    });
  }
}
