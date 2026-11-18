import { z } from 'zod';
import { WeeklyOff, isWeeklyOff } from './attendance';

/**
 * Leave (M3.4, B1 §9). Leave types for students and for staff (optional yearly limit); requests go
 * through the approvals engine ("Leave request"); approved leave shows as LEAVE on later attendance
 * sheets. Days count working days only (weekly holidays and listed holidays are skipped).
 */
export const LEAVE_APPLIES_TO = ['STUDENT', 'EMPLOYEE'] as const;
export type LeaveAppliesTo = (typeof LEAVE_APPLIES_TO)[number];
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const STAFF_ATT_STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'ON_DUTY'] as const;
export type StaffAttStatus = (typeof STAFF_ATT_STATUSES)[number];

const isoDate = z.string().date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(2).max(50),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,10}$/, 'Up to 10 letters or digits'),
  appliesTo: z.enum(LEAVE_APPLIES_TO),
  isPaid: z.boolean().default(true),
  daysPerYear: z.number().positive().max(366).multipleOf(0.5).nullable().default(null),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;
export const updateLeaveTypeSchema = leaveTypeSchema.omit({ appliesTo: true, code: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

export const applyLeaveSchema = z
  .object({
    applicantType: z.enum(LEAVE_APPLIES_TO),
    studentId: z.string().uuid().optional().nullable(),
    /** Staff: leave empty to apply for yourself. */
    employeeId: z.string().uuid().optional().nullable(),
    leaveTypeId: z.string().uuid(),
    fromDate: isoDate,
    toDate: isoDate,
    halfDay: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'The last day is before the first day', path: ['toDate'] })
  .refine((v) => !v.halfDay || v.toDate === v.fromDate, { message: 'A half day is one day only', path: ['halfDay'] })
  .refine((v) => v.applicantType !== 'STUDENT' || !!v.studentId, { message: 'Choose the student', path: ['studentId'] })
  .refine((v) => Date.parse(v.toDate) - Date.parse(v.fromDate) <= 366 * 86_400_000, { message: 'At most one year at a time', path: ['toDate'] });
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const leaveQuerySchema = z.object({
  status: z.enum(LEAVE_STATUSES).optional(),
  applicantType: z.enum(LEAVE_APPLIES_TO).optional(),
  studentId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
  campusId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type LeaveQuery = z.infer<typeof leaveQuerySchema>;

export const staffSheetQuerySchema = z.object({ campusId: z.string().uuid(), date: isoDate });
export const saveStaffSheetSchema = z.object({
  campusId: z.string().uuid(),
  date: isoDate,
  records: z
    .array(z.object({
      employeeId: z.string().uuid(),
      status: z.enum(STAFF_ATT_STATUSES),
      checkIn: hhmm.nullable().optional(),
      checkOut: hhmm.nullable().optional(),
      remarks: z.string().trim().max(200).nullable().optional(),
    })
      .refine((r) => !r.checkIn || !r.checkOut || r.checkOut > r.checkIn, { message: 'Out before in', path: ['checkOut'] })
      .refine((r) => !(r.status === 'ABSENT' || r.status === 'LEAVE') || (!r.checkIn && !r.checkOut), { message: 'No in / out times for someone absent or on leave', path: ['checkIn'] }))
    .min(1)
    .max(500)
    .refine((r) => new Set(r.map((x) => x.employeeId)).size === r.length, 'A staff member appears twice'),
});
export type SaveStaffSheetInput = z.infer<typeof saveStaffSheetSchema>;

/** Working days between two dates (inclusive), skipping weekly holidays and the listed holidays. */
export function leaveDays(from: string, to: string, halfDay: boolean, weeklyOff: WeeklyOff, holidays: Set<string>): number {
  if (halfDay) return isWeeklyOff(from, weeklyOff) || holidays.has(from) ? 0 : 0.5;
  let n = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!isWeeklyOff(d, weeklyOff) && !holidays.has(d)) n += 1;
  }
  return n;
}
