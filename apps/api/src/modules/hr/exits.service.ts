import { Injectable } from '@nestjs/common';
import { ExitInput, PERMISSIONS, PermissionCode } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { unprocessable } from '../accounts/books';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
/** Who may clear each no-dues section: its owner, or anyone with the HR clearance right. */
const SECTION_RIGHT: Record<string, PermissionCode> = { ACCOUNTS: PERMISSIONS.ACC_ENTRY, HOSTEL: PERMISSIONS.HOSTEL_MANAGE };

/**
 * Exits (M14.4): resignation / retirement / termination / contract end / death with the last working
 * day and a handover; no-dues clearance by section, each cleared by its owner (with any dues noted);
 * closing needs every section cleared and the last day reached — then the staff record is marked left,
 * the login is removed from the institution and its sessions end, and the settlement amount is kept for
 * payroll. Approvals route by role, so nothing waits on the person who left.
 */
@Injectable()
export class ExitsService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private hr(auth: AuthContext, campusId: string) {
    const s = scopeFor(auth, PERMISSIONS.HR_EXIT);
    if (!s || !canAccessCampus(s, campusId)) throw NotFound('Staff member');
  }
  private canClear(auth: AuthContext, section: string, campusId: string) {
    const any = scopeFor(auth, PERMISSIONS.HR_CLEARANCE);
    if (any && canAccessCampus(any, campusId)) return true;
    const own = SECTION_RIGHT[section] ? scopeFor(auth, SECTION_RIGHT[section]) : null;
    return !!own && canAccessCampus(own, campusId);
  }

  list(auth: AuthContext, status?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.employeeExit.findMany({ where: status ? { status } : { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 200, include: { clearances: true } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true, designation: true } })).map((e) => [e.id, e]));
      const s = scopeFor(auth, PERMISSIONS.HR_EXIT);
      return rows
        .filter((x) => { const e = staff.get(x.employeeId); return !!e && ((s && canAccessCampus(s, e.campusId)) || x.clearances.some((c) => c.status === 'PENDING' && this.canClear(auth, c.section, e.campusId))); })
        .map((x) => {
          const e = staff.get(x.employeeId)!;
          return { id: x.id, employeeId: x.employeeId, name: name(e), code: e.employeeCode, designation: e.designation, exitType: x.exitType, lastWorkingDate: iso(x.lastWorkingDate), status: x.status, cleared: x.clearances.filter((c) => c.status === 'CLEARED').length, sections: x.clearances.length, myPending: x.clearances.filter((c) => c.status === 'PENDING' && this.canClear(auth, c.section, e.campusId)).map((c) => c.section) };
        });
    });
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.employeeExit.findUnique({ where: { id }, include: { clearances: { orderBy: { section: 'asc' } } } });
      if (!x) throw NotFound('Exit');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: x.employeeId } });
      const s = scopeFor(auth, PERMISSIONS.HR_EXIT);
      const isHr = !!s && canAccessCampus(s, e.campusId);
      if (!isHr && !x.clearances.some((c) => this.canClear(auth, c.section, e.campusId))) throw NotFound('Exit');
      const users = new Map((await tx.user.findMany({ where: { id: { in: [x.initiatedBy, x.closedBy, ...x.clearances.map((c) => c.clearedBy)].filter((v): v is string => !!v) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const handover = x.handoverToId ? await tx.employee.findUnique({ where: { id: x.handoverToId }, select: { firstName: true, lastName: true } }) : null;
      return {
        id: x.id, status: x.status, exitType: x.exitType, resignationDate: iso(x.resignationDate), lastWorkingDate: iso(x.lastWorkingDate), reason: x.reason, remarks: x.remarks,
        settlementAmount: x.settlementAmount ? x.settlementAmount.toFixed(2) : null, initiatedBy: users.get(x.initiatedBy) ?? '', closedBy: x.closedBy ? users.get(x.closedBy) ?? '' : null, closedAt: x.closedAt,
        employee: { id: e.id, name: name(e), code: e.employeeCode, designation: e.designation, joiningDate: iso(e.joiningDate), hasLogin: !!e.userId },
        handoverTo: handover ? name(handover) : null,
        clearances: x.clearances.map((c) => ({ section: c.section, status: c.status, dueAmount: c.dueAmount.toFixed(2), remarks: c.remarks, clearedBy: c.clearedBy ? users.get(c.clearedBy) ?? '' : null, clearedAt: c.clearedAt, canClear: c.status === 'PENDING' && x.status === 'INITIATED' && this.canClear(auth, c.section, e.campusId) })),
        canClose: isHr && x.status === 'INITIATED' && x.clearances.every((c) => c.status === 'CLEARED') && iso(x.lastWorkingDate)! <= today(), canCancel: isHr && x.status === 'INITIATED',
      };
    });
  }

  initiate(input: ExitInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id: input.employeeId } });
      if (!e) throw NotFound('Staff member');
      this.hr(auth, e.campusId);
      if (['RESIGNED', 'TERMINATED'].includes(e.status)) throw Conflict('already-left', 'This staff member has already left');
      if (input.lastWorkingDate < (e.joiningDate.toISOString().slice(0, 10))) throw unprocessable('before-joining', 'The last day is before the joining date', 'lastWorkingDate');
      if (await tx.employeeExit.findFirst({ where: { employeeId: e.id, status: 'INITIATED' }, select: { id: true } })) throw Conflict('exit-open', 'An exit is already in progress for this staff member');
      if (input.handoverToId) {
        if (input.handoverToId === e.id) throw unprocessable('self-handover', 'Hand over to someone else', 'handoverToId');
        const h = await tx.employee.findUnique({ where: { id: input.handoverToId }, select: { status: true } });
        if (!h || ['RESIGNED', 'TERMINATED'].includes(h.status)) throw NotFound('Colleague');
      }
      const x = await tx.employeeExit.create({ data: { tenantId: e.tenantId, employeeId: e.id, exitType: input.exitType, resignationDate: new Date(`${input.resignationDate}T00:00:00Z`), lastWorkingDate: new Date(`${input.lastWorkingDate}T00:00:00Z`), reason: input.reason, handoverToId: input.handoverToId ?? null, status: 'INITIATED', initiatedBy: auth.userId } });
      await tx.exitClearance.createMany({ data: input.sections.map((section) => ({ tenantId: e.tenantId, exitId: x.id, section })) });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'EMPLOYEE_EXIT', entityId: x.id, newValues: input }, client);
      return { id: x.id };
    });
  }

  clear(id: string, section: string, input: { remarks?: string | null; dueAmount: number }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.employeeExit.findUnique({ where: { id } });
      if (!x) throw NotFound('Exit');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: x.employeeId }, select: { campusId: true } });
      if (x.status !== 'INITIATED') throw Conflict('exit-finished', 'This exit is already closed or cancelled');
      const c = await tx.exitClearance.findUnique({ where: { exitId_section: { exitId: id, section } } });
      if (!c) throw NotFound('Section');
      if (!this.canClear(auth, section, e.campusId)) throw Forbidden('cannot-clear', 'Only the section in charge clears this');
      const done = await tx.exitClearance.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'CLEARED', dueAmount: input.dueAmount, remarks: input.remarks ?? null, clearedBy: auth.userId, clearedAt: new Date() } });
      if (!done.count) throw Conflict('already-cleared', 'This section is already cleared');
      await this.audit.log(tx, { tenantId: x.tenantId, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'EXIT_CLEARANCE', entityId: c.id, newValues: { section, dueAmount: input.dueAmount, remarks: input.remarks ?? null } }, client);
      return { section, status: 'CLEARED' };
    });
  }

  close(id: string, input: { settlementAmount: number; remarks?: string | null }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_exits WHERE id = ${id}::uuid FOR UPDATE`;
      const x = await tx.employeeExit.findUnique({ where: { id }, include: { clearances: true } });
      if (!x) throw NotFound('Exit');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: x.employeeId } });
      this.hr(auth, e.campusId);
      if (x.status !== 'INITIATED') throw Conflict('exit-finished', 'This exit is already closed or cancelled');
      const pending = x.clearances.filter((c) => c.status !== 'CLEARED').map((c) => c.section);
      if (pending.length) throw Conflict('dues-pending', `Not cleared yet: ${pending.join(', ')}`);
      if (iso(x.lastWorkingDate)! > today()) throw Conflict('before-last-day', 'An exit closes on or after the last working day');
      if (e.userId === auth.userId) throw Forbidden('own-exit', 'Someone else must close your exit');
      await tx.employeeExit.update({ where: { id }, data: { status: 'CLOSED', settlementAmount: input.settlementAmount, remarks: input.remarks ?? null, closedBy: auth.userId, closedAt: new Date() } });
      await tx.employee.update({ where: { id: e.id }, data: { status: x.exitType === 'TERMINATION' ? 'TERMINATED' : 'RESIGNED', leftOn: x.lastWorkingDate, updatedBy: auth.userId } });
      let loginRemoved = false;
      if (e.userId) loginRemoved = await this.removeLogin(tx, e.tenantId, e.userId);
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'CLOSE', entityType: 'EMPLOYEE_EXIT', entityId: id, newValues: { settlementAmount: input.settlementAmount, loginRemoved } }, client);
      return { id, status: 'CLOSED', loginRemoved };
    });
  }

  /** The person's access to this institution ends: membership removed, roles taken away, sessions ended. */
  private async removeLogin(tx: Tx, tenantId: string, userId: string) {
    const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    if (!m || m.status === 'REMOVED') return false;
    await tx.userTenant.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.$executeRaw`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId}::uuid AND (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL) AND revoked_at IS NULL`;
    return true;
  }

  cancel(id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.employeeExit.findUnique({ where: { id } });
      if (!x) throw NotFound('Exit');
      const e = await tx.employee.findUniqueOrThrow({ where: { id: x.employeeId }, select: { campusId: true } });
      this.hr(auth, e.campusId);
      if (x.status !== 'INITIATED') throw Conflict('exit-finished', 'This exit is already closed or cancelled');
      await tx.employeeExit.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { tenantId: x.tenantId, userId: auth.userId, campusId: e.campusId, action: 'CANCEL', entityType: 'EMPLOYEE_EXIT', entityId: id }, client);
      return { id, status: 'CANCELLED' };
    });
  }
}
