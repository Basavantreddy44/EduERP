import { z } from 'zod';

/**
 * Student attendance (M3.2, B1 §9). Daily by default; a campus can switch to period-wise
 * (setting `attendance.mode`). One sheet per section, day and period; a sheet is saved as a draft or
 * submitted (locked — changes then go through corrections, M3.3).
 */
export const ATTENDANCE_MODES = ['DAILY', 'PERIOD'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
/** Weekly holidays. Second and fourth Saturdays are common in Karnataka government-aided schools. */
export const WEEKLY_OFF = ['SUN', 'SUN_2ND_4TH_SAT', 'SAT_SUN', 'NONE'] as const;
export type WeeklyOff = (typeof WEEKLY_OFF)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const isoDate = z.string().date();

export const periodSchema = z
  .object({
    name: z.string().trim().min(1).max(30),
    startTime: hhmm,
    endTime: hhmm,
    isBreak: z.boolean().default(false),
  })
  .refine((p) => p.endTime > p.startTime, { message: 'Ends before it starts', path: ['endTime'] });

/** Replaces a campus's bell timings in one go (the order given is the order of the day). */
export const savePeriodsSchema = z
  .object({ campusId: z.string().uuid(), periods: z.array(periodSchema).max(16) })
  .refine((v) => v.periods.every((p, i) => i === 0 || p.startTime >= v.periods[i - 1].endTime), { message: 'Periods overlap or are out of order', path: ['periods'] })
  .refine((v) => new Set(v.periods.map((p) => p.name.toLowerCase())).size === v.periods.length, { message: 'Two periods have the same name', path: ['periods'] });
export type SavePeriodsInput = z.infer<typeof savePeriodsSchema>;

export const sheetQuerySchema = z.object({
  sectionId: z.string().uuid(),
  date: isoDate,
  periodId: z.string().uuid().optional(),
});
export type SheetQuery = z.infer<typeof sheetQuerySchema>;

export const saveSheetSchema = z.object({
  sectionId: z.string().uuid(),
  date: isoDate,
  periodId: z.string().uuid().nullable().optional(),
  /** Every student on the sheet, once. */
  records: z
    .array(z.object({ studentId: z.string().uuid(), status: z.enum(ATTENDANCE_STATUSES), remarks: z.string().trim().max(200).optional().nullable() }))
    .min(1)
    .max(300)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, 'A student appears twice'),
  /** true = submit (locks the sheet); false = save as draft. */
  submit: z.boolean().default(true),
});
export type SaveSheetInput = z.infer<typeof saveSheetSchema>;

export const dayOverviewSchema = z.object({ date: isoDate, campusId: z.string().uuid().optional(), periodId: z.string().uuid().optional() });
export type DayOverviewQuery = z.infer<typeof dayOverviewSchema>;

/** Is this date a weekly holiday under the given rule? (`iso` = YYYY-MM-DD.) */
export function isWeeklyOff(iso: string, rule: WeeklyOff): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (rule === 'NONE') return false;
  if (dow === 0) return true;
  if (dow !== 6) return false;
  if (rule === 'SAT_SUN') return true;
  if (rule === 'SUN_2ND_4TH_SAT') {
    const nth = Math.ceil(d.getUTCDate() / 7);
    return nth === 2 || nth === 4;
  }
  return false;
}

/** Ask to change a submitted mark (M3.3). Goes for approval when the institution has a rule for it. */
export const correctionSchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  newStatus: z.enum(ATTENDANCE_STATUSES),
  reason: z.string().trim().min(5).max(300),
});
export type CorrectionInput = z.infer<typeof correctionSchema>;

export const CORRECTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const correctionQuerySchema = z.object({
  status: z.enum(CORRECTION_STATUSES).optional(),
  sessionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CorrectionQuery = z.infer<typeof correctionQuerySchema>;

// ───────────── Reports (M3.5) ─────────────

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const fileFormat = z.enum(['json', 'xlsx']).default('json');

/** Attendance value of one mark: present and late count fully, half day half; absent and leave count 0. */
export const ATTENDED_VALUE: Record<AttendanceStatus, number> = { PRESENT: 1, LATE: 1, HALF_DAY: 0.5, ABSENT: 0, LEAVE: 0 };
/** Percentage to one decimal (null when nothing was marked). */
export const attendancePct = (attended: number, marked: number) => (marked ? Math.round((attended / marked) * 1000) / 10 : null);

export const registerQuerySchema = z.object({ sectionId: z.string().uuid(), month, format: fileFormat });
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

export const studentPctQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    campusId: z.string().uuid().optional(),
    programLevelId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    /** Only students below this percentage; `belowMin=true` uses the campus minimum (setting). */
    below: z.coerce.number().min(1).max(100).optional(),
    belowMin: z.enum(['true', 'false']).optional(),
    format: fileFormat,
  })
  .refine((v) => v.to >= v.from, { message: 'The end is before the start', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000, { message: 'At most about a year', path: ['to'] });
export type StudentPctQuery = z.infer<typeof studentPctQuerySchema>;

export const staffMonthQuerySchema = z.object({ campusId: z.string().uuid(), month, format: fileFormat });
export type StaffMonthQuery = z.infer<typeof staffMonthQuerySchema>;
