import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS, SaveStaffSheetInput } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { closedReason } from '../attendance/attendance.service';
import { HrService } from '../hr/hr.service';
import { onLeave } from './leave.service';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Staff working at a campus on a day: joined by then, not yet left. */
function rosterOf(tx: Tx, campusId: string, date: string) {
  return tx.employee.findMany({
    where: { campusId, joiningDate: { lte: day(date) }, OR: [{ leftOn: null }, { leftOn: { gte: day(date) } }] },
    orderBy: [{ employeeType: 'asc' }, { firstName: 'asc' }],
    select: { id: true, employeeCode: true, firstName: true, lastName: true, designation: true, employeeType: true, status: true, department: { select: { name: true } } },
  });
}

/**
 * Staff attendance (M3.4): the office marks every staff member of a campus for a day, with optional
 * in / out times. Approved leave and long leave show as LEAVE until marked otherwise. Saved marks can
 * be changed by the office (every change audited); no future dates.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  sheet(campusId: string, date: string, auth: AuthContext) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.STAFF_ATT_MARK)!, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const staff = await rosterOf(tx, campusId, date);
      const marks = new Map((await tx.staffAttendance.findMany({ where: { campusId, attendanceDate: day(date) } })).map((m) => [m.employeeId, m]));
      const leave = await onLeave(tx, 'EMPLOYEE', staff.map((s) => s.id), date);
      const closed = date > todayIST() ? { code: 'date-in-future', detail: 'Attendance cannot be taken for a future date' } : await closedReason(tx, this.settings, campusId, date);
      return {
        date, campusId, closed, saved: marks.size > 0,
        staff: staff.map((s) => {
          const m = marks.get(s.id);
          return {
            ...s, department: s.department?.name ?? null,
            status: m?.status ?? null, checkIn: m?.checkIn ?? null, checkOut: m?.checkOut ?? null, remarks: m?.remarks ?? null,
            onLeave: leave.get(s.id) ?? (s.status === 'ON_LEAVE' ? { typeName: 'Long leave', halfDay: false } : null),
          };
        }),
      };
    });
  }

  save(input: SaveStaffSheetInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.STAFF_ATT_MARK)!, input.campusId)) throw NotFound('Campus');
    if (input.date > todayIST()) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'date-in-future', 'Attendance cannot be taken for a future date', [{ field: 'date', message: 'In the future' }]);
    return this.db.run(this.ctx(auth), async (tx) => {
      const staff = new Set((await rosterOf(tx, input.campusId, input.date)).map((s) => s.id));
      const stranger = input.records.find((r) => !staff.has(r.employeeId));
      if (stranger) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'not-on-roster', 'Someone on the sheet was not working at this campus on this day — reload the sheet', [{ field: 'records', message: 'Not on the staff list for this day' }]);
      const before = new Map((await tx.staffAttendance.findMany({ where: { campusId: input.campusId, attendanceDate: day(input.date) }, select: { employeeId: true, status: true } })).map((m) => [m.employeeId, m.status]));
      // Late / half day from each person's shift (HR) when a check-in time is entered.
      const shifts = new Map((await tx.$queryRaw<{ employee_id: string; start_time: string; late_after_minutes: number; half_day_after_minutes: number }[]>`
        SELECT d.employee_id, s.start_time, s.late_after_minutes, s.half_day_after_minutes FROM employee_details d JOIN shifts s ON s.id = d.shift_id AND s.is_active
         WHERE d.employee_id = ANY(${input.records.map((r) => r.employeeId)}::uuid[])`).map((s) => [s.employee_id, { startTime: s.start_time, lateAfterMinutes: s.late_after_minutes, halfDayAfterMinutes: s.half_day_after_minutes }]));
      const late = input.records.map((r) => (r.status === 'PRESENT' || r.status === 'HALF_DAY' ? HrService.lateness(shifts.get(r.employeeId) ?? null, r.checkIn) : { lateMinutes: null, halfDay: false }));
      input = { ...input, records: input.records.map((r, i) => (late[i].halfDay && r.status === 'PRESENT' ? { ...r, status: 'HALF_DAY' as const } : r)) };
      const ids = input.records.map((r) => r.employeeId);
      await tx.$executeRaw`
        INSERT INTO staff_attendance (id, tenant_id, campus_id, employee_id, attendance_date, status, check_in, check_out, remarks, late_minutes, source, marked_by, updated_at)
        SELECT gen_random_uuid(), app_current_tenant(), ${input.campusId}::uuid, x.eid, ${input.date}::date, x.st, x.cin, x.cout, x.rm, x.late, 'MANUAL', ${auth.userId}::uuid, now()
          FROM unnest(${ids}::uuid[], ${input.records.map((r) => r.status)}::text[], ${input.records.map((r) => r.checkIn ?? null)}::text[], ${input.records.map((r) => r.checkOut ?? null)}::text[], ${input.records.map((r) => r.remarks || null)}::text[], ${late.map((l) => l.lateMinutes)}::int[]) AS x(eid, st, cin, cout, rm, late)
        ON CONFLICT (tenant_id, employee_id, attendance_date) DO UPDATE
          SET status = EXCLUDED.status, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, remarks = EXCLUDED.remarks, late_minutes = EXCLUDED.late_minutes, marked_by = EXCLUDED.marked_by, updated_at = now()`;
      const changed = input.records.filter((r) => before.has(r.employeeId) && before.get(r.employeeId) !== r.status).map((r) => ({ employeeId: r.employeeId, from: before.get(r.employeeId), to: r.status }));
      const counts = Object.fromEntries(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'ON_DUTY'].map((k) => [k, input.records.filter((r) => r.status === k).length]));
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: before.size ? 'UPDATE' : 'CREATE', entityType: 'STAFF_ATTENDANCE', entityId: input.campusId, newValues: { date: input.date, ...counts, changed } }, client);
      return { date: input.date, total: input.records.length, counts, changed: changed.length };
    });
  }
}
