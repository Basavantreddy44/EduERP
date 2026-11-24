import { Injectable } from '@nestjs/common';
import { GOV_EXPORT_CODES, GOV_FIELDS, GOV_STANDARD_LAYOUTS, GovExportCode, GovLayoutInput, GovProfileInput, GovStaffInput, PERMISSIONS, PermissionCode } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { EntitlementsService } from '../platform/entitlements.service';
import { addDays, day, iso, scopeCampuses, todayIST } from '../campuslife/common';
import { govColumns, govRows, missingFor } from './gov-rows';
import { DietService } from './diet.service';
import { WelfareService } from './welfare.service';

const dec = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const LABEL = new Map(GOV_FIELDS.map((f) => [f.key as string, f.label as string]));

/**
 * Government school pack (improvement round G1, G4, G5): the government-data card of a student,
 * the column layouts of the SATS / UDISE+ exports and the readiness list, government staff details
 * and the DDO code, and the head-office overview of schools by district.
 */
@Injectable()
export class GovtService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly diet: DietService, private readonly welfare: WelfareService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private async student(tx: Tx, id: string, auth: AuthContext, perm: PermissionCode) {
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    const sc = scopeFor(auth, perm);
    if (!s || !sc || !canAccessCampus(sc, s.campusId)) throw NotFound('Student');
    return s;
  }

  // ───────────── G1 Government data card ─────────────

  card(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, PERMISSIONS.STU_STUDENT_READ);
      const g = await tx.studentGovProfile.findFirst({ where: { studentId: s.id } });
      const [row] = await govRows(tx, [s.campusId], { studentIds: [s.id] });
      const edit = scopeFor(auth, PERMISSIONS.STU_STUDENT_MANAGE);
      return {
        studentId: s.id,
        profile: {
          satsId: g?.satsId ?? null, penNo: g?.penNo ?? null, rationCardType: g?.rationCardType ?? null, isEws: g?.isEws ?? null, minorityGroup: g?.minorityGroup ?? null, isCwsn: g?.isCwsn ?? false,
          disabilityType: g?.disabilityType ?? null, mediumOfInstruction: g?.mediumOfInstruction ?? null, distanceKm: dec(g?.distanceKm), previousSchool: g?.previousSchool ?? null,
        },
        missing: row ? Object.fromEntries(GOV_EXPORT_CODES.map((c) => [c, missingFor(c, row)])) : { SATS: [], UDISE: [] },
        updatedAt: g?.updatedAt ?? null,
        canEdit: !!edit && canAccessCampus(edit, s.campusId),
      };
    });
  }

  saveCard(studentId: string, input: GovProfileInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth, PERMISSIONS.STU_STUDENT_MANAGE);
      const old = await tx.studentGovProfile.findFirst({ where: { studentId: s.id } });
      const data = {
        satsId: input.satsId, penNo: input.penNo, rationCardType: input.rationCardType, isEws: input.isEws, minorityGroup: input.minorityGroup, isCwsn: input.isCwsn,
        disabilityType: input.isCwsn ? input.disabilityType : null, mediumOfInstruction: input.mediumOfInstruction, distanceKm: input.distanceKm == null ? null : String(input.distanceKm), previousSchool: input.previousSchool, updatedBy: auth.userId,
      };
      if (old) await tx.studentGovProfile.update({ where: { id: old.id }, data });
      else await tx.studentGovProfile.create({ data: { tenantId: auth.tenantId!, studentId: s.id, ...data } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'STUDENT_GOV_PROFILE', entityId: s.id, oldValues: old ? { satsId: old.satsId, penNo: old.penNo, rationCardType: old.rationCardType, isCwsn: old.isCwsn } : undefined, newValues: input }, client);
      return { studentId: s.id };
    });
  }

  // ───────────── G1 Export layouts & readiness ─────────────

  layouts(auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const out = [];
      for (const code of GOV_EXPORT_CODES) {
        const own = await tx.govExportLayout.findFirst({ where: { exportCode: code } });
        out.push({ code, columns: await govColumns(tx, code), standard: GOV_STANDARD_LAYOUTS[code].map((k) => ({ key: k, label: LABEL.get(k)! })), custom: !!own, updatedAt: own?.updatedAt ?? null });
      }
      return { layouts: out, fields: GOV_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required })), canEdit: !!scopeFor(auth, PERMISSIONS.GOV_EXPORT_MANAGE) };
    });
  }

  saveLayout(code: GovExportCode, input: GovLayoutInput | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const old = await tx.govExportLayout.findFirst({ where: { exportCode: code } });
      if (!input) {
        if (old) await tx.govExportLayout.delete({ where: { id: old.id } });
      } else if (old) await tx.govExportLayout.update({ where: { id: old.id }, data: { columns: input.columns, updatedBy: auth.userId } });
      else await tx.govExportLayout.create({ data: { tenantId: auth.tenantId!, exportCode: code, columns: input.columns, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: input ? 'UPDATE' : 'DELETE', entityType: 'GOV_EXPORT_LAYOUT', entityId: old?.id ?? null, oldValues: old ? { columns: old.columns } : undefined, newValues: { export: code, columns: input?.columns ?? 'standard' } }, client);
      return { code, columns: await govColumns(tx, code) };
    });
  }

  /** Students missing a field the SATS or UDISE+ export needs, by campus. */
  readiness(auth: AuthContext, campusId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const campuses = scopeCampuses(scopeFor(auth, PERMISSIONS.STU_STUDENT_READ));
      const rows = await govRows(tx, campuses, { campusId });
      const names = new Map((await tx.campus.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      const byCampus = new Map<string, { campusId: string; campus: string; students: number; SATS: number; UDISE: number }>();
      const gaps: { studentId: string; name: string; admissionNo: string | null; className: string | null; campus: string; SATS: string[]; UDISE: string[] }[] = [];
      for (const r of rows) {
        const c = byCampus.get(r.campusId) ?? { campusId: r.campusId, campus: names.get(r.campusId) ?? '', students: 0, SATS: 0, UDISE: 0 };
        c.students++;
        const sats = missingFor('SATS', r);
        const udise = missingFor('UDISE', r);
        if (!sats.length) c.SATS++;
        if (!udise.length) c.UDISE++;
        byCampus.set(r.campusId, c);
        if (sats.length || udise.length) gaps.push({ studentId: r.studentId, name: String(r.name), admissionNo: r.admissionNo as string | null, className: [r.className, r.section].filter(Boolean).join(' ') || null, campus: names.get(r.campusId) ?? '', SATS: sats, UDISE: udise });
      }
      return { campuses: [...byCampus.values()].sort((a, b) => a.campus.localeCompare(b.campus)), students: gaps.slice(0, 500), totalWithGaps: gaps.length };
    });
  }

  // ───────────── G4 Government staff details & DDO code ─────────────

  private async employee(tx: Tx, id: string, auth: AuthContext, perm: PermissionCode) {
    const e = await tx.employee.findUnique({ where: { id }, select: { id: true, campusId: true, tenantId: true } });
    const sc = scopeFor(auth, perm);
    if (!e || !sc || !canAccessCampus(sc, e.campusId)) throw NotFound('Staff member');
    return e;
  }

  staff(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, PERMISSIONS.HR_PROFILE_READ);
      const d = await tx.employeeDetail.findFirst({ where: { employeeId: e.id } });
      const campus = await tx.campus.findUnique({ where: { id: e.campusId }, select: { ddoCode: true } });
      const m = scopeFor(auth, PERMISSIONS.HR_PROFILE_MANAGE);
      return {
        govtEmployment: d?.govtEmployment ?? null, kgidNo: d?.kgidNo ?? null, hrmsId: d?.hrmsId ?? null, pranNo: d?.pranNo ?? null, gpfNo: d?.gpfNo ?? null, payScale: d?.payScale ?? null, govtServiceDate: iso(d?.govtServiceDate),
        ddoCode: campus?.ddoCode ?? null, canEdit: !!m && canAccessCampus(m, e.campusId),
      };
    });
  }

  saveStaff(id: string, input: GovStaffInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await this.employee(tx, id, auth, PERMISSIONS.HR_PROFILE_MANAGE);
      const old = await tx.employeeDetail.findFirst({ where: { employeeId: e.id } });
      const data = { govtEmployment: input.govtEmployment, kgidNo: input.kgidNo, hrmsId: input.hrmsId, pranNo: input.pranNo, gpfNo: input.gpfNo, payScale: input.payScale, govtServiceDate: input.govtServiceDate ? day(input.govtServiceDate) : null, updatedBy: auth.userId };
      if (old) await tx.employeeDetail.update({ where: { id: old.id }, data });
      else await tx.employeeDetail.create({ data: { tenantId: e.tenantId, employeeId: e.id, ...data } });
      await this.audit.log(tx, { tenantId: e.tenantId, userId: auth.userId, campusId: e.campusId, action: old ? 'UPDATE' : 'CREATE', entityType: 'EMPLOYEE_GOVT', entityId: e.id, oldValues: old ? { govtEmployment: old.govtEmployment, kgidNo: old.kgidNo, hrmsId: old.hrmsId, pranNo: old.pranNo, gpfNo: old.gpfNo, payScale: old.payScale } : undefined, newValues: input }, client);
      return { id: e.id };
    });
  }

  saveDdo(campusId: string, ddoCode: string | null, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.campus.findUnique({ where: { id: campusId }, select: { id: true, ddoCode: true } });
      const sc = scopeFor(auth, PERMISSIONS.ORG_CAMPUS_UPDATE);
      if (!c || !sc || !canAccessCampus(sc, c.id)) throw NotFound('Campus');
      await tx.campus.update({ where: { id: c.id }, data: { ddoCode } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.id, action: 'UPDATE', entityType: 'CAMPUS', entityId: c.id, oldValues: { ddoCode: c.ddoCode }, newValues: { ddoCode } }, client);
      return { id: c.id, ddoCode };
    });
  }

  // ───────────── G5 Head-office overview ─────────────

  overview(auth: AuthContext, district?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const scope = scopeCampuses(scopeFor(auth, PERMISSIONS.OVERVIEW_READ));
      const on = await EntitlementsService.enabledModules(tx);
      const campuses = await tx.campus.findMany({ where: { status: 'ACTIVE', ...(scope ? { id: { in: scope } } : {}), ...(district ? { district } : {}) }, orderBy: [{ district: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, district: true, udiseCode: true } });
      const ids = campuses.map((c) => c.id);
      const today = todayIST();
      const yesterday = addDays(today, -1);
      const monthStart = `${today.slice(0, 8)}01`;

      const [students, staff, attendance, roll, meals, results, gov] = await Promise.all([
        tx.student.groupBy({ by: ['campusId', 'gender'], where: { campusId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
        tx.employee.groupBy({ by: ['campusId'], where: { campusId: { in: ids }, status: { notIn: ['RESIGNED', 'TERMINATED', 'EXITED'] } }, _count: { _all: true } }),
        on.has('ATTENDANCE') ? tx.$queryRaw<{ campus_id: string; marked: bigint; present: bigint }[]>`
          SELECT s.campus_id, COUNT(DISTINCT r.student_id) AS marked,
                 COUNT(DISTINCT r.student_id) FILTER (WHERE r.status IN ('PRESENT','LATE','HALF_DAY')) AS present
          FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
          WHERE r.attendance_date = ${day(today)}::date GROUP BY s.campus_id` : Promise.resolve([]),
        on.has('HOSTEL') ? tx.$queryRaw<{ campus_id: string; marked: bigint; present: bigint }[]>`
          SELECT h.campus_id, COUNT(*) AS marked, COUNT(*) FILTER (WHERE r.status = 'PRESENT') AS present
          FROM hostel_roll_calls r JOIN hostels h ON h.id = r.hostel_id
          WHERE r.attendance_date = ${day(today)}::date GROUP BY h.campus_id` : Promise.resolve([]),
        on.has('HOSTEL') ? tx.mealCount.findMany({ where: { campusId: { in: ids }, mealDate: day(yesterday) } }) : Promise.resolve([]),
        on.has('EXAMS') ? tx.$queryRaw<{ campus_id: string; total: bigint; passed: bigint }[]>`
          WITH latest AS (
            SELECT DISTINCT ON (p.section_id, p.term_code) p.id, p.section_id FROM result_publications p
            WHERE p.status = 'PUBLISHED' ORDER BY p.section_id, p.term_code, p.version DESC),
          recent AS (
            SELECT l.id, sec.campus_id FROM latest l JOIN sections sec ON sec.id = l.section_id
            JOIN academic_years y ON y.id = sec.academic_year_id WHERE y.is_current)
          SELECT recent.campus_id, COUNT(*) AS total, COUNT(*) FILTER (WHERE er.result_status = 'PASS') AS passed
          FROM exam_results er JOIN recent ON recent.id = er.publication_id GROUP BY recent.campus_id` : Promise.resolve([]),
        govRows(tx, ids, {}),
      ]);
      const diet = on.has('HOSTEL') && on.has('INVENTORY') ? await this.diet.summaryByCampus(tx, ids, monthStart, yesterday < monthStart ? monthStart : yesterday) : new Map<string, { flagged: number; items: number }>();
      const welfare = await this.welfare.summaryByCampus(tx, ids);

      const n = (v: bigint | number | undefined) => Number(v ?? 0);
      const rows = campuses.map((c) => {
        const st = students.filter((s) => s.campusId === c.id);
        const boys = st.filter((s) => s.gender === 'MALE').reduce((t, s) => t + s._count._all, 0);
        const girls = st.filter((s) => s.gender === 'FEMALE').reduce((t, s) => t + s._count._all, 0);
        const total = st.reduce((t, s) => t + s._count._all, 0);
        const att = attendance.find((a) => a.campus_id === c.id);
        const rc = roll.find((a) => a.campus_id === c.id);
        const fed = meals.filter((m) => m.campusId === c.id).reduce((t, m) => t + Math.max(m.breakfast, m.lunch, m.snacks, m.dinner), 0);
        const res = results.find((r) => r.campus_id === c.id);
        const g = gov.filter((r) => r.campusId === c.id);
        const ready = (code: GovExportCode) => (g.length ? Math.round((g.filter((r) => !missingFor(code, r).length).length * 100) / g.length) : null);
        const w = welfare.get(c.id);
        const d = diet.get(c.id);
        return {
          campusId: c.id, code: c.code, name: c.name, district: c.district ?? null, udiseCode: c.udiseCode,
          students: total, boys, girls, staff: staff.find((s) => s.campusId === c.id)?._count._all ?? 0,
          attendanceToday: att && n(att.marked) ? { present: n(att.present), marked: n(att.marked), percent: Math.round((n(att.present) * 1000) / n(att.marked)) / 10 } : null,
          hostelToday: rc && n(rc.marked) ? { present: n(rc.present), marked: n(rc.marked), percent: Math.round((n(rc.present) * 1000) / n(rc.marked)) / 10 } : null,
          fedYesterday: meals.some((m) => m.campusId === c.id) ? fed : null,
          diet: d ? { flagged: d.flagged, items: d.items } : null,
          welfare: w ? { due: w.due, given: w.given, percent: w.due ? Math.round((w.given * 1000) / w.due) / 10 : null } : null,
          readiness: { SATS: ready('SATS'), UDISE: ready('UDISE') },
          results: res && n(res.total) ? { passed: n(res.passed), total: n(res.total), percent: Math.round((n(res.passed) * 1000) / n(res.total)) / 10 } : null,
        };
      });
      const districts = [...new Set(rows.map((r) => r.district ?? ''))].map((dname) => {
        const rs = rows.filter((r) => (r.district ?? '') === dname);
        const sum = (f: (r: (typeof rows)[number]) => number) => rs.reduce((t, r) => t + f(r), 0);
        const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : null);
        const aP = sum((r) => r.attendanceToday?.present ?? 0), aM = sum((r) => r.attendanceToday?.marked ?? 0);
        const hP = sum((r) => r.hostelToday?.present ?? 0), hM = sum((r) => r.hostelToday?.marked ?? 0);
        const wG = sum((r) => r.welfare?.given ?? 0), wD = sum((r) => r.welfare?.due ?? 0);
        const rP = sum((r) => r.results?.passed ?? 0), rT = sum((r) => r.results?.total ?? 0);
        return {
          district: dname || null, schools: rs.length, students: sum((r) => r.students), boys: sum((r) => r.boys), girls: sum((r) => r.girls), staff: sum((r) => r.staff),
          attendancePercent: pct(aP, aM), hostelPercent: pct(hP, hM), fedYesterday: sum((r) => r.fedYesterday ?? 0), dietFlagged: sum((r) => r.diet?.flagged ?? 0), welfarePercent: pct(wG, wD), resultsPercent: pct(rP, rT),
        };
      });
      const allDistricts = (await tx.campus.findMany({ where: { status: 'ACTIVE', ...(scope ? { id: { in: scope } } : {}) }, distinct: ['district'], select: { district: true } })).map((d) => d.district).filter((d): d is string => !!d).sort();
      return { date: today, mealsDate: yesterday, monthStart, rows, districts, allDistricts, modules: { attendance: on.has('ATTENDANCE'), hostel: on.has('HOSTEL'), exams: on.has('EXAMS'), diet: on.has('HOSTEL') && on.has('INVENTORY') } };
    });
  }

}
