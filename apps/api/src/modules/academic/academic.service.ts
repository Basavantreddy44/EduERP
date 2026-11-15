import { Injectable } from '@nestjs/common';
import { CreateAcademicYearInput, CreateDepartmentInput, CreateHolidayInput, PERMISSIONS, UpdateDepartmentInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Campus-limited users see institution-wide rows (campus NULL) and their own campuses' rows. */
const campusVisible = (scope: CampusScope) => (scope.all ? {} : { OR: [{ campusId: null }, { campusId: { in: scope.campusIds } }] });

/** Writing an institution-wide row needs all-campus scope; a campus row needs that campus. */
function checkWrite(scope: CampusScope, campusId: string | null) {
  if (campusId ? !canAccessCampus(scope, campusId) : !scope.all) {
    if (campusId) throw NotFound('Campus');
    throw Forbidden('scope-insufficient', 'Choose one of your campuses');
  }
}

/** Academic years, departments and holidays (B1 §2). */
@Injectable()
export class AcademicService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private async campusExists(tx: Tx, campusId: string | null) {
    if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
  }

  // ───────────── Academic years ─────────────

  async listYears(auth: AuthContext) {
    const rows = await this.db.run(this.ctx(auth), (tx) => tx.academicYear.findMany({ orderBy: { startDate: 'desc' } }));
    return rows.map((y) => ({ ...y, startDate: iso(y.startDate), endDate: iso(y.endDate) }));
  }

  async createYear(input: CreateAcademicYearInput, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide users manage academic years');
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      if (await tx.academicYear.findUnique({ where: { tenantId_name: { tenantId, name: input.name } }, select: { id: true } })) {
        throw Conflict('academic-year-exists', `Academic year ${input.name} already exists`);
      }
      const overlap = await tx.academicYear.findFirst({ where: { startDate: { lte: day(input.endDate) }, endDate: { gte: day(input.startDate) } }, select: { name: true } });
      if (overlap) throw Conflict('academic-year-overlap', `These dates overlap academic year ${overlap.name}`);
      if (input.makeCurrent) await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const y = await tx.academicYear.create({
        data: { tenantId, name: input.name, startDate: day(input.startDate), endDate: day(input.endDate), isCurrent: input.makeCurrent, status: input.makeCurrent ? 'ACTIVE' : 'PLANNING', createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId, userId: auth.userId, action: 'CREATE', entityType: 'ACADEMIC_YEAR', entityId: y.id, newValues: { name: y.name, startDate: input.startDate, endDate: input.endDate, isCurrent: y.isCurrent } }, client);
      return { ...y, startDate: iso(y.startDate), endDate: iso(y.endDate) };
    });
  }

  /** Makes one year current (and ACTIVE); the previous current year stays ACTIVE until closed. */
  async makeCurrent(id: string, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide users manage academic years');
    return this.db.run(this.ctx(auth), async (tx) => {
      const y = await tx.academicYear.findUnique({ where: { id } });
      if (!y) throw NotFound('Academic year');
      if (y.status === 'CLOSED') throw Conflict('academic-year-closed', `${y.name} is closed`);
      const prev = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
      await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const updated = await tx.academicYear.update({ where: { id }, data: { isCurrent: true, status: 'ACTIVE', updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: y.tenantId, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'ACADEMIC_YEAR', entityId: id, oldValues: { current: prev?.name ?? null }, newValues: { current: y.name } }, client);
      return { ...updated, startDate: iso(updated.startDate), endDate: iso(updated.endDate) };
    });
  }

  async closeYear(id: string, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide users manage academic years');
    return this.db.run(this.ctx(auth), async (tx) => {
      const y = await tx.academicYear.findUnique({ where: { id } });
      if (!y) throw NotFound('Academic year');
      if (y.isCurrent) throw Conflict('academic-year-current', 'Make another year current before closing this one');
      if (y.status === 'CLOSED') return { ...y, startDate: iso(y.startDate), endDate: iso(y.endDate) };
      const updated = await tx.academicYear.update({ where: { id }, data: { status: 'CLOSED', updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: y.tenantId, userId: auth.userId, action: 'STATUS_CHANGE', entityType: 'ACADEMIC_YEAR', entityId: id, oldValues: { status: y.status }, newValues: { status: 'CLOSED' } }, client);
      return { ...updated, startDate: iso(updated.startDate), endDate: iso(updated.endDate) };
    });
  }

  // ───────────── Departments ─────────────

  listDepartments(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_READ)!;
    return this.db.run(this.ctx(auth), (tx) =>
      tx.department.findMany({ where: campusVisible(scope), orderBy: [{ status: 'asc' }, { name: 'asc' }], include: { campus: { select: { code: true, name: true } } } }),
    );
  }

  async createDepartment(input: CreateDepartmentInput, auth: AuthContext, client: ClientInfo) {
    const campusId = input.campusId ?? null;
    checkWrite(scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      await this.campusExists(tx, campusId);
      if (await tx.department.findFirst({ where: { campusId, code: input.code }, select: { id: true } })) {
        throw Conflict('department-code-taken', `Department code ${input.code} is already used${campusId ? ' on this campus' : ''}`);
      }
      const d = await tx.department.create({ data: { tenantId, campusId, name: input.name, code: input.code, deptType: input.deptType, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId, action: 'CREATE', entityType: 'DEPARTMENT', entityId: d.id, newValues: d }, client);
      return d;
    });
  }

  async updateDepartment(id: string, input: UpdateDepartmentInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.department.findUnique({ where: { id } });
      if (!before) throw NotFound('Department');
      checkWrite(scope, before.campusId);
      const d = await tx.department.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: d.tenantId, userId: auth.userId, campusId: d.campusId, action: 'UPDATE', entityType: 'DEPARTMENT', entityId: id, oldValues: before, newValues: d }, client);
      return d;
    });
  }

  // ───────────── Holidays ─────────────

  async listHolidays(auth: AuthContext, q: { from?: string; to?: string; campusId?: string }) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_READ)!;
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    const rows = await this.db.run(this.ctx(auth), (tx) =>
      tx.holiday.findMany({
        where: {
          ...(q.campusId ? { OR: [{ campusId: null }, { campusId: q.campusId }] } : campusVisible(scope)),
          ...(q.from || q.to ? { holidayDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
        },
        orderBy: { holidayDate: 'asc' },
        include: { campus: { select: { code: true, name: true } } },
        take: 500,
      }),
    );
    return rows.map((h) => ({ ...h, holidayDate: iso(h.holidayDate) }));
  }

  async createHoliday(input: CreateHolidayInput, auth: AuthContext, client: ClientInfo) {
    const campusId = input.campusId ?? null;
    checkWrite(scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!, campusId);
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      await this.campusExists(tx, campusId);
      const date = day(input.holidayDate);
      if (await tx.holiday.findFirst({ where: { campusId, holidayDate: date }, select: { id: true } })) {
        throw Conflict('holiday-exists', `A holiday is already set on ${input.holidayDate}${campusId ? ' for this campus' : ''}`);
      }
      const h = await tx.holiday.create({ data: { tenantId, campusId, holidayDate: date, name: input.name, holidayType: input.holidayType, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId, action: 'CREATE', entityType: 'HOLIDAY', entityId: h.id, newValues: { ...input, campusId } }, client);
      return { ...h, holidayDate: iso(h.holidayDate) };
    });
  }

  async deleteHoliday(id: string, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await tx.holiday.findUnique({ where: { id } });
      if (!h) throw NotFound('Holiday');
      checkWrite(scope, h.campusId);
      await tx.holiday.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: h.tenantId, userId: auth.userId, campusId: h.campusId, action: 'DELETE', entityType: 'HOLIDAY', entityId: id, oldValues: { ...h, holidayDate: iso(h.holidayDate) } }, client);
      return { id, deleted: true };
    });
  }
}
