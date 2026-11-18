import { Injectable } from '@nestjs/common';
import { ComplaintCategoryInput, ComplaintInput, ComplaintUpdateInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo } from '../students/student-records';
import { unprocessable } from './audience';

const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();
const STATUS_TEXT: Record<string, string> = { OPEN: 'received', IN_PROGRESS: 'being looked into', RESOLVED: 'resolved — please confirm', CLOSED: 'closed', REOPENED: 'reopened' };

/** Users of the institution holding a permission (optionally for a campus). */
export async function usersWithPermission(tx: Tx, code: string, campusId: string | null): Promise<string[]> {
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT ur.user_id FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = ur.tenant_id
      JOIN permissions p ON p.id = rp.permission_id
      JOIN user_tenants ut ON ut.user_id = ur.user_id AND ut.tenant_id = ur.tenant_id AND ut.status = 'ACTIVE'
     WHERE p.code = ${code} AND (ur.campus_id IS NULL OR ${campusId}::uuid IS NULL OR ur.campus_id = ${campusId}::uuid)`;
  return rows.map((r) => r.user_id);
}

/**
 * Complaints (M12.2). Parents (in the app) and staff raise complaints in a category; each gets the next
 * number and a due time from the category's hours, and goes to the category's default handler.
 * Handlers and managers post updates (internal notes are never shown to the complainant), assign and
 * resolve; the complainant closes with a rating or reopens. Sensitive categories are seen only by
 * those allowed. Overdue complaints are escalated once to the complaint managers.
 */
@Injectable()
export class ComplaintsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService, private readonly numbering: NumberingService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  categories(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.complaintCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.defaultEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      return rows.map((c) => ({ id: c.id, name: c.name, slaHours: c.slaHours, isSensitive: c.isSensitive, defaultEmployeeId: c.defaultEmployeeId, defaultHandler: c.defaultEmployeeId ? staff.get(c.defaultEmployeeId) ?? null : null }));
    });
  }

  saveCategory(id: string | null, input: ComplaintCategoryInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!scopeFor(auth, PERMISSIONS.GRIEVANCE_MANAGE)) throw Forbidden('cannot-manage', 'You cannot set up complaint categories');
      const clash = await tx.complaintCategory.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } });
      if (clash && clash.id !== id) throw Conflict('category-name-taken', `${input.name} already exists`);
      if (input.defaultEmployeeId && !(await tx.employee.findUnique({ where: { id: input.defaultEmployeeId }, select: { id: true } }))) throw NotFound('Staff member');
      const data = { name: input.name, slaHours: input.slaHours, isSensitive: input.isSensitive, defaultEmployeeId: input.defaultEmployeeId ?? null };
      const c = id ? await tx.complaintCategory.update({ where: { id }, data }) : await tx.complaintCategory.create({ data: { ...data, tenantId: auth.tenantId! } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'COMPLAINT_CATEGORY', entityId: c.id, newValues: input }, client);
      return { id: c.id };
    });
  }

  /** Raise a complaint: by a parent for their own child (portal) or by a staff member. */
  async raiseTx(tx: Tx, input: ComplaintInput, auth: AuthContext, by: 'PARENT' | 'STAFF') {
    const cat = await tx.complaintCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat || !cat.isActive) throw NotFound('Category');
    let campusId: string | null = null;
    if (input.studentId) {
      if (by === 'PARENT' && !(auth.portalStudentIds ?? []).includes(input.studentId)) throw NotFound('Student');
      campusId = (await tx.student.findUnique({ where: { id: input.studentId }, select: { campusId: true } }))?.campusId ?? null;
      if (!campusId) throw NotFound('Student');
    } else if (by === 'PARENT') throw unprocessable('child-required', 'Choose your child', 'studentId');
    else campusId = (await tx.employee.findFirst({ where: { userId: auth.userId }, select: { campusId: true } }))?.campusId ?? (await tx.campus.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id ?? null;
    if (!campusId) throw unprocessable('no-campus', 'No campus to file this under', 'categoryId');
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true } });
    const no = await allocateNo(this.numbering, tx, 'COMPLAINT', campusId, year?.name ?? new Date().getFullYear().toString(), auth.userId);
    const c = await tx.complaint.create({
      data: {
        tenantId: auth.tenantId!, campusId, complaintNo: no, categoryId: cat.id, raisedByUserId: auth.userId, raisedByType: by, studentId: input.studentId ?? null,
        subject: input.subject, description: input.description, priority: input.priority, assignedEmployeeId: cat.defaultEmployeeId, dueAt: new Date(Date.now() + cat.slaHours * 3600_000),
      },
    });
    await tx.complaintUpdate.create({ data: { tenantId: auth.tenantId!, complaintId: c.id, updatedBy: auth.userId, updateType: 'STATUS_CHANGE', newStatus: 'OPEN' } });
    if (cat.defaultEmployeeId) {
      const h = await tx.employee.findUnique({ where: { id: cat.defaultEmployeeId }, select: { userId: true } });
      if (h?.userId) await this.notifications.notify(tx, { tenantId: auth.tenantId!, userIds: [h.userId], eventCode: 'COMPLAINT_UPDATE', vars: { no, subject: input.subject, status: 'assigned to you' }, entityType: 'COMPLAINT', entityId: c.id });
    }
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'CREATE', entityType: 'COMPLAINT', entityId: c.id, newValues: { ...input, description: `${input.description.length} characters` } });
    return { id: c.id, complaintNo: no, status: c.status, dueAt: c.dueAt };
  }

  raiseAsStaff(input: ComplaintInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.raiseTx(tx, input, auth, 'STAFF'));
  }

  /** What a staff user may see of a complaint: manager on the campus, its handler, or its raiser; sensitive ones need the extra right. */
  private async access(tx: Tx, c: { campusId: string; assignedEmployeeId: string | null; raisedByUserId: string; categoryId: string }, auth: AuthContext) {
    const cat = await tx.complaintCategory.findUniqueOrThrow({ where: { id: c.categoryId } });
    const mgr = scopeFor(auth, PERMISSIONS.GRIEVANCE_MANAGE);
    const sens = scopeFor(auth, PERMISSIONS.GRIEVANCE_SENSITIVE);
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    const raiser = c.raisedByUserId === auth.userId;
    const handler = !!me && me.id === c.assignedEmployeeId && !!scopeFor(auth, PERMISSIONS.GRIEVANCE_HANDLE);
    const manager = !!mgr && canAccessCampus(mgr, c.campusId) && (!cat.isSensitive || (!!sens && canAccessCampus(sens, c.campusId)));
    return { raiser, handler, manager, staffView: handler || manager, sensitive: cat.isSensitive, catName: cat.name };
  }

  /** Complaints for staff: managers see their campuses (sensitive only with the right), handlers their own; plus those I raised. */
  list(auth: AuthContext, filter: 'OPEN' | 'ALL' | 'MINE') {
    return this.db.run(this.ctx(auth), async (tx) => {
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const mgr = scopeFor(auth, PERMISSIONS.GRIEVANCE_MANAGE);
      const sens = scopeFor(auth, PERMISSIONS.GRIEVANCE_SENSITIVE);
      // Whose complaints: my assigned ones, plus (managers) their campuses — sensitive ones only with that right.
      const mine = me && scopeFor(auth, PERMISSIONS.GRIEVANCE_HANDLE) ? [{ assignedEmployeeId: me.id }] : [];
      const managed = mgr ? { ...(mgr.all ? {} : { campusId: { in: mgr.campusIds } }), ...(sens ? {} : { category: { isSensitive: false } }) } : null;
      const scope = managed && !Object.keys(managed).length ? {} : { OR: [...mine, ...(managed ? [managed] : [])] };
      if ('OR' in scope && !scope.OR?.length) return [];
      const rows = await tx.complaint.findMany({
        where: filter === 'MINE' ? { raisedByUserId: auth.userId } : { ...(filter === 'OPEN' ? { status: { in: ['OPEN', 'IN_PROGRESS', 'REOPENED', 'RESOLVED'] } } : {}), ...scope },
        orderBy: [{ dueAt: 'asc' }], take: 300, include: { category: { select: { name: true, isSensitive: true } } },
      });
      const visible = rows.filter((c) => !c.category.isSensitive || filter === 'MINE' || (me && c.assignedEmployeeId === me.id) || (sens && canAccessCampus(sens, c.campusId)));
      const staff = new Map((await tx.employee.findMany({ where: { id: { in: visible.map((c) => c.assignedEmployeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, name(e)]));
      const now = Date.now();
      return visible.map((c) => ({ id: c.id, complaintNo: c.complaintNo, subject: c.subject, category: c.category.name, sensitive: c.category.isSensitive, priority: c.priority, status: c.status, raisedByType: c.raisedByType, handler: c.assignedEmployeeId ? staff.get(c.assignedEmployeeId) ?? null : null, dueAt: c.dueAt, overdue: ['OPEN', 'IN_PROGRESS', 'REOPENED'].includes(c.status) && c.dueAt.getTime() < now, escalated: !!c.escalatedAt, createdAt: c.createdAt }));
    });
  }

  /** One complaint with its thread. The complainant never sees internal notes. */
  async viewTx(tx: Tx, id: string, auth: AuthContext, asParent: boolean) {
    const c = await tx.complaint.findUnique({ where: { id }, include: { updates: { orderBy: { createdAt: 'asc' } }, category: { select: { name: true } } } });
    if (!c) throw NotFound('Complaint');
    const a = asParent ? { raiser: c.raisedByUserId === auth.userId, staffView: false, handler: false, manager: false } : await this.access(tx, c, auth);
    if (!a.raiser && !a.staffView) throw NotFound('Complaint');
    const users = new Map((await tx.user.findMany({ where: { id: { in: [c.raisedByUserId, ...c.updates.map((u) => u.updatedBy).filter((x): x is string => !!x)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const student = c.studentId ? await tx.student.findUnique({ where: { id: c.studentId }, select: { firstName: true, lastName: true, admissionNo: true } }) : null;
    const handler = c.assignedEmployeeId ? await tx.employee.findUnique({ where: { id: c.assignedEmployeeId }, select: { firstName: true, lastName: true } }) : null;
    return {
      complaint: { id: c.id, complaintNo: c.complaintNo, subject: c.subject, description: c.description, category: c.category.name, priority: c.priority, status: c.status, dueAt: c.dueAt, resolvedAt: c.resolvedAt, closedAt: c.closedAt, rating: c.rating, escalated: !!c.escalatedAt, createdAt: c.createdAt, raisedBy: users.get(c.raisedByUserId) ?? '', raisedByType: c.raisedByType, student: student ? { name: name(student), admissionNo: student.admissionNo } : null, handler: handler ? name(handler) : null, assignedEmployeeId: c.assignedEmployeeId },
      canWork: a.staffView, canClose: a.raiser && c.status === 'RESOLVED',
      updates: c.updates.filter((u) => a.staffView || !u.isInternal).map((u) => ({ id: u.id, type: u.updateType, message: u.message, isInternal: u.isInternal, oldStatus: u.oldStatus, newStatus: u.newStatus, by: u.updatedBy ? users.get(u.updatedBy) ?? '' : 'EduERP', at: u.createdAt })),
    };
  }

  view(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.viewTx(tx, id, auth, false));
  }

  /** A handler or manager posts an update: a message (public or internal), a status, a new handler. */
  update(id: string, input: ComplaintUpdateInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.complaint.findUnique({ where: { id } });
      if (!c) throw NotFound('Complaint');
      const a = await this.access(tx, c, auth);
      if (!a.staffView) throw NotFound('Complaint');
      if (c.status === 'CLOSED') throw Conflict('complaint-closed', 'This complaint is closed');
      const data: Record<string, unknown> = {};
      if (input.assignToEmployeeId && input.assignToEmployeeId !== c.assignedEmployeeId) {
        if (!a.manager) throw Forbidden('cannot-assign', 'Only complaint managers reassign');
        const e = await tx.employee.findUnique({ where: { id: input.assignToEmployeeId }, select: { id: true, userId: true, firstName: true, lastName: true } });
        if (!e) throw NotFound('Staff member');
        data.assignedEmployeeId = e.id;
        await tx.complaintUpdate.create({ data: { tenantId: c.tenantId, complaintId: id, updatedBy: auth.userId, updateType: 'ASSIGNMENT', message: `Assigned to ${name(e)}`, isInternal: true } });
        if (e.userId) await this.notifications.notify(tx, { tenantId: c.tenantId, userIds: [e.userId], eventCode: 'COMPLAINT_UPDATE', vars: { no: c.complaintNo, subject: c.subject, status: 'assigned to you' }, entityType: 'COMPLAINT', entityId: id });
      }
      if (input.status && input.status !== c.status) {
        data.status = input.status;
        if (input.status === 'RESOLVED') data.resolvedAt = new Date();
      }
      if (Object.keys(data).length) await tx.complaint.update({ where: { id }, data });
      await tx.complaintUpdate.create({ data: { tenantId: c.tenantId, complaintId: id, updatedBy: auth.userId, updateType: input.status ? 'STATUS_CHANGE' : 'COMMENT', message: input.message, isInternal: input.isInternal, oldStatus: input.status ? c.status : null, newStatus: input.status ?? null } });
      if (!input.isInternal) await this.notifications.notify(tx, { tenantId: c.tenantId, userIds: [c.raisedByUserId], eventCode: 'COMPLAINT_UPDATE', vars: { no: c.complaintNo, subject: c.subject, status: STATUS_TEXT[input.status ?? c.status] ?? c.status }, entityType: 'COMPLAINT', entityId: id });
      await this.audit.log(tx, { tenantId: c.tenantId, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'COMPLAINT', entityId: id, newValues: { status: input.status ?? null, internal: input.isInternal, assigned: input.assignToEmployeeId ?? null } }, client);
      return { id, status: (data.status as string) ?? c.status };
    });
  }

  /** The complainant closes a resolved complaint with a rating, or reopens it. */
  async closeTx(tx: Tx, id: string, close: boolean, rating: number | null, message: string | null, auth: AuthContext) {
    const c = await tx.complaint.findUnique({ where: { id } });
    if (!c || c.raisedByUserId !== auth.userId) throw NotFound('Complaint');
    if (c.status !== 'RESOLVED') throw Conflict('not-resolved', 'Only a resolved complaint can be closed or reopened');
    await tx.complaint.update({ where: { id }, data: close ? { status: 'CLOSED', closedAt: new Date(), rating } : { status: 'REOPENED', resolvedAt: null, escalatedAt: null, dueAt: new Date(Date.now() + 48 * 3600_000) } });
    await tx.complaintUpdate.create({ data: { tenantId: c.tenantId, complaintId: id, updatedBy: auth.userId, updateType: 'STATUS_CHANGE', message: message ?? (close ? `Rated ${rating}/5` : null), oldStatus: 'RESOLVED', newStatus: close ? 'CLOSED' : 'REOPENED' } });
    if (!close && c.assignedEmployeeId) {
      const h = await tx.employee.findUnique({ where: { id: c.assignedEmployeeId }, select: { userId: true } });
      if (h?.userId) await this.notifications.notify(tx, { tenantId: c.tenantId, userIds: [h.userId], eventCode: 'COMPLAINT_UPDATE', vars: { no: c.complaintNo, subject: c.subject, status: 'reopened by the complainant' }, entityType: 'COMPLAINT', entityId: id });
    }
    return { id, status: close ? 'CLOSED' : 'REOPENED' };
  }

  close(id: string, close: boolean, rating: number | null, message: string | null, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => this.closeTx(tx, id, close, rating, message, auth));
  }

  /** The family's complaints (parent app). */
  async mineTx(tx: Tx, auth: AuthContext) {
    const rows = await tx.complaint.findMany({ where: { raisedByUserId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { category: { select: { name: true } } } });
    return rows.map((c) => ({ id: c.id, complaintNo: c.complaintNo, subject: c.subject, category: c.category.name, status: c.status, studentId: c.studentId, createdAt: c.createdAt, dueAt: c.dueAt }));
  }

  /** Escalates overdue complaints once (worker, hourly) — in every institution. */
  async escalateAll() {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    let n = 0;
    for (const t of tenants) {
      n += await this.db.run({ tenantId: t.id, userId: null }, async (tx) => {
        const due = await tx.complaint.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'REOPENED'] }, dueAt: { lt: new Date() }, escalatedAt: null }, include: { category: { select: { isSensitive: true } } } });
        for (const c of due) {
          const claimed = await tx.complaint.updateMany({ where: { id: c.id, escalatedAt: null }, data: { escalatedAt: new Date() } });
          if (!claimed.count) continue;
          await tx.complaintUpdate.create({ data: { tenantId: t.id, complaintId: c.id, updateType: 'ESCALATION', message: 'Passed its time to resolve — sent to the complaint managers', isInternal: true } });
          const managers = await usersWithPermission(tx, c.category.isSensitive ? PERMISSIONS.GRIEVANCE_SENSITIVE : PERMISSIONS.GRIEVANCE_MANAGE, c.campusId);
          if (managers.length) await this.notifications.notify(tx, { tenantId: t.id, userIds: managers, eventCode: 'COMPLAINT_ESCALATED', vars: { no: c.complaintNo, subject: c.subject }, entityType: 'COMPLAINT', entityId: c.id });
        }
        return due.length;
      });
    }
    return n;
  }
}
