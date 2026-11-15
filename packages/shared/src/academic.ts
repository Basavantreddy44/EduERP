import { z } from 'zod';

// ───────────── Academic years ─────────────

/** "2026-27": first year, then the last two digits of the next year. */
export const academicYearName = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27')
  .refine((v) => (Number(v.slice(0, 4)) + 1) % 100 === Number(v.slice(5)), { message: 'The second part must be the following year, e.g. 2026-27' });

export const createAcademicYearSchema = z
  .object({
    name: academicYearName,
    startDate: z.string().date(),
    endDate: z.string().date(),
    makeCurrent: z.boolean().default(false),
  })
  .refine((v) => v.endDate > v.startDate, { message: 'End date must be after the start date', path: ['endDate'] });
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

export const ACADEMIC_YEAR_STATUSES = ['PLANNING', 'ACTIVE', 'CLOSED'] as const;

// ───────────── Departments ─────────────

export const DEPT_TYPES = ['ACADEMIC', 'ADMIN', 'SUPPORT'] as const;
export const DEPT_TYPE_LABELS: Record<(typeof DEPT_TYPES)[number], string> = { ACADEMIC: 'Academic', ADMIN: 'Administration', SUPPORT: 'Support' };

export const createDepartmentSchema = z.object({
  campusId: z.string().uuid().nullable().optional(), // null = institution-wide (e.g. Accounts)
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 letters, digits, - or _'),
  deptType: z.enum(DEPT_TYPES),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  deptType: z.enum(DEPT_TYPES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ───────────── Holidays ─────────────

export const HOLIDAY_TYPES = ['PUBLIC', 'INSTITUTION', 'EXAM_BREAK'] as const;
export const HOLIDAY_TYPE_LABELS: Record<(typeof HOLIDAY_TYPES)[number], string> = { PUBLIC: 'Public holiday', INSTITUTION: 'Institution holiday', EXAM_BREAK: 'Exam break' };

export const createHolidaySchema = z.object({
  campusId: z.string().uuid().nullable().optional(), // null = all campuses
  holidayDate: z.string().date(),
  name: z.string().trim().min(2).max(100),
  holidayType: z.enum(HOLIDAY_TYPES),
});
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const holidayQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  campusId: z.string().uuid().optional(),
});

// ───────────── Account emails ─────────────

const strongPassword = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), { message: 'Use upper- and lower-case letters and a number' });

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email().max(150) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: strongPassword });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export const PASSWORD_RULE = 'At least 10 characters, with upper- and lower-case letters and a number.';
