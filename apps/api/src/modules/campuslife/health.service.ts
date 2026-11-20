import { Injectable } from '@nestjs/common';
import { CheckupInput, HealthProfileInput, PERMISSIONS, VaccinationInput, VisitInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { addDays, day, fullName, iso, scopeCampuses, searchPeople, tellParents, todayIST } from './common';

const READ = PERMISSIONS.HEALTH_READ;
const MANAGE = PERMISSIONS.HEALTH_MANAGE;
const OUTCOME_TEXT: Record<string, string> = { RETURNED_TO_CLASS: 'Sent back to class.', REST: 'Rested in the infirmary.', SENT_HOME: 'Sent home â€” please collect your child or arrange for them to be picked up.', HOSPITAL_REFERRED: 'Referred to a hospital â€” the school will call you.' };
const when = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));

/**
 * Health & infirmary (M16.3). Health records need the health right for the student's campus; wardens
 * with the hostel health right see only the students staying in a hostel they are warden of. Parents
 * are told when a child is sent home or referred to hospital.
 */
@Injectable()
export class HealthService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** Students the user may read: campus right, or the hostel-health right for their own hostels' residents. */
  private async canRead(tx: Tx, auth: AuthContext, s: { id: string; campusId: string }) {
    const r = scopeFor(auth, READ) ?? scopeFor(auth, MANAGE);
    if (r && canAccessCampus(r, s.campusId)) return true;
    if (!scopeFor(auth, PERMISSIONS.HEALTH_HOSTEL)) return false;
    const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
    if (!me) return false;
    return !!(await tx.hostelAllotment.findFirst({ where: { studentId: s.id, status: 'CHECKED_IN', bed: { room: { hostel: { wardenEmployeeId: me.id } } } }, select: { id: true } }));
  }
  private async student(tx: Tx, id: string, auth: AuthContext, manage: boolean) {
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, admissionNo: true, campusId: true, bloodGroup: true, dob: true, gender: true } });
    if (!s) throw NotFound('Student');
    const ok = manage ? (() => { const m = scopeFor(auth, MANAGE); return !!m && canAccessCampus(m, s.campusId); })() : await this.canRead(tx, auth, s);
    if (!ok) throw NotFound('Student');
    return s;
  }

  people(q: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => searchPeople(tx, q, scopeCampuses(scopeFor(auth, MANAGE) ?? scopeFor(auth, READ)), ['STUDENT', 'EMPLOYEE']));
  }

  /** Everything health-related about one student. */
  record(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, false);
      const p = await tx.studentHealthProfile.findFirst({ where: { studentId } });
      const visits = await tx.infirmaryVisit.findMany({ where: { studentId }, orderBy: { visitAt: 'desc' }, take: 30 });
      const checkups = await tx.healthCheckup.findMany({ where: { studentId }, orderBy: { checkupDate: 'desc' } });
      const vacc = await tx.vaccination.findMany({ where: { studentId }, orderBy: [{ vaccinationDate: 'desc' }] });
      const users = new Map((await tx.user.findMany({ where: { id: { in: [...visits.map((v) => v.attendedBy), p?.updatedBy].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const m = scopeFor(auth, MANAGE);
      const sec = await tx.studentEnrollment.findFirst({ where: { studentId, status: 'ACTIVE' }, select: { section: { select: { name: true, level: { select: { name: true } } } } } });
      return {
        student: { id: s.id, name: fullName(s), admissionNo: s.admissionNo, bloodGroup: s.bloodGroup, dob: iso(s.dob), gender: s.gender, className: sec ? `${sec.section.level.name} ${sec.section.name}` : null },
        canManage: !!m && canAccessCampus(m, s.campusId),
        profile: p ? { heightCm: num(p.heightCm), weightKg: num(p.weightKg), allergies: p.allergies, conditions: p.conditions, medications: p.medications, disability: p.disability, doctorName: p.doctorName, doctorPhone: p.doctorPhone, updatedAt: p.updatedAt, updatedBy: users.get(p.updatedBy) ?? null } : null,
        visits: visits.map((v) => ({ id: v.id, visitAt: v.visitAt, complaint: v.complaint, temperature: num(v.temperature), treatment: v.treatment, medicine: v.medicine, outcome: v.outcome, parentInformed: v.parentInformed, attendedBy: users.get(v.attendedBy) ?? null })),
        checkups: checkups.map((c) => ({ id: c.id, checkupDate: iso(c.checkupDate), checkupType: c.checkupType, heightCm: num(c.heightCm), weightKg: num(c.weightKg), findings: c.findings, recommendation: c.recommendation, doctorName: c.doctorName })),
        vaccinations: vacc.map((v) => ({ id: v.id, vaccineName: v.vaccineName, doseNo: v.doseNo, vaccinationDate: iso(v.vaccinationDate), nextDueDate: iso(v.nextDueDate), remarks: v.remarks })),
      };
    });
  }

  saveProfile(studentId: string, input: HealthProfileInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      const old = await tx.studentHealthProfile.findFirst({ where: { studentId } });
      const data = { heightCm: input.heightCm ?? null, weightKg: input.weightKg ?? null, allergies: input.allergies, conditions: input.conditions, medications: input.medications, disability: input.disability, doctorName: input.doctorName, doctorPhone: input.doctorPhone ?? null, updatedBy: auth.userId };
      const row = old ? await tx.studentHealthProfile.update({ where: { id: old.id }, data }) : await tx.studentHealthProfile.create({ data: { ...data, tenantId: auth.tenantId!, studentId } });
      // Health details stay out of the audit log: only which fields changed.
      const changed = old ? (Object.keys(data) as (keyof typeof data)[]).filter((k) => k !== 'updatedBy' && String(old[k] ?? '') !== String(data[k] ?? '')) : Object.keys(data).filter((k) => k !== 'updatedBy');
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'HEALTH_PROFILE', entityId: row.id, newValues: { student: s.admissionNo, fieldsChanged: changed } }, client);
      return { id: row.id };
    });
  }

  visits(auth: AuthContext, o: { campusId?: string; from?: string; to?: string }) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, READ) ?? scopeFor(auth, MANAGE);
      if (!s) throw NotFound('Visits');
      const from = o.from ?? addDays(todayIST(), -6);
      const to = o.to ?? todayIST();
      const rows = await tx.infirmaryVisit.findMany({
        where: { ...(o.campusId ? { campusId: o.campusId } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }), visitAt: { gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59+05:30`) } },
        orderBy: { visitAt: 'desc' }, take: 500,
      });
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((x) => [x.id, `${fullName(x)} (${x.admissionNo})`]));
      const em = new Map((await tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true, employeeCode: true } })).map((x) => [x.id, `${fullName(x)} (${x.employeeCode})`]));
      return rows.map((v) => ({ id: v.id, patientType: v.patientType, studentId: v.studentId, name: (v.studentId ? st.get(v.studentId) : em.get(v.employeeId!)) ?? '', visitAt: v.visitAt, complaint: v.complaint, temperature: num(v.temperature), treatment: v.treatment, medicine: v.medicine, outcome: v.outcome, parentInformed: v.parentInformed }));
    });
  }

  addVisit(input: VisitInput, auth: AuthContext, client: ClientInfo) {
    const m = scopeFor(auth, MANAGE);
    if (!m || !canAccessCampus(m, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const p = input.memberType === 'STUDENT'
        ? await tx.student.findUnique({ where: { id: input.memberId }, select: { id: true, firstName: true, lastName: true, campusId: true } })
        : await tx.employee.findUnique({ where: { id: input.memberId }, select: { id: true, firstName: true, lastName: true, campusId: true } });
      if (!p || !canAccessCampus(m, p.campusId)) throw NotFound(input.memberType === 'STUDENT' ? 'Student' : 'Staff member');
      const visitAt = input.visitAt ? new Date(input.visitAt) : new Date();
      const v = await tx.infirmaryVisit.create({
        data: {
          tenantId: auth.tenantId!, campusId: input.campusId, patientType: input.memberType, studentId: input.memberType === 'STUDENT' ? p.id : null, employeeId: input.memberType === 'EMPLOYEE' ? p.id : null,
          visitAt, complaint: input.complaint, temperature: input.temperature ?? null, treatment: input.treatment, medicine: input.medicine, outcome: input.outcome, attendedBy: auth.userId,
        },
      });
      let told = false;
      if (input.memberType === 'STUDENT' && ['SENT_HOME', 'HOSPITAL_REFERRED'].includes(input.outcome)) {
        const name = fullName(p);
        told = await tellParents(tx, this.notifications, {
          tenantId: auth.tenantId!, senderUserId: auth.userId, studentId: p.id, eventCode: 'INFIRMARY_VISIT', entityType: 'INFIRMARY_VISIT', entityId: v.id,
          vars: { student: name, complaint: input.complaint, outcome: OUTCOME_TEXT[input.outcome], time: when(visitAt) },
          emailSubject: `${name} was seen by the school nurse`,
          emailBody: `Dear parent,\n\n${name} was seen in the school infirmary at ${when(visitAt)} for: ${input.complaint}.\n\n${OUTCOME_TEXT[input.outcome]}\n\nPlease contact the school if you have any questions.`,
        });
        if (told) await tx.infirmaryVisit.update({ where: { id: v.id }, data: { parentInformed: true } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'INFIRMARY_VISIT', entityId: v.id, newValues: { patientType: input.memberType, outcome: input.outcome, parentTold: told } }, client);
      return { id: v.id, parentInformed: told };
    });
  }

  addCheckup(studentId: string, input: CheckupInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      const c = await tx.healthCheckup.create({ data: { tenantId: auth.tenantId!, studentId, checkupDate: day(input.checkupDate), checkupType: input.checkupType, heightCm: input.heightCm ?? null, weightKg: input.weightKg ?? null, findings: input.findings, recommendation: input.recommendation, doctorName: input.doctorName, createdBy: auth.userId } });
      if (input.heightCm || input.weightKg) {
        const p = await tx.studentHealthProfile.findFirst({ where: { studentId } });
        const d = { ...(input.heightCm ? { heightCm: input.heightCm } : {}), ...(input.weightKg ? { weightKg: input.weightKg } : {}), updatedBy: auth.userId };
        if (p) await tx.studentHealthProfile.update({ where: { id: p.id }, data: d });
        else await tx.studentHealthProfile.create({ data: { ...d, tenantId: auth.tenantId!, studentId } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'HEALTH_CHECKUP', entityId: c.id, newValues: { student: s.admissionNo, type: input.checkupType, date: input.checkupDate } }, client);
      return { id: c.id };
    });
  }

  addVaccination(studentId: string, input: VaccinationInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      const v = await tx.vaccination.create({ data: { tenantId: auth.tenantId!, studentId, vaccineName: input.vaccineName, doseNo: input.doseNo, vaccinationDate: day(input.vaccinationDate), nextDueDate: input.nextDueDate ? day(input.nextDueDate) : null, remarks: input.remarks, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'VACCINATION', entityId: v.id, newValues: { student: s.admissionNo, vaccine: input.vaccineName, dose: input.doseNo } }, client);
      return { id: v.id };
    });
  }

  remove(kind: 'checkup' | 'vaccination', studentId: string, id: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, true);
      const row = kind === 'checkup' ? await tx.healthCheckup.findUnique({ where: { id } }) : await tx.vaccination.findUnique({ where: { id } });
      if (!row || row.studentId !== studentId) throw NotFound(kind === 'checkup' ? 'Check-up' : 'Vaccination');
      if (kind === 'checkup') await tx.healthCheckup.delete({ where: { id } }); else await tx.vaccination.delete({ where: { id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'DELETE', entityType: kind === 'checkup' ? 'HEALTH_CHECKUP' : 'VACCINATION', entityId: id, oldValues: { student: s.admissionNo } }, client);
      return { removed: true };
    });
  }

  /** Vaccination doses due (or overdue) within the next `days` days â€” the latest dose of each vaccine only. */
  due(auth: AuthContext, days: number, campusId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = scopeFor(auth, READ) ?? scopeFor(auth, MANAGE);
      if (!s) throw NotFound('Vaccinations');
      const until = addDays(todayIST(), days);
      const rows = await tx.vaccination.findMany({ where: { nextDueDate: { not: null, lte: day(until) } }, orderBy: { nextDueDate: 'asc' } });
      const students = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) }, status: 'ACTIVE', ...(campusId ? { campusId } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }) }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((x) => [x.id, x]));
      const later = await tx.vaccination.findMany({ where: { studentId: { in: [...students.keys()] } }, select: { studentId: true, vaccineName: true, doseNo: true } });
      const today = todayIST();
      return rows
        .filter((r) => students.has(r.studentId) && !later.some((l) => l.studentId === r.studentId && l.vaccineName.toLowerCase() === r.vaccineName.toLowerCase() && l.doseNo > r.doseNo))
        .map((r) => { const st = students.get(r.studentId)!; return { studentId: r.studentId, name: fullName(st), admissionNo: st.admissionNo, vaccineName: r.vaccineName, nextDose: r.doseNo + 1, dueDate: iso(r.nextDueDate), overdue: iso(r.nextDueDate)! < today }; });
    });
  }
}


