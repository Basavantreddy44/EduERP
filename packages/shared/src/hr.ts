import { z } from 'zod';
import { BLOOD_GROUPS } from './students';

/** Phase 14: HR (B4 §2) — designations, staff profile, shifts, leave balances, exits. */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const blankNull = <T extends z.ZodTypeAny>(s: T) => s.optional().nullable().or(z.literal('').transform(() => null));
const upper = (re: RegExp, msg: string) => z.string().trim().transform((v) => v.toUpperCase().replace(/\s/g, '')).pipe(z.string().regex(re, msg));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time like 09:00');

export const DESIGNATION_CATEGORIES = ['TEACHING', 'NON_TEACHING', 'ADMIN', 'SUPPORT'] as const;
export const designationSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z-]{2,20}$/i, 'Code: 2–20 letters, digits or dashes'),
  name: z.string().trim().min(2).max(100),
  category: z.enum(DESIGNATION_CATEGORIES),
  isActive: z.boolean().default(true),
});
export type DesignationInput = z.infer<typeof designationSchema>;

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'] as const;
/** The staff profile beyond the basic staff record. PAN / bank number: blank on an edit keeps what is stored. */
export const staffProfileSchema = z.object({
  designationId: uuid.optional().nullable(),
  fatherOrSpouseName: optText(150),
  maritalStatus: blankNull(z.enum(MARITAL_STATUSES)),
  bloodGroup: blankNull(z.enum(BLOOD_GROUPS)),
  permanentAddress: optText(500),
  currentAddress: optText(500),
  emergencyContactName: optText(150),
  emergencyContactPhone: blankNull(z.string().trim().regex(/^\d{6,15}$/, 'Phone: 6 to 15 digits')),
  pan: blankNull(upper(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a 10-character PAN, e.g. ABCDE1234F')),
  aadhaarLast4: blankNull(z.string().trim().regex(/^\d{4}$/, 'Only the last 4 digits')),
  uanNo: blankNull(z.string().trim().regex(/^\d{12}$/, 'UAN is 12 digits')),
  pfNo: optText(30),
  esiNo: blankNull(z.string().trim().regex(/^\d{10}$|^\d{17}$/, 'ESI number is 10 or 17 digits')),
  bankName: optText(100),
  bankAccountNo: blankNull(z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{6,18}$/, 'Enter the account number (6 to 18 digits)'))),
  ifsc: blankNull(upper(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter an 11-character IFSC, e.g. SBIN0001234')),
  shiftId: uuid.optional().nullable(),
  reportingToId: uuid.optional().nullable(),
  confirmationDate: blankNull(date),
  probationEndDate: blankNull(date),
});
export type StaffProfileInput = z.infer<typeof staffProfileSchema>;

export const qualificationSchema = z.object({
  qualification: z.string().trim().min(2).max(100),
  institution: z.string().trim().min(2).max(200),
  yearOfPassing: z.coerce.number().int().min(1950).max(2100),
  percentage: blankNull(z.coerce.number().min(0).max(100)),
});
export type QualificationInput = z.infer<typeof qualificationSchema>;
export const experienceSchema = z.object({
  organisation: z.string().trim().min(2).max(200),
  designation: z.string().trim().min(2).max(100),
  fromDate: date,
  toDate: date,
}).refine((v) => v.toDate >= v.fromDate, { message: 'Ends before it starts', path: ['toDate'] });
export type ExperienceInput = z.infer<typeof experienceSchema>;

export const shiftSchema = z.object({
  campusId: uuid,
  name: z.string().trim().min(2).max(50),
  startTime: hhmm,
  endTime: hhmm,
  lateAfterMinutes: z.coerce.number().int().min(0).max(240),
  halfDayAfterMinutes: z.coerce.number().int().min(1).max(480),
  isActive: z.boolean().default(true),
}).refine((v) => v.endTime > v.startTime, { message: 'Ends before it starts', path: ['endTime'] })
  .refine((v) => v.halfDayAfterMinutes > v.lateAfterMinutes, { message: 'Half day must come after late', path: ['halfDayAfterMinutes'] });
export type ShiftInput = z.infer<typeof shiftSchema>;
export const assignShiftSchema = z.object({ shiftId: uuid.nullable(), employeeIds: z.array(uuid).min(1).max(500) });

export const LEAVE_ADJUSTMENTS = ['OPENING', 'CARRY_FORWARD', 'ENCASHMENT', 'ADJUSTMENT'] as const;
const halfDays = z.coerce.number().refine((v) => Number.isFinite(v) && Math.round(v * 2) === v * 2, 'Whole or half days').refine((v) => Math.abs(v) <= 365, 'Too many days');
export const leaveAdjustmentSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  academicYearId: uuid,
  kind: z.enum(LEAVE_ADJUSTMENTS),
  days: halfDays.refine((v) => v !== 0, 'Not zero'),
  reason: z.string().trim().min(3).max(300),
});
export type LeaveAdjustmentInput = z.infer<typeof leaveAdjustmentSchema>;
export const carryForwardSchema = z.object({ fromYearId: uuid, toYearId: uuid }).refine((v) => v.fromYearId !== v.toYearId, { message: 'Choose two different years', path: ['toYearId'] });

export const EXIT_TYPES = ['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'CONTRACT_END', 'DEATH'] as const;
export const CLEARANCE_SECTIONS = ['LIBRARY', 'STORE', 'ACCOUNTS', 'HOSTEL', 'IT', 'ADMIN'] as const;
export const exitSchema = z.object({
  employeeId: uuid,
  exitType: z.enum(EXIT_TYPES),
  resignationDate: date,
  lastWorkingDate: date,
  reason: z.string().trim().min(3).max(500),
  handoverToId: uuid.optional().nullable(),
  sections: z.array(z.enum(CLEARANCE_SECTIONS)).min(1).max(CLEARANCE_SECTIONS.length).default(['ACCOUNTS', 'ADMIN']),
}).refine((v) => v.lastWorkingDate >= v.resignationDate, { message: 'Last day is before the notice date', path: ['lastWorkingDate'] })
  .refine((v) => new Set(v.sections).size === v.sections.length, { message: 'A section is listed twice', path: ['sections'] });
export type ExitInput = z.infer<typeof exitSchema>;
export const clearanceSchema = z.object({ remarks: optText(300), dueAmount: z.coerce.number().min(0).max(10_000_000).default(0) });
export const closeExitSchema = z.object({ settlementAmount: z.coerce.number().min(-10_000_000).max(10_000_000).default(0), remarks: optText(300) });
