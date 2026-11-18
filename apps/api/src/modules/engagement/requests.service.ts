import { Injectable, OnModuleInit } from '@nestjs/common';
import { DeptRequestInput, DeptRequestUpdateInput, PERMISSIONS, RequestCategoryInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { unprocessable } from './audience';

const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
const STATUS_TEXT: Record<string, string> = { PENDING_APPROVAL: 'waiting for approval', REJECTED: 'not approved', OPEN: 'received', IN_PROGRESS: 'being worked on', COMPLETED: 'completed — please close it', CLOSED: 'closed' };
const WORKABLE = ['OPEN', 'IN_PROGRESS'];

/**
 * Department requests (M12.4). Any department raises a request to another in a request type; when the
 * type needs approval it waits for the approvals engine (and nobody can work on it until then), otherwise
 * it opens at once. The handling department assigns it to one of its own staff, posts updates and marks it
 * complete; only the requester closes it.
 */
@Injectable()
export class DeptRequestsService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly numbering: NumberingService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('DEPT_REQUEST', (tx, d) => this.decided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private async me(tx: Tx, auth: AuthContext) {
    return tx.employee.findFirst({ where: { userId: auth.userId, status: 'ACTIVE' }, select: { id: true, departmentId: true, campusId: true } });
  }

  /** Users of the handling department (to tell them about a request). */
  private async deptUsers(tx: Tx, departmentId: string) {
    return (await tx.employee.findMany({ where: { departmentId, status: 'ACTIVE', userId: { not: null } }, select: { userId: true } })).map((e) => e.userId!);
  }

  private async tell(tx: Tx, r: { tenantId: string; id: string; requestNo: string; title: string }, userIds: string[], status: string) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length) await this.notifications.notify(tx, { tenantId: r.tenantId, userIds: ids, eventCode: 'DEPT_REQUEST', vars: { no: r.requestNo, title: r.title, status: STATUS_TEXT[status] ?? status }, entityType: 'DEPT_REQUEST', entityId: r.id });
  }

  // ───────────── Request types ─────────────

  categories(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.requestCategory.findMany({ orderBy: { name: 'asc' } });
      const depts = new Map((await tx.department.findMany({ where: { id: { in: rows.map((r) => r.toDepartmentId) } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      return rows.map((c) => ({ id: c.id, name: c.name, toDepartmentId: c.toDepartmentId, toDepartment: depts.get(c.toDepartmentId) ?? '', requiresApproval: c.requiresApproval, slaHours: c.slaHours, isActive: c.isActive }));
    });
  }

  saveCategory(input: RequestCategoryInput & { id?: string; isActive?: boolean }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await tx.department.findUnique({ where: { id: input.toDepartmentId }, select: { id: true } }))) throw NotFound('Department');
      const clash = await tx.requestCategory.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
      if (clash) throw Conflict('duplicate-name', 'A request type with this name already exists');
      const data = { name: input.name, toDepartmentId: input.toDepartmentId, requiresApproval: input.requiresApproval, slaHours: input.slaHours, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) };
      const c = input.id
        ? await tx.requestCategory.update({ where: { id: input.id }, data })
        : await tx.requestCategory.create({ data: { tenantId: auth.tenantId!, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: input.id ? 'UPDATE' : 'CREATE', entityType: 'REQUEST_CATEGORY', entityId: c.id, newValues: data }, client);
      return { id: c.id };
    });
  }

  // ───────────── Requests ─────────────

  create(input: DeptRequestInput, auth: AuthContext, client: ClientInfo) {
    const s = scopeFor(auth, PERMISSIONS.DEPT_REQ_RAISE);
    if (!s || !canAccessCampus(s, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const cat = await tx.requestCategory.findUnique({ where: { id: input.categoryId } });
      if (!cat || !cat.isActive) throw NotFound('Request type');
      if (!(await tx.department.findUnique({ where: { id: input.fromDepartmentId }, select: { id: true } }))) throw NotFound('Department');
      if (cat.toDepartmentId === input.fromDepartmentId) throw unprocessable('same-department', 'A department cannot raise a request to itself', 'fromDepartmentId');
      const year = (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true } }))?.name ?? new Date().getFullYear().toString();
      const requestNo = await allocateNo(this.numbering, tx, 'DEPT_REQUEST', input.campusId, year, auth.userId);
      const r = await tx.departmentRequest.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId, requestNo, fromDepartmentId: input.fromDepartmentId, toDepartmentId: cat.toDepartmentId, categoryId: cat.id,
          requestedBy: auth.userId, title: input.title, description: input.description, priority: input.priority,
          neededBy: input.neededBy ? new Date(`${input.neededBy}T00:00:00Z`) : null, dueAt: new Date(Date.now() + cat.slaHours * 3_600_000),
          status: cat.requiresApproval ? 'PENDING_APPROVAL' : 'OPEN',
        },
      });
      let status = r.status;
      if (cat.requiresApproval) {
        const approval = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'DEPT_REQUEST', entityId: r.id, campusId: input.campusId, summary: `${requestNo} · ${cat.name}: ${input.title}` }, client);
        if (approval) await tx.departmentRequest.update({ where: { id: r.id }, data: { approvalRequestId: approval.id } });
        else status = 'OPEN'; // no approval rule set up — nothing to wait for
      }
      if (status !== r.status) await tx.departmentRequest.update({ where: { id: r.id }, data: { status } });
      await tx.departmentRequestUpdate.create({ data: { tenantId: auth.tenantId!, requestId: r.id, updatedBy: auth.userId, newStatus: status } });
      if (status === 'OPEN') await this.tell(tx, r, await this.deptUsers(tx, cat.toDepartmentId), 'OPEN');
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'DEPT_REQUEST', entityId: r.id, newValues: { ...input, status } }, client);
      return { id: r.id, requestNo, status };
    });
  }

  private async decided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string }) {
    const r = await tx.departmentRequest.findUnique({ where: { id: d.entityId } });
    if (!r || r.status !== 'PENDING_APPROVAL') return;
    const status = d.decision === 'APPROVED' ? 'OPEN' : 'REJECTED';
    await tx.departmentRequest.update({ where: { id: r.id }, data: { status } });
    await tx.departmentRequestUpdate.create({ data: { tenantId: r.tenantId, requestId: r.id, updatedBy: d.userId, message: d.remarks, oldStatus: r.status, newStatus: status } });
    await this.tell(tx, r, [r.requestedBy, ...(status === 'OPEN' ? await this.deptUsers(tx, r.toDepartmentId) : [])], status);
  }

  /** Can this user work on requests to the department? (handler with campus access + in that department, or setup rights) */
  private handles(auth: AuthContext, r: { campusId: string; toDepartmentId: string }, me: { departmentId: string | null } | null) {
    const setup = scopeFor(auth, PERMISSIONS.DEPT_REQ_SETUP);
    if (setup && canAccessCampus(setup, r.campusId)) return true;
    const h = scopeFor(auth, PERMISSIONS.DEPT_REQ_HANDLE);
    return !!h && canAccessCampus(h, r.campusId) && me?.departmentId === r.toDepartmentId;
  }

  /** box: 'mine' (raised by me), 'dept' (to my department), 'all' (setup rights). */
  list(box: 'mine' | 'dept' | 'all', status: string | undefined, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await this.me(tx, auth);
      let where: Record<string, unknown>;
      if (box === 'mine') where = { requestedBy: auth.userId };
      else if (box === 'dept') {
        if (!me?.departmentId || !scopeFor(auth, PERMISSIONS.DEPT_REQ_HANDLE)) return [];
        where = { toDepartmentId: me.departmentId };
      } else {
        const s = scopeFor(auth, PERMISSIONS.DEPT_REQ_SETUP);
        if (!s) throw Forbidden('no-access', 'You cannot see all requests');
        where = s.all ? {} : { campusId: { in: s.campusIds } };
      }
      if (status) where.status = status;
      const rows = await tx.departmentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { category: { select: { name: true } } } });
      const depts = new Map((await tx.department.findMany({ where: { id: { in: [...rows.map((r) => r.fromDepartmentId), ...rows.map((r) => r.toDepartmentId)] } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.assignedEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const now = Date.now();
      return rows.map((r) => ({
        id: r.id, requestNo: r.requestNo, title: r.title, category: r.category.name, priority: r.priority, status: r.status,
        fromDepartment: depts.get(r.fromDepartmentId) ?? '', toDepartment: depts.get(r.toDepartmentId) ?? '',
        assignedTo: r.assignedEmployeeId ? staff.get(r.assignedEmployeeId) ?? null : null,
        neededBy: r.neededBy ? r.neededBy.toISOString().slice(0, 10) : null, dueAt: r.dueAt, createdAt: r.createdAt,
        overdue: WORKABLE.includes(r.status) && r.dueAt.getTime() < now,
      }));
    });
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.departmentRequest.findUnique({ where: { id }, include: { category: { select: { name: true } }, updates: { orderBy: { createdAt: 'asc' } } } });
      if (!r) throw NotFound('Request');
      const me = await this.me(tx, auth);
      const handler = this.handles(auth, r, me);
      if (r.requestedBy !== auth.userId && !handler) throw NotFound('Request');
      const depts = new Map((await tx.department.findMany({ where: { id: { in: [r.fromDepartmentId, r.toDepartmentId] } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: [r.requestedBy, ...r.updates.map((u) => u.updatedBy).filter((x): x is string => !!x)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const team = handler ? await tx.employee.findMany({ where: { departmentId: r.toDepartmentId, status: 'ACTIVE' }, orderBy: { firstName: 'asc' }, select: { id: true, firstName: true, lastName: true } }) : [];
      const assigned = r.assignedEmployeeId ? await tx.employee.findUnique({ where: { id: r.assignedEmployeeId }, select: { firstName: true, lastName: true } }) : null;
      return {
        id: r.id, requestNo: r.requestNo, title: r.title, description: r.description, category: r.category.name, priority: r.priority, status: r.status,
        fromDepartment: depts.get(r.fromDepartmentId) ?? '', toDepartment: depts.get(r.toDepartmentId) ?? '', requestedBy: users.get(r.requestedBy) ?? '',
        neededBy: r.neededBy ? r.neededBy.toISOString().slice(0, 10) : null, dueAt: r.dueAt, createdAt: r.createdAt, completedAt: r.completedAt,
        assignedEmployeeId: r.assignedEmployeeId, assignedTo: assigned ? name(assigned) : null,
        updates: r.updates.map((u) => ({ id: u.id, by: u.updatedBy ? users.get(u.updatedBy) ?? '' : '', message: u.message, oldStatus: u.oldStatus, newStatus: u.newStatus, at: u.createdAt })),
        team: team.map((e) => ({ id: e.id, name: name(e) })),
        can: { work: handler && WORKABLE.includes(r.status), close: r.requestedBy === auth.userId && r.status === 'COMPLETED' },
      };
    });
  }

  /** Handling department: a note, an assignment (own department only) and/or a status change. */
  update(id: string, input: DeptRequestUpdateInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.departmentRequest.findUnique({ where: { id } });
      if (!r) throw NotFound('Request');
      if (!this.handles(auth, r, await this.me(tx, auth))) throw r.requestedBy === auth.userId ? Forbidden('not-handler', 'Only the handling department works on a request') : NotFound('Request');
      if (r.status === 'PENDING_APPROVAL') throw Conflict('awaiting-approval', 'This request is waiting for approval');
      if (!WORKABLE.includes(r.status)) throw Conflict('request-done', 'This request is already finished');
      const data: Record<string, unknown> = {};
      if (input.assignToEmployeeId && input.assignToEmployeeId !== r.assignedEmployeeId) {
        const e = await tx.employee.findUnique({ where: { id: input.assignToEmployeeId }, select: { departmentId: true, status: true, userId: true } });
        if (!e) throw NotFound('Staff member');
        if (e.departmentId !== r.toDepartmentId || e.status !== 'ACTIVE') throw unprocessable('not-in-department', 'Assign only to staff of the handling department', 'assignToEmployeeId');
        data.assignedEmployeeId = input.assignToEmployeeId;
        if (e.userId) await this.tell(tx, r, [e.userId], 'IN_PROGRESS');
      }
      const status = input.status && input.status !== r.status ? input.status : null;
      if (status) {
        data.status = status;
        if (status === 'COMPLETED') data.completedAt = new Date();
      } else if (data.assignedEmployeeId && r.status === 'OPEN') data.status = 'IN_PROGRESS';
      if (Object.keys(data).length) await tx.departmentRequest.update({ where: { id }, data });
      const newStatus = (data.status as string | undefined) ?? null;
      await tx.departmentRequestUpdate.create({ data: { tenantId: r.tenantId, requestId: id, updatedBy: auth.userId, message: input.message, oldStatus: newStatus ? r.status : null, newStatus } });
      if (newStatus) await this.tell(tx, r, [r.requestedBy], newStatus);
      await this.audit.log(tx, { tenantId: r.tenantId, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'DEPT_REQUEST', entityId: id, oldValues: { status: r.status, assignedEmployeeId: r.assignedEmployeeId }, newValues: data }, client);
      return { id, status: newStatus ?? r.status };
    });
  }

  /** Only the requester closes a completed request (or sends it back with a note). */
  close(id: string, accept: boolean, message: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.departmentRequest.findUnique({ where: { id } });
      if (!r) throw NotFound('Request');
      if (r.requestedBy !== auth.userId) throw Forbidden('not-requester', 'Only the person who raised the request can close it');
      if (r.status !== 'COMPLETED') throw Conflict('not-completed', 'The request is not completed yet');
      const status = accept ? 'CLOSED' : 'IN_PROGRESS';
      await tx.departmentRequest.update({ where: { id }, data: { status, ...(accept ? {} : { completedAt: null }) } });
      await tx.departmentRequestUpdate.create({ data: { tenantId: r.tenantId, requestId: id, updatedBy: auth.userId, message, oldStatus: r.status, newStatus: status } });
      if (!accept) {
        const e = r.assignedEmployeeId ? await tx.employee.findUnique({ where: { id: r.assignedEmployeeId }, select: { userId: true } }) : null;
        await this.tell(tx, r, e?.userId ? [e.userId] : await this.deptUsers(tx, r.toDepartmentId), status);
      }
      await this.audit.log(tx, { tenantId: r.tenantId, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'DEPT_REQUEST', entityId: id, oldValues: { status: r.status }, newValues: { status } }, client);
      return { id, status };
    });
  }

  /** For the raise form: my department and all departments. */
  formData(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await this.me(tx, auth);
      const departments = await tx.department.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
      const s = scopeFor(auth, PERMISSIONS.DEPT_REQ_RAISE);
      const campuses = s ? await tx.campus.findMany({ where: s.all ? {} : { id: { in: s.campusIds } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [];
      return { myDepartmentId: me?.departmentId ?? null, myCampusId: me?.campusId ?? null, departments, campuses };
    });
  }
}
