import { Injectable, OnModuleInit } from '@nestjs/common';
import { BreakageInput, CALIBRATION_DUE_DAYS, EquipmentInput, LabInput, LabSessionInput, PERMISSIONS, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { FeeBillingService } from '../fees/billing.service';
import { dec, unprocessable } from '../accounts/books';
import { addDays, day, fullName, iso, searchPeople, todayIST } from '../campuslife/common';

type Perm = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
const READ = PERMISSIONS.LAB_READ, MANAGE = PERMISSIONS.LAB_MANAGE, SESSION = PERMISSIONS.LAB_SESSION;
const READERS: Perm[] = [READ, MANAGE, SESSION];

/**
 * Labs (M18.1, M18.2): labs with their equipment register and calibration dates; practical sessions
 * that never overlap in a lab (lock per lab, then check); breakages charged to the student's fees under
 * the Fines head — after approval where a LAB_BREAKAGE rule exists — or waived with a reason.
 */
@Injectable()
export class LabsService implements OnModuleInit {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly approvals: ApprovalsService, private readonly billing: FeeBillingService) {}

  onModuleInit() {
    this.approvals.onComplete('LAB_BREAKAGE', (tx, d) => this.breakageDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  can(auth: AuthContext, perm: Perm, campusId: string) {
    const s = scopeFor(auth, perm);
    return !!s && canAccessCampus(s, campusId);
  }
  /** Campuses the user may see labs for (null = all). */
  private readable(auth: AuthContext): string[] | null {
    const scopes = READERS.map((p) => scopeFor(auth, p)).filter((s): s is CampusScope => !!s);
    if (scopes.some((s) => s.all)) return null;
    return [...new Set(scopes.flatMap((s) => (s.all ? [] : s.campusIds)))];
  }
  private campusWhere(auth: AuthContext) {
    const c = this.readable(auth);
    return c ? { campusId: { in: c } } : {};
  }
  private async lab(tx: Tx, id: string, auth: AuthContext, perm?: Perm) {
    const l = await tx.lab.findUnique({ where: { id } });
    const c = this.readable(auth);
    if (!l || (c && !c.includes(l.campusId)) || (perm && !this.can(auth, perm, l.campusId))) throw NotFound('Lab');
    return l;
  }
  private async myEmployeeId(tx: Tx, auth: AuthContext) {
    return (await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } }))?.id ?? null;
  }

  // ───────────── Set-up ─────────────

  options(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = this.readable(auth);
      const where = c ? { campusId: { in: c } } : {};
      const [campuses, departments, staff, stores, sections, subjects, items] = await Promise.all([
        tx.campus.findMany({ where: c ? { id: { in: c } } : {}, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.department.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }),
        tx.employee.findMany({ where: { ...where, status: { notIn: ['RESIGNED', 'TERMINATED'] } }, orderBy: { firstName: 'asc' }, take: 1000, select: { id: true, firstName: true, lastName: true, employeeCode: true, campusId: true } }),
        tx.store.findMany({ where: { ...where, isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, campusId: true } }).catch(() => []),
        tx.section.findMany({ where: { status: 'ACTIVE', academicYear: { isCurrent: true }, ...(c ? { campusId: { in: c } } : {}) }, orderBy: [{ level: { sequence: 'asc' } }, { name: 'asc' }], select: { id: true, name: true, campusId: true, level: { select: { name: true } } } }),
        tx.subject.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
        tx.inventoryItem.findMany({ where: { isActive: true, itemType: { in: ['LAB_EQUIPMENT', 'ASSET'] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, itemCode: true } }),
      ]);
      const me = await this.myEmployeeId(tx, auth);
      return {
        campuses, departments, stores, subjects, items, me,
        staff: staff.map((e) => ({ id: e.id, name: `${fullName(e)} (${e.employeeCode})`, campusId: e.campusId })),
        sections: sections.map((s) => ({ id: s.id, name: `${s.level.name} ${s.name}`, campusId: s.campusId })),
        can: { manage: !!scopeFor(auth, MANAGE), session: !!scopeFor(auth, SESSION) },
      };
    });
  }

  labs(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.lab.findMany({ where: this.campusWhere(auth), orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
      const ids = rows.map((r) => r.id);
      const today = todayIST();
      const [campus, depts, people, stores, equip, due, upcoming, open] = await Promise.all([
        tx.campus.findMany({ select: { id: true, name: true } }),
        tx.department.findMany({ select: { id: true, name: true } }),
        tx.employee.findMany({ where: { id: { in: rows.flatMap((r) => [r.inchargeEmployeeId, r.assistantEmployeeId]).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
        tx.store.findMany({ select: { id: true, name: true } }),
        tx.labEquipment.groupBy({ by: ['labId'], where: { labId: { in: ids }, condition: { not: 'DISPOSED' } }, _count: { _all: true } }),
        tx.labEquipment.groupBy({ by: ['labId'], where: { labId: { in: ids }, condition: { not: 'DISPOSED' }, nextCalibrationDate: { lte: day(addDays(today, CALIBRATION_DUE_DAYS)) } }, _count: { _all: true } }),
        tx.labSession.groupBy({ by: ['labId'], where: { labId: { in: ids }, status: 'SCHEDULED', sessionDate: { gte: day(today), lte: day(addDays(today, 6)) } }, _count: { _all: true } }),
        tx.labBreakage.groupBy({ by: ['labId'], where: { labId: { in: ids }, status: { in: ['REPORTED', 'PENDING_APPROVAL'] } }, _count: { _all: true } }),
      ]);
      const nm = <T extends { id: string }>(list: T[], id: string | null, f: (x: T) => string) => (id ? (list.find((x) => x.id === id) ? f(list.find((x) => x.id === id)!) : null) : null);
      const n = (g: { labId: string; _count: { _all: number } }[], id: string) => g.find((x) => x.labId === id)?._count._all ?? 0;
      return rows.map((l) => ({
        id: l.id, name: l.name, campusId: l.campusId, campus: nm(campus, l.campusId, (x) => x.name), departmentId: l.departmentId, department: nm(depts, l.departmentId, (x) => x.name),
        inchargeEmployeeId: l.inchargeEmployeeId, incharge: nm(people, l.inchargeEmployeeId, fullName), assistantEmployeeId: l.assistantEmployeeId, assistant: nm(people, l.assistantEmployeeId, fullName),
        storeId: l.storeId, store: nm(stores, l.storeId, (x) => x.name), capacity: l.capacity, isActive: l.isActive,
        equipment: n(equip, l.id), calibrationDue: n(due, l.id), sessionsThisWeek: n(upcoming, l.id), openBreakages: n(open, l.id),
        can: { manage: this.can(auth, MANAGE, l.campusId), session: this.can(auth, SESSION, l.campusId) },
      }));
    });
  }

  saveLab(id: string | null, input: LabInput, auth: AuthContext, client: ClientInfo) {
    if (!this.can(auth, MANAGE, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = id ? await this.lab(tx, id, auth, MANAGE) : null;
      if (await tx.lab.findFirst({ where: { campusId: input.campusId, name: { equals: input.name, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-name', `${input.name} already exists at this campus`);
      for (const [k, v] of [['inchargeEmployeeId', input.inchargeEmployeeId], ['assistantEmployeeId', input.assistantEmployeeId]] as const) {
        if (v && !(await tx.employee.findUnique({ where: { id: v }, select: { id: true } }))) throw unprocessable('not-found', 'Staff member not found', k);
      }
      if (input.storeId) { const s = await tx.store.findUnique({ where: { id: input.storeId }, select: { campusId: true } }); if (!s || s.campusId !== input.campusId) throw unprocessable('store-campus', 'Choose a store of this campus', 'storeId'); }
      if (input.departmentId && !(await tx.department.findUnique({ where: { id: input.departmentId }, select: { id: true } }))) throw unprocessable('not-found', 'Department not found', 'departmentId');
      const data = { campusId: input.campusId, name: input.name, departmentId: input.departmentId ?? null, inchargeEmployeeId: input.inchargeEmployeeId ?? null, assistantEmployeeId: input.assistantEmployeeId ?? null, storeId: input.storeId ?? null, capacity: input.capacity ?? null, isActive: input.isActive };
      const row = old ? await tx.lab.update({ where: { id: old.id }, data }) : await tx.lab.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'LAB', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  // ───────────── Equipment ─────────────

  equipment(auth: AuthContext, o: { labId?: string; due?: boolean }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const labs = await tx.lab.findMany({ where: { ...this.campusWhere(auth), ...(o.labId ? { id: o.labId } : {}) }, select: { id: true, name: true, campusId: true } });
      const today = todayIST();
      const rows = await tx.labEquipment.findMany({
        where: { labId: { in: labs.map((l) => l.id) }, ...(o.due ? { condition: { not: 'DISPOSED' }, nextCalibrationDate: { lte: day(addDays(today, CALIBRATION_DUE_DAYS)) } } : {}) },
        orderBy: o.due ? [{ nextCalibrationDate: 'asc' }] : [{ name: 'asc' }], take: 2000,
      });
      const items = new Map((await tx.inventoryItem.findMany({ where: { id: { in: rows.map((r) => r.itemId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
      const lab = new Map(labs.map((l) => [l.id, l]));
      return rows.map((e) => {
        const next = iso(e.nextCalibrationDate);
        return {
          id: e.id, labId: e.labId, lab: lab.get(e.labId)?.name ?? '', itemId: e.itemId, item: e.itemId ? items.get(e.itemId) ?? null : null, name: e.name, assetTag: e.assetTag, quantity: e.quantity, condition: e.condition,
          lastCalibrationDate: iso(e.lastCalibrationDate), nextCalibrationDate: next, notes: e.notes,
          calibration: !next || e.condition === 'DISPOSED' ? null : next < today ? 'OVERDUE' : next <= addDays(today, CALIBRATION_DUE_DAYS) ? 'DUE' : 'OK',
          can: { manage: this.can(auth, MANAGE, lab.get(e.labId)!.campusId) },
        };
      });
    });
  }

  saveEquipment(id: string | null, input: EquipmentInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await this.lab(tx, input.labId, auth, MANAGE);
      const old = id ? await tx.labEquipment.findUnique({ where: { id } }) : null;
      if (id && !old) throw NotFound('Equipment');
      if (old && old.labId !== l.id) await this.lab(tx, old.labId, auth, MANAGE);
      if (await tx.labEquipment.findFirst({ where: { assetTag: input.assetTag, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) throw Conflict('duplicate-tag', `Asset tag ${input.assetTag} is already used`);
      if (input.itemId && !(await tx.inventoryItem.findUnique({ where: { id: input.itemId }, select: { id: true } }))) throw unprocessable('not-found', 'Item not found', 'itemId');
      const data = { labId: l.id, itemId: input.itemId ?? null, name: input.name, assetTag: input.assetTag, quantity: input.quantity, condition: input.condition, lastCalibrationDate: input.lastCalibrationDate ? day(input.lastCalibrationDate) : null, nextCalibrationDate: input.nextCalibrationDate ? day(input.nextCalibrationDate) : null, notes: input.notes };
      const row = old ? await tx.labEquipment.update({ where: { id: old.id }, data }) : await tx.labEquipment.create({ data: { ...data, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: l.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'LAB_EQUIPMENT', entityId: row.id, oldValues: old ?? undefined, newValues: data }, client);
      return { id: row.id };
    });
  }

  // ───────────── Practical sessions ─────────────

  sessions(auth: AuthContext, o: { labId?: string; from?: string; to?: string; mine?: boolean }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const labs = await tx.lab.findMany({ where: { ...this.campusWhere(auth), ...(o.labId ? { id: o.labId } : {}) }, select: { id: true, name: true, campusId: true } });
      const me = o.mine ? await this.myEmployeeId(tx, auth) : null;
      const from = o.from ?? todayIST();
      const to = o.to ?? addDays(from, 13);
      const rows = await tx.labSession.findMany({
        where: { labId: { in: labs.map((l) => l.id) }, sessionDate: { gte: day(from), lte: day(to) }, ...(o.mine ? { employeeId: me ?? '00000000-0000-0000-0000-000000000000' } : {}) },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }], take: 500,
      });
      const lab = new Map(labs.map((l) => [l.id, l]));
      const sections = new Map((await tx.section.findMany({ where: { id: { in: rows.map((r) => r.sectionId) } }, select: { id: true, name: true, level: { select: { name: true } } } })).map((s) => [s.id, `${s.level.name} ${s.name}`]));
      const subjects = new Map((await tx.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
      const people = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, firstName: true, lastName: true, userId: true } })).map((e) => [e.id, e]));
      return {
        from, to,
        rows: rows.map((s) => ({
          id: s.id, labId: s.labId, lab: lab.get(s.labId)?.name ?? '', sectionId: s.sectionId, section: sections.get(s.sectionId) ?? '', subjectId: s.subjectId, subject: s.subjectId ? subjects.get(s.subjectId) ?? null : null,
          batchName: s.batchName, employeeId: s.employeeId, teacher: people.get(s.employeeId) ? fullName(people.get(s.employeeId)!) : '', sessionDate: iso(s.sessionDate), startTime: s.startTime, endTime: s.endTime,
          experimentTitle: s.experimentTitle, status: s.status, studentsPresent: s.studentsPresent, remarks: s.remarks,
          can: { update: s.status === 'SCHEDULED' && (people.get(s.employeeId)?.userId === auth.userId || this.can(auth, MANAGE, lab.get(s.labId)!.campusId)) },
        })),
      };
    });
  }

  createSession(input: LabSessionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await this.lab(tx, input.labId, auth, SESSION);
      if (!l.isActive) throw Conflict('lab-inactive', `${l.name} is not in use`);
      const sec = await tx.section.findUnique({ where: { id: input.sectionId }, select: { id: true, campusId: true } });
      if (!sec || sec.campusId !== l.campusId) throw unprocessable('section-campus', 'Choose a class of this lab’s campus', 'sectionId');
      if (input.subjectId && !(await tx.subject.findUnique({ where: { id: input.subjectId }, select: { id: true } }))) throw unprocessable('not-found', 'Subject not found', 'subjectId');
      const teacher = input.employeeId ?? (await this.myEmployeeId(tx, auth));
      if (!teacher) throw unprocessable('no-teacher', 'Choose the teacher taking the practical', 'employeeId');
      if (input.employeeId && input.employeeId !== (await this.myEmployeeId(tx, auth)) && !this.can(auth, MANAGE, l.campusId)) throw unprocessable('own-only', 'You can book practicals only for yourself', 'employeeId');
      if (!(await tx.employee.findUnique({ where: { id: teacher }, select: { id: true } }))) throw unprocessable('not-found', 'Staff member not found', 'employeeId');
      if (input.sessionDate < todayIST()) throw unprocessable('past-date', 'Choose today or a later date', 'sessionDate');
      // One booking at a time per lab, then the overlap check (two bookings made at the same moment cannot both pass).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lab:${l.id}`}))`;
      const clash = await tx.labSession.findFirst({ where: { labId: l.id, sessionDate: day(input.sessionDate), status: { not: 'CANCELLED' }, startTime: { lt: input.endTime }, endTime: { gt: input.startTime } }, select: { startTime: true, endTime: true, experimentTitle: true } });
      if (clash) throw Conflict('lab-busy', `${l.name} is booked ${clash.startTime}–${clash.endTime} for “${clash.experimentTitle}”`);
      const row = await tx.labSession.create({ data: { tenantId: auth.tenantId!, labId: l.id, sectionId: sec.id, subjectId: input.subjectId ?? null, batchName: input.batchName, employeeId: teacher, sessionDate: day(input.sessionDate), startTime: input.startTime, endTime: input.endTime, experimentTitle: input.experimentTitle, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: l.campusId, action: 'CREATE', entityType: 'LAB_SESSION', entityId: row.id, newValues: input }, client);
      return { id: row.id };
    });
  }

  updateSession(id: string, input: { status: 'COMPLETED' | 'CANCELLED'; studentsPresent?: number | null; remarks?: string | null }, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.labSession.findUnique({ where: { id } });
      if (!s) throw NotFound('Session');
      const l = await this.lab(tx, s.labId, auth);
      const owner = (await tx.employee.findUnique({ where: { id: s.employeeId }, select: { userId: true } }))?.userId === auth.userId;
      if (!owner && !this.can(auth, MANAGE, l.campusId)) throw NotFound('Session');
      if (s.status !== 'SCHEDULED') throw Conflict('session-closed', 'This session is already completed or cancelled');
      if (input.status === 'COMPLETED' && iso(s.sessionDate)! > todayIST()) throw Conflict('future-session', 'A session can be marked completed on or after its day');
      await tx.labSession.update({ where: { id }, data: { status: input.status, studentsPresent: input.status === 'COMPLETED' ? input.studentsPresent ?? null : null, remarks: input.remarks ?? null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: l.campusId, action: 'STATUS_CHANGE', entityType: 'LAB_SESSION', entityId: id, oldValues: { status: s.status }, newValues: input }, client);
      return { status: input.status };
    });
  }

  // ───────────── Breakages ─────────────

  breakages(auth: AuthContext, o: { labId?: string; status?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const labs = await tx.lab.findMany({ where: { ...this.campusWhere(auth), ...(o.labId ? { id: o.labId } : {}) }, select: { id: true, name: true, campusId: true } });
      const rows = await tx.labBreakage.findMany({ where: { labId: { in: labs.map((l) => l.id) }, ...(o.status ? { status: o.status } : {}) }, orderBy: [{ breakageDate: 'desc' }, { createdAt: 'desc' }], take: 300 });
      const lab = new Map(labs.map((l) => [l.id, l]));
      const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((s) => [s.id, s]));
      const equip = new Map((await tx.labEquipment.findMany({ where: { id: { in: rows.map((r) => r.equipmentId).filter((x): x is string => !!x) } }, select: { id: true, name: true, assetTag: true } })).map((e) => [e.id, e]));
      const invoices = new Map((await tx.feeInvoice.findMany({ where: { id: { in: rows.map((r) => r.feeInvoiceId).filter((x): x is string => !!x) } }, select: { id: true, invoiceNo: true } })).map((i) => [i.id, i.invoiceNo]));
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.reportedBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return rows.map((b) => {
        const s = b.studentId ? students.get(b.studentId) : null;
        const e = b.equipmentId ? equip.get(b.equipmentId) : null;
        return {
          id: b.id, labId: b.labId, lab: lab.get(b.labId)?.name ?? '', itemDescription: b.itemDescription, equipment: e ? `${e.name} (${e.assetTag})` : null, student: s ? `${fullName(s)} (${s.admissionNo})` : null, studentId: b.studentId,
          breakageDate: iso(b.breakageDate), quantity: b.quantity, chargeAmount: dec(b.chargeAmount), status: b.status, invoiceNo: b.feeInvoiceId ? invoices.get(b.feeInvoiceId) ?? null : null, waiveReason: b.waiveReason, remarks: b.remarks, reportedBy: users.get(b.reportedBy) ?? null,
          can: { decide: b.status === 'REPORTED' && this.can(auth, MANAGE, lab.get(b.labId)!.campusId) },
        };
      });
    });
  }

  reportBreakage(input: BreakageInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const l = await this.lab(tx, input.labId, auth);
      if (!this.can(auth, SESSION, l.campusId) && !this.can(auth, MANAGE, l.campusId)) throw NotFound('Lab');
      const e = input.equipmentId ? await tx.labEquipment.findUnique({ where: { id: input.equipmentId } }) : null;
      if (input.equipmentId && (!e || e.labId !== l.id)) throw unprocessable('not-found', 'Equipment of this lab not found', 'equipmentId');
      if (input.sessionId) { const s = await tx.labSession.findUnique({ where: { id: input.sessionId }, select: { labId: true } }); if (!s || s.labId !== l.id) throw unprocessable('not-found', 'Session of this lab not found', 'sessionId'); }
      if (input.studentId) { const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { campusId: true } }); if (!s || s.campusId !== l.campusId) throw unprocessable('not-found', 'Student of this campus not found', 'studentId'); }
      if (toPaise(input.chargeAmount) > 0 && !input.studentId) throw unprocessable('student-needed', 'Choose the student to charge, or leave the amount at 0', 'studentId');
      if (input.breakageDate > todayIST()) throw unprocessable('future-date', 'The date cannot be in the future', 'breakageDate');
      const row = await tx.labBreakage.create({
        data: { tenantId: auth.tenantId!, campusId: l.campusId, labId: l.id, equipmentId: e?.id ?? null, sessionId: input.sessionId ?? null, itemDescription: input.itemDescription, studentId: input.studentId ?? null, breakageDate: day(input.breakageDate), quantity: input.quantity, chargeAmount: input.chargeAmount, remarks: input.remarks, reportedBy: auth.userId, status: toPaise(input.chargeAmount) > 0 ? 'REPORTED' : 'WAIVED', waiveReason: toPaise(input.chargeAmount) > 0 ? null : 'No charge' },
      });
      if (e && input.markDamaged) {
        const left = Math.max(0, e.quantity - input.quantity);
        await tx.labEquipment.update({ where: { id: e.id }, data: { quantity: left, condition: left === 0 ? 'DAMAGED' : e.condition } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: l.campusId, action: 'CREATE', entityType: 'LAB_BREAKAGE', entityId: row.id, newValues: { ...input, lab: l.name } }, client);
      return { id: row.id, status: row.status };
    });
  }

  decideBreakage(id: string, action: 'CHARGE' | 'WAIVE', reason: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await tx.$queryRaw`SELECT id FROM lab_breakages WHERE id = ${id}::uuid FOR UPDATE`;
      const b = await tx.labBreakage.findUnique({ where: { id } });
      if (!b || !this.can(auth, MANAGE, b.campusId)) throw NotFound('Breakage');
      if (b.status !== 'REPORTED') throw Conflict('breakage-decided', 'This breakage is already charged, waived or waiting for approval');
      let status: string;
      if (action === 'WAIVE') {
        await tx.labBreakage.update({ where: { id }, data: { status: 'WAIVED', waiveReason: reason } });
        status = 'WAIVED';
      } else {
        const s = await tx.student.findUniqueOrThrow({ where: { id: b.studentId! }, select: { firstName: true, lastName: true, admissionNo: true } });
        const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'LAB_BREAKAGE', entityId: b.id, campusId: b.campusId, amount: Number(dec(b.chargeAmount)), summary: `Lab breakage ₹${dec(b.chargeAmount)} for ${fullName(s)} (${s.admissionNo}): ${b.itemDescription}`.slice(0, 300) }, client);
        if (req) { await tx.labBreakage.update({ where: { id }, data: { status: 'PENDING_APPROVAL', approvalRequestId: req.id } }); status = 'PENDING_APPROVAL'; }
        else { await this.charge(tx, b.id, auth.userId); status = 'CHARGED'; }
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: b.campusId, action: 'STATUS_CHANGE', entityType: 'LAB_BREAKAGE', entityId: id, oldValues: { status: b.status }, newValues: { status, reason } }, client);
      return { status };
    });
  }

  private async charge(tx: Tx, breakageId: string, userId: string) {
    const b = await tx.labBreakage.findUniqueOrThrow({ where: { id: breakageId } });
    const head = await tx.feeHead.findFirst({ where: { feeType: 'FINE', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!head) throw Conflict('no-fine-head', 'Add a fee head of type Fine in Fees → Setup first');
    const s = await tx.student.findUniqueOrThrow({ where: { id: b.studentId! }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    const lab = await tx.lab.findUniqueOrThrow({ where: { id: b.labId }, select: { name: true } });
    const inv = await this.billing.chargeInTx(tx, s, { feeHeadId: head.id, amount: fromPaise(toPaise(dec(b.chargeAmount))), dueDate: todayIST(), description: `Lab breakage · ${lab.name} · ${b.itemDescription}`.slice(0, 200) }, userId);
    await tx.labBreakage.update({ where: { id: b.id }, data: { status: 'CHARGED', feeInvoiceId: inv.id } });
  }

  private async breakageDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const b = await tx.labBreakage.findUnique({ where: { id: d.entityId } });
    if (!b || b.status !== 'PENDING_APPROVAL') return;
    if (d.decision === 'APPROVED') await this.charge(tx, b.id, d.userId);
    else await tx.labBreakage.update({ where: { id: b.id }, data: { status: 'WAIVED', waiveReason: d.decision === 'REJECTED' ? 'Charge not approved' : 'Charge request cancelled' } });
  }

  /** Students of the campuses the user works with labs in (for breakages). */
  people(auth: AuthContext, q: string) {
    const c = this.readable(auth);
    return this.db.run(this.ctx(auth), (tx) => searchPeople(tx, q, c, ['STUDENT']));
  }
}
