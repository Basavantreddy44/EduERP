import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ChangeEmployeeStatusInput, CreateEmployeeInput, EmployeeQuery, LEFT_STATUSES, PERMISSIONS, UpdateEmployeeInput,
} from '@eduerp/shared';
import { Prisma } from '@eduerp/db';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

const LIST_SELECT = {
  id: true, employeeCode: true, firstName: true, lastName: true, nameLocal: true, gender: true, phone: true, email: true, designation: true,
  employeeType: true, joiningDate: true, leftOn: true, status: true, campusId: true, departmentId: true, userId: true,
  campus: { select: { code: true, name: true } }, department: { select: { name: true, code: true } }, user: { select: { fullName: true, email: true } },
} satisfies Prisma.EmployeeSelect;

type Row = Prisma.EmployeeGetPayload<{ select: typeof LIST_SELECT }>;
const shape = (e: Row) => ({ ...e, joiningDate: iso(e.joiningDate), leftOn: iso(e.leftOn) });

/** Next free employee code from the EMPLOYEE number series (created on first use as EMP-0001…). */
export async function nextEmployeeCode(numbering: NumberingService, tx: Tx, campusId: string, userId: string | null) {
  const take = async () => {
    try {
      return await numbering.allocate(tx, { docType: 'EMPLOYEE', campusId, yearLabel: '' });
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== 'numbering-not-configured') throw e;
      await tx.$executeRaw`
        INSERT INTO number_sequences (id, tenant_id, campus_id, doc_type, prefix, year_label, next_number, padding, created_by, updated_at)
        VALUES (gen_random_uuid(), app_current_tenant(), NULL, 'EMPLOYEE', 'EMP-', '', 1, 4, ${userId}::uuid, now())
        ON CONFLICT DO NOTHING`;
      return numbering.allocate(tx, { docType: 'EMPLOYEE', campusId, yearLabel: '' });
    }
  };
  // Codes typed in by hand (or imported) may already use a number of the series: skip those.
  for (let i = 0; i < 200; i++) {
    const code = await take();
    if (!(await tx.employee.findFirst({ where: { employeeCode: code }, select: { id: true } }))) return code; // RLS: this institution only
  }
  throw Conflict('numbering-exhausted', 'Could not find a free employee code — check the EMPLOYEE number series');
}

/** Checks the department belongs to the institution and is institution-wide or on the staff member's campus. */
export async function checkDepartment(tx: Tx, departmentId: string | null | undefined, campusId: string) {
  if (!departmentId) return;
  const d = await tx.department.findUnique({ where: { id: departmentId }, select: { campusId: true, status: true } });
  if (!d) throw unprocessable('department-not-found', 'Department not found', 'departmentId');
  if (d.campusId && d.campusId !== campusId) throw unprocessable('department-other-campus', 'This department belongs to another campus', 'departmentId');
}

/**
 * Staff, basic (M3.1). The staff list (search, filters, paging), add / edit, leaving (status with the
 * last working day), and linking a staff record to a login. Full HR comes in B4.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private campusWhere(scope: CampusScope) {
    return scope.all ? {} : { campusId: { in: scope.campusIds } };
  }

  private async load(tx: Tx, id: string, scope: CampusScope) {
    const e = await tx.employee.findUnique({ where: { id }, select: LIST_SELECT });
    if (!e || !canAccessCampus(scope, e.campusId)) throw NotFound('Staff member');
    return e;
  }

  options(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.HR_STAFF_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const campuses = await tx.campus.findMany({ where: scope.all ? { status: 'ACTIVE' } : { status: 'ACTIVE', id: { in: scope.campusIds } }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } });
      const departments = await tx.department.findMany({
        where: { status: 'ACTIVE', ...(scope.all ? {} : { OR: [{ campusId: null }, { campusId: { in: scope.campusIds } }] }) },
        orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, campusId: true },
      });
      const counts = await tx.employee.groupBy({ by: ['status'], where: this.campusWhere(scope), _count: true });
      return { campuses, departments, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) };
    });
  }

  list(auth: AuthContext, q: EmployeeQuery) {
    const scope = scopeFor(auth, PERMISSIONS.HR_STAFF_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const words = (q.q ?? '').split(/\s+/).filter(Boolean).slice(0, 4);
      // Mobile search only for a number (no letters, 6+ digits), so codes like EMP-0002 don't match phones.
      const digits = /[a-z]/i.test(q.q ?? '') ? '' : (q.q ?? '').replace(/\D/g, '');
      const where: Prisma.EmployeeWhereInput = {
        ...this.campusWhere(scope),
        ...(q.campusId ? { campusId: q.campusId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.employeeType ? { employeeType: q.employeeType } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(words.length
          ? {
              OR: [
                { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] })) },
                { employeeCode: { contains: q.q!.trim(), mode: 'insensitive' } },
                ...(digits.length >= 6 ? [{ phone: { contains: digits.slice(-10) } }] : []),
                { email: { contains: q.q!.trim().toLowerCase() } },
              ],
            }
          : {}),
      };
      const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
        q.sort === 'code' ? [{ employeeCode: q.dir }] : q.sort === 'joining' ? [{ joiningDate: q.dir }, { firstName: 'asc' }] : [{ firstName: q.dir }, { lastName: q.dir }];
      const [total, rows] = await Promise.all([
        tx.employee.count({ where }),
        tx.employee.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: LIST_SELECT }),
      ]);
      return { items: rows.map(shape), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id }, select: { ...LIST_SELECT, dob: true, createdAt: true } });
      if (!e || !canAccessCampus(scopeFor(auth, PERMISSIONS.HR_STAFF_READ)!, e.campusId)) throw NotFound('Staff member');
      return { ...shape(e), dob: iso(e.dob), canManage: canAccessCampus(scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE) ?? { all: false, campusIds: [] }, e.campusId) };
    });
  }

  private async phoneFree(tx: Tx, phone: string | null | undefined, exceptId?: string) {
    if (!phone) return;
    const other = await tx.employee.findFirst({ where: { phone, status: { in: ['ACTIVE', 'ON_LEAVE'] }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { employeeCode: true, firstName: true } });
    if (other) throw new AppError(HttpStatus.CONFLICT, 'staff-phone-taken', `This mobile is already used by ${other.firstName} (${other.employeeCode})`, [{ field: 'phone', message: `Already used by ${other.firstName} (${other.employeeCode})` }]);
  }

  /** Creates one staff record inside the caller's transaction (also used by the importer). */
  async createInTx(tx: Tx, input: CreateEmployeeInput, auth: AuthContext, client: ClientInfo | undefined, reason?: string) {
    if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
    await checkDepartment(tx, input.departmentId, input.campusId);
    await this.phoneFree(tx, input.phone);
    let code = input.employeeCode ?? null;
    if (code) {
      if (await tx.employee.findUnique({ where: { tenantId_employeeCode: { tenantId: auth.tenantId!, employeeCode: code } }, select: { id: true } })) {
        throw new AppError(HttpStatus.CONFLICT, 'employee-code-taken', `Employee code ${code} is already used`, [{ field: 'employeeCode', message: 'Already used' }]);
      }
    } else code = await nextEmployeeCode(this.numbering, tx, input.campusId, auth.userId);
    const e = await tx.employee.create({
      data: {
        tenantId: auth.tenantId!, campusId: input.campusId, employeeCode: code, firstName: input.firstName, lastName: input.lastName || null, nameLocal: input.nameLocal || null,
        gender: input.gender, dob: input.dob ? day(input.dob) : null, phone: input.phone || null, email: input.email || null, departmentId: input.departmentId || null,
        designation: input.designation || null, employeeType: input.employeeType, joiningDate: day(input.joiningDate), createdBy: auth.userId,
      },
      select: LIST_SELECT,
    });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'EMPLOYEE', entityId: e.id, newValues: shape(e), reason }, client);
    return shape(e);
  }

  create(input: CreateEmployeeInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE)!, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), (tx) => this.createInTx(tx, input, auth, client));
  }

  update(id: string, input: UpdateEmployeeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await this.load(tx, id, scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE)!);
      const full = await tx.employee.findUniqueOrThrow({ where: { id }, select: { dob: true, joiningDate: true, leftOn: true } });
      if (input.departmentId !== undefined) await checkDepartment(tx, input.departmentId, before.campusId);
      if (input.phone) await this.phoneFree(tx, input.phone, id);
      const dob = input.dob !== undefined ? input.dob : iso(full.dob);
      const joining = input.joiningDate ?? iso(full.joiningDate)!;
      if (dob && dob >= joining) throw unprocessable('dob-after-joining', 'Date of birth must be before the joining date', 'dob');
      if (full.leftOn && joining > iso(full.leftOn)!) throw unprocessable('joining-after-leaving', 'The joining date is after the last working day', 'joiningDate');
      const data: Prisma.EmployeeUncheckedUpdateInput = { updatedBy: auth.userId };
      for (const k of ['firstName', 'lastName', 'nameLocal', 'gender', 'phone', 'email', 'designation', 'employeeType'] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k] || null;
      if (input.firstName) data.firstName = input.firstName;
      if (input.gender) data.gender = input.gender;
      if (input.employeeType) data.employeeType = input.employeeType;
      if (input.dob !== undefined) data.dob = input.dob ? day(input.dob) : null;
      if (input.joiningDate) data.joiningDate = day(input.joiningDate);
      if (input.departmentId !== undefined) data.departmentId = input.departmentId || null;
      const after = await tx.employee.update({ where: { id }, data, select: LIST_SELECT });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: after.campusId, action: 'UPDATE', entityType: 'EMPLOYEE', entityId: id, oldValues: shape(before), newValues: shape(after) }, client);
      return shape(after);
    });
  }

  changeStatus(id: string, input: ChangeEmployeeStatusInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await this.load(tx, id, scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE)!);
      if (before.status === input.status) throw Conflict('status-unchanged', 'The staff member already has this status');
      const leaving = (LEFT_STATUSES as readonly string[]).includes(input.status);
      if (leaving) {
        if (!input.leftOn) throw unprocessable('left-on-required', 'Enter the last working day', 'leftOn');
        if (input.leftOn < shape(before).joiningDate!) throw unprocessable('left-before-joining', 'The last working day is before the joining date', 'leftOn');
        if (input.leftOn > todayIST()) throw unprocessable('date-in-future', 'The last working day cannot be in the future', 'leftOn');
      }
      if (!leaving && before.phone && (LEFT_STATUSES as readonly string[]).includes(before.status)) await this.phoneFree(tx, before.phone, id);
      const after = await tx.employee.update({ where: { id }, data: { status: input.status, leftOn: leaving ? day(input.leftOn!) : null, updatedBy: auth.userId }, select: LIST_SELECT });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: after.campusId, action: 'STATUS_CHANGE', entityType: 'EMPLOYEE', entityId: id, oldValues: { status: before.status }, newValues: { status: after.status, leftOn: iso(after.leftOn) }, reason: input.reason }, client);
      return shape(after);
    });
  }

  /** Logins of this institution that can be linked (not yet linked to another staff member). */
  linkable(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.load(tx, id, scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE)!);
      const linked = new Set((await tx.employee.findMany({ where: { userId: { not: null }, id: { not: id } }, select: { userId: true } })).map((e) => e.userId));
      const members = await tx.userTenant.findMany({ where: { status: 'ACTIVE', userType: 'STAFF' }, select: { user: { select: { id: true, fullName: true, email: true } } }, orderBy: { user: { fullName: 'asc' } } });
      return members.map((m) => m.user).filter((u) => !linked.has(u.id));
    });
  }

  link(id: string, userId: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await this.load(tx, id, scopeFor(auth, PERMISSIONS.HR_STAFF_MANAGE)!);
      if (userId) {
        const m = await tx.userTenant.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId!, userId } }, select: { status: true } });
        if (!m || m.status !== 'ACTIVE') throw unprocessable('user-not-member', 'This login does not belong to the institution', 'userId');
        const other = await tx.employee.findFirst({ where: { userId, id: { not: id } }, select: { employeeCode: true, firstName: true } });
        if (other) throw new AppError(HttpStatus.CONFLICT, 'user-already-linked', `This login is already linked to ${other.firstName} (${other.employeeCode})`, [{ field: 'userId', message: 'Already linked to another staff member' }]);
      }
      const after = await tx.employee.update({ where: { id }, data: { userId, updatedBy: auth.userId }, select: LIST_SELECT });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: after.campusId, action: 'UPDATE', entityType: 'EMPLOYEE', entityId: id, oldValues: { userId: before.userId }, newValues: { userId } }, client);
      return shape(after);
    });
  }
}
