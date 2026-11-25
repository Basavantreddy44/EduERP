import { HttpStatus, Injectable } from '@nestjs/common';
import { CampEntryInput, HealthCampInput, PERMISSIONS, UpdateHealthCampInput, bmiOf } from '@eduerp/shared';
import { Prisma } from '@eduerp/db';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { day, todayIST } from '../students/student-records';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * Health check-up camps (Phase 21 R5). A camp belongs to one school and date; each child's entry is a
 * normal health check-up (type General) on their record, linked to the camp — one per child and camp.
 */
@Injectable()
export class HealthCampsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  async list(campusId: string | undefined, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.HEALTH_READ);
    if (!scope) throw NotFound('Camp');
    return this.db.run(this.ctx(auth), async (tx) => {
      const camps = await tx.healthCamp.findMany({
        where: { ...(campusId ? { campusId } : {}), ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) },
        orderBy: { campDate: 'desc' }, take: 200,
      });
      const counts = await tx.healthCheckup.groupBy({ by: ['campId'], where: { campId: { in: camps.map((c) => c.id) } }, _count: { _all: true } });
      const referred = await tx.healthCheckup.groupBy({ by: ['campId'], where: { campId: { in: camps.map((c) => c.id) }, referred: true }, _count: { _all: true } });
      const campuses = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return camps.map((c) => ({
        id: c.id, campusId: c.campusId, campus: campuses.get(c.campusId) ?? '', campDate: iso(c.campDate), title: c.title, conductedBy: c.conductedBy, status: c.status,
        screened: counts.find((x) => x.campId === c.id)?._count._all ?? 0, referred: referred.find((x) => x.campId === c.id)?._count._all ?? 0,
      }));
    });
  }

  async create(input: HealthCampInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.HEALTH_MANAGE);
    if (!scope || !canAccessCampus(scope, input.campusId)) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'school-not-allowed', 'Choose one of your schools', [{ field: 'campusId', message: 'One of your schools' }]);
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      const c = await tx.healthCamp.create({ data: { ...input, campDate: day(input.campDate), tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'HEALTH_CAMP', entityId: c.id, newValues: input }, client);
      return { id: c.id };
    });
  }

  private async camp(tx: Tx, id: string, auth: AuthContext, code: typeof PERMISSIONS.HEALTH_READ | typeof PERMISSIONS.HEALTH_MANAGE) {
    const scope = scopeFor(auth, code);
    const c = await tx.healthCamp.findUnique({ where: { id } });
    if (!c || !scope || !canAccessCampus(scope, c.campusId)) throw NotFound('Camp');
    return c;
  }

  async update(id: string, input: UpdateHealthCampInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.camp(tx, id, auth, PERMISSIONS.HEALTH_MANAGE);
      const after = await tx.healthCamp.update({ where: { id }, data: { ...input, ...(input.campDate ? { campDate: day(input.campDate) } : {}) } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: input.status && input.status !== c.status ? 'STATUS_CHANGE' : 'UPDATE', entityType: 'HEALTH_CAMP', entityId: id, oldValues: { title: c.title, campDate: iso(c.campDate), status: c.status }, newValues: input }, client);
      return { id: after.id, status: after.status };
    });
  }

  /** The camp with its classes; with a section, that class sheet (each child and their entry). */
  async get(id: string, sectionId: string | undefined, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.camp(tx, id, auth, PERMISSIONS.HEALTH_READ);
      const manage = scopeFor(auth, PERMISSIONS.HEALTH_MANAGE);
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const sections = year
        ? await tx.section.findMany({
            where: { campusId: c.campusId, academicYearId: year.id, status: 'ACTIVE' },
            orderBy: [{ level: { sequence: 'asc' } }, { name: 'asc' }],
            select: { id: true, name: true, level: { select: { name: true } }, enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } } },
          })
        : [];
      const entries = await tx.healthCheckup.findMany({ where: { campId: id } });
      const done = new Set(entries.map((e) => e.studentId));
      const classes = sections.map((s) => ({ id: s.id, name: `${s.level.name} – ${s.name}`, students: s.enrollments.length, screened: s.enrollments.filter((e) => done.has(e.studentId)).length }));
      const total = classes.reduce((t, x) => t + x.students, 0);
      let sheet = null;
      if (sectionId) {
        const sec = sections.find((s) => s.id === sectionId);
        if (!sec) throw NotFound('Section');
        const students = await tx.student.findMany({ where: { id: { in: sec.enrollments.map((e) => e.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true, gender: true }, orderBy: [{ firstName: 'asc' }] });
        const byStudent = new Map(entries.map((e) => [e.studentId, e]));
        sheet = students.map((s) => {
          const e = byStudent.get(s.id);
          return {
            studentId: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo, gender: s.gender,
            entry: e ? { heightCm: num(e.heightCm), weightKg: num(e.weightKg), bmi: bmiOf(num(e.heightCm), num(e.weightKg)), vision: e.vision, dental: e.dental, skin: e.skin, haemoglobin: num(e.haemoglobin), findings: e.findings, referred: e.referred } : null,
          };
        });
      }
      const campus = await tx.campus.findUnique({ where: { id: c.campusId }, select: { name: true } });
      return {
        id: c.id, campusId: c.campusId, campus: campus?.name ?? '', campDate: iso(c.campDate), title: c.title, conductedBy: c.conductedBy, notes: c.notes, status: c.status,
        canEdit: !!manage && canAccessCampus(manage, c.campusId) && c.status === 'OPEN',
        summary: { students: total, screened: entries.length, referred: entries.filter((e) => e.referred).length, notScreened: Math.max(0, total - classes.reduce((t, x) => t + x.screened, 0)) },
        classes,
        referredList: (await tx.student.findMany({ where: { id: { in: entries.filter((e) => e.referred).map((e) => e.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }))
          .map((s) => ({ studentId: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo, findings: entries.find((e) => e.studentId === s.id)?.findings ?? '' })),
        sheet,
      };
    });
  }

  /** Saves a class sheet: each row creates or updates the child's check-up for this camp. Empty rows are skipped. */
  async saveEntries(id: string, entries: CampEntryInput[], auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await this.camp(tx, id, auth, PERMISSIONS.HEALTH_MANAGE);
      if (c.status !== 'OPEN') throw Conflict('camp-closed', 'This camp is closed. Open it again to change entries.');
      if (c.campDate > todayIST()) throw Conflict('camp-in-future', 'Entries can be made on or after the camp date');
      const ids = [...new Set(entries.map((e) => e.studentId))];
      if (ids.length !== entries.length) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'duplicate-student', 'A child is listed twice');
      const students = await tx.student.findMany({ where: { id: { in: ids }, campusId: c.campusId }, select: { id: true } });
      if (students.length !== ids.length) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'student-other-school', 'Every child must belong to the camp’s school');
      let saved = 0;
      for (const e of entries) {
        const empty = e.heightCm === null && e.weightKg === null && !e.vision && !e.dental && !e.skin && e.haemoglobin === null && !e.findings && !e.referred;
        if (empty) continue;
        const data = {
          heightCm: e.heightCm, weightKg: e.weightKg, vision: e.vision, dental: e.dental, skin: e.skin, haemoglobin: e.haemoglobin,
          findings: e.findings ?? 'Screened at the camp', referred: e.referred, doctorName: c.conductedBy,
        };
        const existing = await tx.healthCheckup.findFirst({ where: { campId: id, studentId: e.studentId }, select: { id: true } });
        if (existing) await tx.healthCheckup.update({ where: { id: existing.id }, data });
        else await tx.healthCheckup.create({ data: { ...data, tenantId: auth.tenantId!, studentId: e.studentId, campId: id, checkupDate: c.campDate, checkupType: 'GENERAL', createdBy: auth.userId } });
        saved++;
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'UPDATE', entityType: 'HEALTH_CAMP', entityId: id, newValues: { entriesSaved: saved, referred: entries.filter((e) => e.referred).length } }, client);
      return { saved };
    });
  }
}
