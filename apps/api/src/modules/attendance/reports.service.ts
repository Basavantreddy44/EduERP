import { Injectable } from '@nestjs/common';
import {
  ATTENDED_VALUE, AttendanceStatus, PERMISSIONS, RegisterQuery, StaffMonthQuery, StudentPctQuery, WeeklyOff, attendancePct, isWeeklyOff,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { buildSheet } from '../imports/spreadsheet';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthDays = (m: string) => {
  const first = `${m}-01`;
  const next = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const out: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) out.push(d);
  return out;
};
const SHORT: Record<string, string> = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', HALF_DAY: 'H', LEAVE: 'LV', ON_DUTY: 'OD' };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Tally = { marked: number; attended: number; PRESENT: number; ABSENT: number; LATE: number; HALF_DAY: number; LEAVE: number };
const empty = (): Tally => ({ marked: 0, attended: 0, PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, LEAVE: 0 });
const add = (t: Tally, st: AttendanceStatus) => { t.marked += 1; t.attended += ATTENDED_VALUE[st]; t[st] += 1; };

export interface FileOut { fileName: string; contentType: string; data: Buffer }

/**
 * Attendance reports (M3.5): the monthly class register, student attendance % over any period (with
 * the below-minimum list) and the staff month summary. Counted from submitted sheets only: present
 * and late = 1, half day = ½, absent and leave = 0 (leave is shown separately). The Excel file holds
 * exactly the rows on screen.
 */
@Injectable()
export class AttendanceReportsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** Day columns: holiday / weekly off / future flags. */
  private async dayInfo(tx: Tx, campusId: string, days: string[], from: string, to: string) {
    const off = await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', campusId);
    const hol = new Map((await tx.holiday.findMany({ where: { holidayDate: { gte: new Date(`${days[0]}T00:00:00Z`), lte: new Date(`${days[days.length - 1]}T00:00:00Z`) }, OR: [{ campusId: null }, { campusId }] }, select: { holidayDate: true, name: true } })).map((h) => [iso(h.holidayDate), h.name]));
    const today = todayIST();
    return days.map((d) => ({
      date: d, dow: new Date(`${d}T00:00:00Z`).getUTCDay(),
      kind: d > today ? 'future' : d < from || d > to ? 'outside' : hol.has(d) ? 'holiday' : isWeeklyOff(d, off) ? 'off' : 'working',
      holiday: hol.get(d) ?? null,
    }));
  }

  private async file(auth: AuthContext, client: ClientInfo, kind: string, title: string, headers: string[], rows: (string | number | null)[][]): Promise<FileOut> {
    await this.db.run(this.ctx(auth), (tx) => this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'EXPORT', entityType: 'ATTENDANCE_REPORT', entityId: null, newValues: { report: kind, title, rows: rows.length } }, client));
    return { fileName: `${title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}.xlsx`, contentType: XLSX, data: await buildSheet(title, headers, rows) };
  }

  // ───────────── Monthly class register ─────────────

  async register(q: RegisterQuery, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.section.findUnique({ where: { id: q.sectionId }, select: { id: true, name: true, campusId: true, academicYear: { select: { name: true, startDate: true, endDate: true } }, level: { select: { name: true, program: { select: { name: true } } } } } });
      if (!s || !canAccessCampus(scope, s.campusId)) throw NotFound('Section');
      const all = monthDays(q.month);
      const days = await this.dayInfo(tx, s.campusId, all, iso(s.academicYear.startDate), iso(s.academicYear.endDate));
      const first = all[0];
      const last = all[all.length - 1];
      // Everyone placed in the section on any day of the month.
      const students = await tx.$queryRaw<{ id: string; firstName: string; lastName: string | null; admissionNo: string; rollNo: string | null; fromDate: Date; toDate: Date | null }[]>`
        SELECT st.id, st.first_name AS "firstName", st.last_name AS "lastName", st.admission_no AS "admissionNo", max(e.roll_no) AS "rollNo",
               min(e.enrolled_on) AS "fromDate", CASE WHEN bool_or(e.ended_on IS NULL) THEN NULL ELSE max(e.ended_on) END AS "toDate"
          FROM student_enrollments e JOIN students st ON st.id = e.student_id
         WHERE e.section_id = ${s.id}::uuid AND e.status <> 'CANCELLED' AND e.enrolled_on <= ${last}::date AND (e.ended_on IS NULL OR e.ended_on > ${first}::date)
         GROUP BY st.id
         ORDER BY NULLIF(regexp_replace(max(e.roll_no), '\\D', '', 'g'), '')::int NULLS LAST, st.first_name, st.last_name`;
      const marks = await tx.$queryRaw<{ studentId: string; date: Date; status: AttendanceStatus }[]>`
        SELECT r.student_id AS "studentId", r.attendance_date AS date, r.status
          FROM attendance_records r JOIN attendance_sessions a ON a.id = r.session_id
         WHERE a.section_id = ${s.id}::uuid AND a.status <> 'DRAFT' AND r.attendance_date BETWEEN ${first}::date AND ${last}::date`;
      const taken = new Set((await tx.$queryRaw<{ date: Date }[]>`
        SELECT DISTINCT attendance_date AS date FROM attendance_sessions WHERE section_id = ${s.id}::uuid AND status <> 'DRAFT' AND attendance_date BETWEEN ${first}::date AND ${last}::date`).map((r) => iso(r.date)));

      const byStudent = new Map<string, Map<string, AttendanceStatus[]>>();
      for (const m of marks) {
        const d = iso(m.date);
        if (!byStudent.has(m.studentId)) byStudent.set(m.studentId, new Map());
        const cell = byStudent.get(m.studentId)!;
        cell.set(d, [...(cell.get(d) ?? []), m.status]);
      }
      const dayTotals: Record<string, { present: number; absent: number; marked: number }> = {};
      const rows = students.map((st) => {
        const t = empty();
        const cells: Record<string, string> = {};
        for (const d of all) {
          const ms = byStudent.get(st.id)?.get(d);
          if (!ms) continue;
          for (const m of ms) add(t, m);
          // Period-wise days show attended / marked periods unless every period had the same mark.
          cells[d] = ms.every((m) => m === ms[0]) ? SHORT[ms[0]] : `${ms.reduce((a, m) => a + ATTENDED_VALUE[m], 0)}/${ms.length}`;
          const dt = (dayTotals[d] ??= { present: 0, absent: 0, marked: 0 });
          dt.marked += 1;
          if (ms.some((m) => ATTENDED_VALUE[m] > 0)) dt.present += 1;
          else if (ms.every((m) => m === 'ABSENT')) dt.absent += 1;
        }
        return {
          id: st.id, name: `${st.firstName} ${st.lastName ?? ''}`.trim(), admissionNo: st.admissionNo, rollNo: st.rollNo,
          placedFrom: iso(st.fromDate), placedTo: st.toDate ? iso(st.toDate) : null, cells,
          present: t.PRESENT, late: t.LATE, halfDay: t.HALF_DAY, absent: t.ABSENT, leave: t.LEAVE, marked: t.marked, attended: t.attended, pct: attendancePct(t.attended, t.marked),
        };
      });
      const min = await this.settings.effective<number>(tx, 'attendance.min_percent', s.campusId);
      const tot = rows.reduce((a, r) => ({ attended: a.attended + r.attended, marked: a.marked + r.marked }), { attended: 0, marked: 0 });
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}`, programName: s.level.program.name, year: s.academicYear.name, campusId: s.campusId },
        month: q.month, minPercent: min,
        days: days.map((d) => ({ ...d, taken: taken.has(d.date), ...(dayTotals[d.date] ?? { present: 0, absent: 0, marked: 0 }) })),
        students: rows,
        summary: { students: rows.length, daysTaken: taken.size, workingDays: days.filter((d) => d.kind === 'working').length, pct: attendancePct(tot.attended, tot.marked), below: rows.filter((r) => r.pct !== null && r.pct < min).length },
      };
    });
  }

  async registerFile(q: RegisterQuery, auth: AuthContext, client: ClientInfo) {
    const r = await this.register(q, auth);
    const used = r.days.filter((d) => d.kind !== 'future' && d.kind !== 'outside');
    const headers = ['Roll', 'Name', 'Admission no', ...used.map((d) => d.date.slice(8)), 'Present', 'Late', 'Half day', 'Absent', 'Leave', 'Marked', 'Attendance %'];
    const rows = r.students.map((s) => [s.rollNo ?? '', s.name, s.admissionNo, ...used.map((d) => s.cells[d.date] ?? (d.kind === 'holiday' ? 'Hol' : d.kind === 'off' ? '' : '')), s.present, s.late, s.halfDay, s.absent, s.leave, s.marked, s.pct ?? '']);
    return this.file(auth, client, 'REGISTER', `Register ${r.section.name} ${q.month}`, headers, rows);
  }

  // ───────────── Student % over a period ─────────────

  async students(q: StudentPctQuery, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ)!;
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (q.sectionId) {
        const sec = await tx.section.findUnique({ where: { id: q.sectionId }, select: { campusId: true } });
        if (!sec || !canAccessCampus(scope, sec.campusId)) throw NotFound('Section');
      }
      const campusIds = q.campusId ? [q.campusId] : scope.all ? null : scope.campusIds;
      const rows = await tx.$queryRaw<{ studentId: string; status: AttendanceStatus; n: number; lastSection: string }[]>`
        SELECT r.student_id AS "studentId", r.status, count(*)::int AS n,
               (array_agg(a.section_id::text ORDER BY r.attendance_date DESC))[1] AS "lastSection"
          FROM attendance_records r
          JOIN attendance_sessions a ON a.id = r.session_id
          JOIN sections sec ON sec.id = a.section_id
         WHERE a.status <> 'DRAFT' AND r.attendance_date BETWEEN ${q.from}::date AND ${q.to}::date
           AND (${campusIds}::uuid[] IS NULL OR a.campus_id = ANY(${campusIds}::uuid[]))
           AND (${q.sectionId ?? null}::uuid IS NULL OR a.section_id = ${q.sectionId ?? null}::uuid)
           AND (${q.programLevelId ?? null}::uuid IS NULL OR sec.program_level_id = ${q.programLevelId ?? null}::uuid)
         GROUP BY r.student_id, r.status`;
      const tallies = new Map<string, Tally & { lastSection: string }>();
      for (const r of rows) {
        const t = tallies.get(r.studentId) ?? { ...empty(), lastSection: r.lastSection };
        t.marked += r.n; t.attended += ATTENDED_VALUE[r.status] * r.n; t[r.status] += r.n;
        tallies.set(r.studentId, t);
      }
      const ids = [...tallies.keys()];
      const people = new Map((await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, admissionNo: true, status: true, campusId: true } })).map((p) => [p.id, p]));
      const secIds = [...new Set([...tallies.values()].map((t) => t.lastSection))];
      const secs = new Map((await tx.section.findMany({ where: { id: { in: secIds } }, select: { id: true, name: true, level: { select: { name: true, sequence: true } } } })).map((x) => [x.id, x]));
      const firstCampus = q.campusId ?? [...people.values()][0]?.campusId ?? null;
      const min = await this.settings.effective<number>(tx, 'attendance.min_percent', firstCampus);
      const threshold = q.below ?? (q.belowMin === 'true' ? min : null);
      let items = ids.map((id) => {
        const t = tallies.get(id)!;
        const p = people.get(id)!;
        const sec = secs.get(t.lastSection);
        return {
          id, name: `${p.firstName} ${p.lastName ?? ''}`.trim(), admissionNo: p.admissionNo, status: p.status, className: sec ? `${sec.level.name} – ${sec.name}` : '', levelSeq: sec?.level.sequence ?? 0,
          present: t.PRESENT, late: t.LATE, halfDay: t.HALF_DAY, absent: t.ABSENT, leave: t.LEAVE, marked: t.marked, attended: t.attended, pct: attendancePct(t.attended, t.marked)!,
        };
      });
      const all = items;
      if (threshold !== null) items = items.filter((i) => i.pct < threshold);
      items.sort((a, b) => a.pct - b.pct || a.levelSeq - b.levelSeq || a.className.localeCompare(b.className) || a.name.localeCompare(b.name));
      const tot = all.reduce((a, r) => ({ attended: a.attended + r.attended, marked: a.marked + r.marked }), { attended: 0, marked: 0 });
      return {
        from: q.from, to: q.to, minPercent: min, threshold,
        items: items.map(({ levelSeq: _l, ...r }) => r),
        summary: { students: all.length, shown: items.length, pct: attendancePct(tot.attended, tot.marked), belowMin: all.filter((r) => r.pct < min).length },
      };
    });
  }

  async studentsFile(q: StudentPctQuery, auth: AuthContext, client: ClientInfo) {
    const r = await this.students(q, auth);
    const headers = ['Name', 'Admission no', 'Class', 'Present', 'Late', 'Half day', 'Absent', 'Leave', 'Marked', 'Attended', 'Attendance %'];
    const rows = r.items.map((s) => [s.name, s.admissionNo, s.className, s.present, s.late, s.halfDay, s.absent, s.leave, s.marked, s.attended, s.pct]);
    return this.file(auth, client, 'STUDENT_PCT', `Attendance ${q.from} to ${q.to}${r.threshold ? ` below ${r.threshold}` : ''}`, headers, rows);
  }

  // ───────────── Staff month ─────────────

  async staff(q: StaffMonthQuery, auth: AuthContext) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.STAFF_ATT_MARK) ?? { all: false, campusIds: [] }, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const all = monthDays(q.month);
      const first = all[0];
      const last = all[all.length - 1];
      const days = await this.dayInfo(tx, q.campusId, all, first, last);
      const people = await tx.employee.findMany({
        where: { campusId: q.campusId, joiningDate: { lte: new Date(`${last}T00:00:00Z`) }, OR: [{ leftOn: null }, { leftOn: { gte: new Date(`${first}T00:00:00Z`) } }] },
        orderBy: [{ employeeType: 'asc' }, { firstName: 'asc' }],
        select: { id: true, employeeCode: true, firstName: true, lastName: true, designation: true, joiningDate: true, leftOn: true },
      });
      const marks = await tx.staffAttendance.findMany({ where: { campusId: q.campusId, attendanceDate: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) } }, select: { employeeId: true, attendanceDate: true, status: true } });
      const by = new Map<string, Map<string, string>>();
      for (const m of marks) { if (!by.has(m.employeeId)) by.set(m.employeeId, new Map()); by.get(m.employeeId)!.set(iso(m.attendanceDate), m.status); }
      const value: Record<string, number> = { PRESENT: 1, ON_DUTY: 1, HALF_DAY: 0.5, ABSENT: 0, LEAVE: 0 };
      const rows = people.map((p) => {
        const m = by.get(p.id) ?? new Map<string, string>();
        const c: Record<string, number> = { PRESENT: 0, ABSENT: 0, HALF_DAY: 0, LEAVE: 0, ON_DUTY: 0 };
        let attended = 0;
        const cells: Record<string, string> = {};
        for (const [d, st] of m) { c[st] += 1; attended += value[st]; cells[d] = SHORT[st]; }
        const working = days.filter((d) => d.kind === 'working' && d.date >= iso(p.joiningDate) && (!p.leftOn || d.date <= iso(p.leftOn))).length;
        return { id: p.id, name: `${p.firstName} ${p.lastName ?? ''}`.trim(), code: p.employeeCode, designation: p.designation, cells, present: c.PRESENT, onDuty: c.ON_DUTY, halfDay: c.HALF_DAY, absent: c.ABSENT, leave: c.LEAVE, marked: m.size, workingDays: working, notMarked: Math.max(0, working - [...m.keys()].filter((d) => days.find((x) => x.date === d)?.kind === 'working').length), attended, pct: attendancePct(attended, m.size) };
      });
      return { campusId: q.campusId, month: q.month, days, staff: rows, summary: { staff: rows.length, workingDays: days.filter((d) => d.kind === 'working').length, daysMarked: new Set(marks.map((m) => iso(m.attendanceDate))).size } };
    });
  }

  async staffFile(q: StaffMonthQuery, auth: AuthContext, client: ClientInfo) {
    const r = await this.staff(q, auth);
    const used = r.days.filter((d) => d.kind !== 'future');
    const headers = ['Code', 'Name', 'Designation', ...used.map((d) => d.date.slice(8)), 'Present', 'On duty', 'Half day', 'Absent', 'Leave', 'Working days', 'Not marked', 'Attendance %'];
    const rows = r.staff.map((s) => [s.code, s.name, s.designation ?? '', ...used.map((d) => s.cells[d.date] ?? (d.kind === 'holiday' ? 'Hol' : '')), s.present, s.onDuty, s.halfDay, s.absent, s.leave, s.workingDays, s.notMarked, s.pct ?? '']);
    return this.file(auth, client, 'STAFF_MONTH', `Staff attendance ${q.month}`, headers, rows);
  }
}
