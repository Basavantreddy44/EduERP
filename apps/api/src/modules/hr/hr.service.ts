import { Injectable } from '@nestjs/common';
import { DesignationInput, ExperienceInput, PERMISSIONS, QualificationInput, ShiftInput, StaffProfileInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { decryptField, encryptField, last4, masked } from '../../common/field-crypto';
import { unprocessable } from '../accounts/books';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const name = (e: { firstName: string; lastName: string | null }) => `${e.firstName} ${e.lastName ?? ''}`.trim();

/**
 * HR (M14.1, M14.2): designations, the full staff profile (PAN and bank number encrypted, Aadhaar last
 * 4 only), qualifications and experience, shifts and shift assignment. HR staff see their campuses;
 * every staff member sees their own profile.
 */
@Injectable()
export class HrService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  /** The employee if the user may read (or, with `manage`, change) their HR record. */
  private async employee(tx: Tx, id: string, auth: AuthContext, manage = false) {
    const e = await tx.employee.findUnique({ where: { id } });
    if (!e) throw NotFound('Staff member');
    const s = scopeFor(auth, manage ? PERMISSIONS.HR_PROFILE_MANAGE : PERMISSIONS.HR_PROFILE_READ);
    const own = !manage && e.userId === auth.userId;
    if (!own && (!s || !canAccessCampus(s, e.campusId))) throw NotFound('Staff member');
    return e;
  }

  // ───────────── Designations ─────────────

  designations(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.designation.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
      const counts = new Map((await tx.employee.groupBy({ by: ['designationId'], where: { status: { notIn: ['RESIGNED', 'TERMINATED'] } }, _count: true })).map((c) => [c.designationId, c._count]));
      return rows.map((d) => ({ id: d.id, code: d.code, name: d.name, category: d.category, isActive: d.isActive, staff: counts.get(d.id) ?? 0 }));
    });
  }

  saveDesignation(id: string | null, input: DesignationInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const code = input.code.toUpperCase();
      if (await tx.designation.findFirst({ where: { OR: [{ code }, { name: { equals: input.name, mode: 'insensitive' } }], ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-designation', 'A designation with this code or name already exists');
      const d = id ? await tx.designation.update({ where: { id }, data: { code, name: input.name, category: input.category, isActive: input.isActive } }) : await tx.designation.create({ data: { tenantId: auth.tenantId!, code, name: input.name, category: input.category, isActive: input.isActive } });
      // Keep the staff list's designation text in step with the name.
      if (id) await tx.employee.updateMany({ where: { designationId: id }, data: { designation: input.name } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'DESIGNATION', entityId: d.id, newValues: input }, client);
      return { id: d.id };
    });
  }

  // ───────────── Profile ─────────────

  profile(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth);
      const [d, quals, exps, desig, dept, campus] = await Promise.all([
        tx.employeeDetail.findUnique({ where: { tenantId_employeeId: { tenantId: e.tenantId, employeeId: e.id } } }),
        tx.employeeQualification.findMany({ where: { employeeId: e.id }, orderBy: { yearOfPassing: 'desc' } }),
        tx.employeeExperience.findMany({ where: { employeeId: e.id }, orderBy: { fromDate: 'desc' } }),
        e.designationId ? tx.designation.findUnique({ where: { id: e.designationId }, select: { name: true } }) : null,
        e.departmentId ? tx.department.findUnique({ where: { id: e.departmentId }, select: { name: true } }) : null,
        tx.campus.findUnique({ where: { id: e.campusId }, select: { name: true } }),
      ]);
      const shift = d?.shiftId ? await tx.shift.findUnique({ where: { id: d.shiftId }, select: { name: true, startTime: true, endTime: true } }) : null;
      const manager = d?.reportingToId ? await tx.employee.findUnique({ where: { id: d.reportingToId }, select: { firstName: true, lastName: true } }) : null;
      const exit = await tx.employeeExit.findFirst({ where: { employeeId: e.id, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, lastWorkingDate: true } });
      const s = scopeFor(auth, PERMISSIONS.HR_PROFILE_MANAGE);
      return {
        employee: { id: e.id, employeeCode: e.employeeCode, name: name(e), gender: e.gender, dob: iso(e.dob), phone: e.phone, email: e.email, employeeType: e.employeeType, joiningDate: iso(e.joiningDate), leftOn: iso(e.leftOn), status: e.status, campus: campus?.name ?? '', department: dept?.name ?? null, designationId: e.designationId, designation: desig?.name ?? e.designation },
        details: {
          fatherOrSpouseName: d?.fatherOrSpouseName ?? null, maritalStatus: d?.maritalStatus ?? null, bloodGroup: d?.bloodGroup ?? null, permanentAddress: d?.permanentAddress ?? null, currentAddress: d?.currentAddress ?? null,
          emergencyContactName: d?.emergencyContactName ?? null, emergencyContactPhone: d?.emergencyContactPhone ?? null,
          pan: masked(d?.panLast4), aadhaar: d?.aadhaarLast4 ? `XXXX XXXX ${d.aadhaarLast4}` : null, uanNo: d?.uanNo ?? null, pfNo: d?.pfNo ?? null, esiNo: d?.esiNo ?? null,
          bankName: d?.bankName ?? null, bankAccount: masked(d?.bankAccountLast4), ifsc: d?.ifsc ?? null,
          shiftId: d?.shiftId ?? null, shift: shift ? `${shift.name} (${shift.startTime}–${shift.endTime})` : null, reportingToId: d?.reportingToId ?? null, reportingTo: manager ? name(manager) : null,
          confirmationDate: iso(d?.confirmationDate), probationEndDate: iso(d?.probationEndDate),
        },
        qualifications: quals.map((q) => ({ id: q.id, qualification: q.qualification, institution: q.institution, yearOfPassing: q.yearOfPassing, percentage: q.percentage ? Number(q.percentage) : null })),
        experiences: exps.map((x) => ({ id: x.id, organisation: x.organisation, designation: x.designation, fromDate: iso(x.fromDate), toDate: iso(x.toDate) })),
        exit: exit ? { id: exit.id, status: exit.status, lastWorkingDate: iso(exit.lastWorkingDate) } : null,
        canEdit: !!s && canAccessCampus(s, e.campusId), isSelf: e.userId === auth.userId,
      };
    });
  }

  saveProfile(id: string, input: StaffProfileInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, true);
      if (input.designationId) {
        const dg = await tx.designation.findUnique({ where: { id: input.designationId } });
        if (!dg || !dg.isActive) throw NotFound('Designation');
        await tx.employee.update({ where: { id: e.id }, data: { designationId: dg.id, designation: dg.name } });
      } else if (input.designationId === null) await tx.employee.update({ where: { id: e.id }, data: { designationId: null } });
      if (input.shiftId) {
        const sh = await tx.shift.findUnique({ where: { id: input.shiftId } });
        if (!sh || sh.campusId !== e.campusId) throw unprocessable('shift-other-campus', 'Choose a shift of this staff member’s campus', 'shiftId');
      }
      if (input.reportingToId) {
        if (input.reportingToId === e.id) throw unprocessable('self-manager', 'Someone else must be the reporting manager', 'reportingToId');
        if (!(await tx.employee.findUnique({ where: { id: input.reportingToId }, select: { id: true } }))) throw NotFound('Reporting manager');
      }
      const old = await tx.employeeDetail.findUnique({ where: { tenantId_employeeId: { tenantId: e.tenantId, employeeId: e.id } } });
      const data = {
        fatherOrSpouseName: input.fatherOrSpouseName ?? null, maritalStatus: input.maritalStatus ?? null, bloodGroup: input.bloodGroup ?? null,
        permanentAddress: input.permanentAddress ?? null, currentAddress: input.currentAddress ?? null, emergencyContactName: input.emergencyContactName ?? null, emergencyContactPhone: input.emergencyContactPhone ?? null,
        aadhaarLast4: input.aadhaarLast4 ?? null, uanNo: input.uanNo ?? null, pfNo: input.pfNo ?? null, esiNo: input.esiNo ?? null,
        bankName: input.bankName ?? null, ifsc: input.ifsc ?? null, shiftId: input.shiftId ?? null, reportingToId: input.reportingToId ?? null,
        confirmationDate: day(input.confirmationDate), probationEndDate: day(input.probationEndDate), updatedBy: auth.userId,
        // Blank PAN / account number keeps what is stored (screens never hold the full value).
        ...(input.pan ? { panEnc: encryptField(input.pan), panLast4: last4(input.pan) } : {}),
        ...(input.bankAccountNo ? { bankAccountEnc: encryptField(input.bankAccountNo), bankAccountLast4: last4(input.bankAccountNo) } : {}),
      };
      if (old) await tx.employeeDetail.update({ where: { id: old.id }, data });
      else await tx.employeeDetail.create({ data: { tenantId: e.tenantId, employeeId: e.id, ...data } });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'EMPLOYEE_PROFILE', entityId: e.id, newValues: { ...input, pan: input.pan ? masked(last4(input.pan)) : undefined, bankAccountNo: input.bankAccountNo ? masked(last4(input.bankAccountNo)) : undefined } }, client);
      return { id: e.id };
    });
  }

  reveal(id: string, field: 'pan' | 'bankAccountNo', auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.HR_REVEAL)) throw Forbidden('cannot-reveal', 'You cannot see full PAN or account numbers');
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth);
      const d = await tx.employeeDetail.findUnique({ where: { tenantId_employeeId: { tenantId: e.tenantId, employeeId: e.id } } });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: 'REVEAL', entityType: 'EMPLOYEE_PROFILE', entityId: e.id, newValues: { field } }, client);
      return { value: decryptField(field === 'pan' ? d?.panEnc : d?.bankAccountEnc) };
    });
  }

  addQualification(id: string, input: QualificationInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, true);
      const q = await tx.employeeQualification.create({ data: { tenantId: e.tenantId, employeeId: e.id, qualification: input.qualification, institution: input.institution, yearOfPassing: input.yearOfPassing, percentage: input.percentage ?? null } });
      return { id: q.id };
    });
  }
  removeQualification(id: string, qid: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, true);
      const r = await tx.employeeQualification.deleteMany({ where: { id: qid, employeeId: e.id } });
      if (!r.count) throw NotFound('Qualification');
      return { removed: true };
    });
  }
  addExperience(id: string, input: ExperienceInput, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, true);
      const x = await tx.employeeExperience.create({ data: { tenantId: e.tenantId, employeeId: e.id, organisation: input.organisation, designation: input.designation, fromDate: day(input.fromDate)!, toDate: day(input.toDate)! } });
      return { id: x.id };
    });
  }
  removeExperience(id: string, xid: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, true);
      const r = await tx.employeeExperience.deleteMany({ where: { id: xid, employeeId: e.id } });
      if (!r.count) throw NotFound('Experience');
      return { removed: true };
    });
  }

  /** The signed-in staff member's own employee id (for "My profile"). */
  me(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      return { employeeId: e?.id ?? null };
    });
  }

  /** Active staff for HR pickers (reporting manager, shift assignment) — HR's campuses only. */
  staffOptions(auth: AuthContext, campusId?: string) {
    const s = scopeFor(auth, PERMISSIONS.HR_PROFILE_READ);
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.employee.findMany({ where: { status: { notIn: ['RESIGNED', 'TERMINATED'] }, ...(campusId ? { campusId } : {}), ...(s && !s.all ? { campusId: campusId && s.campusIds.includes(campusId) ? campusId : { in: s.campusIds } } : {}) }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: 2000, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true, designation: true } });
      return rows.map((e) => ({ id: e.id, name: name(e), code: e.employeeCode, campusId: e.campusId, designation: e.designation }));
    });
  }

  // ───────────── Shifts ─────────────

  shifts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.shift.findMany({ orderBy: [{ campusId: 'asc' }, { startTime: 'asc' }] });
      const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const counts = new Map((await tx.employeeDetail.groupBy({ by: ['shiftId'], _count: true })).map((c) => [c.shiftId, c._count]));
      return rows.map((s) => ({ id: s.id, campusId: s.campusId, campus: campuses.get(s.campusId) ?? '', name: s.name, startTime: s.startTime, endTime: s.endTime, lateAfterMinutes: s.lateAfterMinutes, halfDayAfterMinutes: s.halfDayAfterMinutes, isActive: s.isActive, staff: counts.get(s.id) ?? 0 }));
    });
  }

  saveShift(id: string | null, input: ShiftInput, auth: AuthContext, client: ClientInfo) {
    const sc = scopeFor(auth, PERMISSIONS.HR_SETUP);
    if (!sc || !canAccessCampus(sc, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.shift.findFirst({ where: { campusId: input.campusId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-shift', 'This campus already has a shift with this name');
      const data = { campusId: input.campusId, name: input.name, startTime: input.startTime, endTime: input.endTime, lateAfterMinutes: input.lateAfterMinutes, halfDayAfterMinutes: input.halfDayAfterMinutes, isActive: input.isActive };
      const s = id ? await tx.shift.update({ where: { id }, data }) : await tx.shift.create({ data: { tenantId: auth.tenantId!, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: id ? 'UPDATE' : 'CREATE', entityType: 'SHIFT', entityId: s.id, newValues: input }, client);
      return { id: s.id };
    });
  }

  /** Puts staff on a shift (or none); only staff of the shift's campus. */
  assignShift(shiftId: string | null, employeeIds: string[], auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const shift = shiftId ? await tx.shift.findUnique({ where: { id: shiftId } }) : null;
      if (shiftId && (!shift || !shift.isActive)) throw NotFound('Shift');
      const sc = scopeFor(auth, PERMISSIONS.HR_SETUP);
      const staff = await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, campusId: true } });
      if (staff.length !== new Set(employeeIds).size) throw NotFound('Staff member');
      for (const e of staff) {
        if (!sc || !canAccessCampus(sc, e.campusId)) throw NotFound('Staff member');
        if (shift && e.campusId !== shift.campusId) throw unprocessable('shift-other-campus', 'Some staff belong to another campus', 'employeeIds');
      }
      for (const e of staff) {
        const d = await tx.employeeDetail.findUnique({ where: { tenantId_employeeId: { tenantId: auth.tenantId!, employeeId: e.id } }, select: { id: true } });
        if (d) await tx.employeeDetail.update({ where: { id: d.id }, data: { shiftId, updatedBy: auth.userId } });
        else await tx.employeeDetail.create({ data: { tenantId: auth.tenantId!, employeeId: e.id, shiftId, updatedBy: auth.userId } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'UPDATE', entityType: 'SHIFT', entityId: shiftId, newValues: { assigned: staff.length } }, client);
      return { assigned: staff.length };
    });
  }

  /** Late / half-day from a shift and a check-in time "HH:MM" (used by staff attendance). */
  static lateness(shift: { startTime: string; lateAfterMinutes: number; halfDayAfterMinutes: number } | null, checkIn: string | null | undefined) {
    if (!shift || !checkIn) return { lateMinutes: null as number | null, halfDay: false };
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const after = mins(checkIn) - mins(shift.startTime);
    if (after <= shift.lateAfterMinutes) return { lateMinutes: 0, halfDay: false };
    return { lateMinutes: after, halfDay: after > shift.halfDayAfterMinutes };
  }
}
