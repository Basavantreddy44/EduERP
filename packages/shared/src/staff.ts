import { z } from 'zod';
import { GENDERS } from './admissions';

/**
 * Staff, basic (M3.1, B1 §6). Full HR (designations, contracts, salary, payroll) comes in B4; until
 * then the designation is free text. Staff are never deleted: they leave as RESIGNED or TERMINATED.
 */
export const EMPLOYEE_TYPES = ['TEACHING', 'NON_TEACHING', 'CONTRACT', 'VISITING'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = { TEACHING: 'Teaching', NON_TEACHING: 'Non-teaching', CONTRACT: 'Contract', VISITING: 'Visiting' };
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const LEFT_STATUSES = ['RESIGNED', 'TERMINATED'] as const;

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().date();
const todayPlus1 = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

const employeeFields = {
  campusId: z.string().uuid(),
  /** Leave empty to give the next number automatically. */
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9/_\-.]{1,20}$/, 'Up to 20 letters, digits, / _ - or .').optional().nullable(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
  nameLocal: optText(150),
  gender: z.enum(GENDERS),
  dob: isoDate.optional().nullable(),
  phone: phone.optional().nullable(),
  email: z.string().trim().toLowerCase().email().max(150).optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  designation: optText(80),
  employeeType: z.enum(EMPLOYEE_TYPES),
  joiningDate: isoDate.refine((d) => d <= todayPlus1().slice(0, 4) + '-12-31', 'The joining date is too far ahead'),
};

export const createEmployeeSchema = z
  .object(employeeFields)
  .refine((v) => !v.dob || v.dob < v.joiningDate, { message: 'Date of birth must be before the joining date', path: ['dob'] });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object(employeeFields).omit({ campusId: true, employeeCode: true }).partial();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const changeEmployeeStatusSchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES),
  /** Needed when leaving (RESIGNED / TERMINATED): the last working day. */
  leftOn: isoDate.optional().nullable(),
  reason: z.string().trim().min(3).max(300),
});
export type ChangeEmployeeStatusInput = z.infer<typeof changeEmployeeStatusSchema>;

/** Link a staff record to a login of this institution (or null to unlink). */
export const linkEmployeeUserSchema = z.object({ userId: z.string().uuid().nullable() });

export const EMPLOYEE_SORTS = ['name', 'code', 'joining'] as const;
export const employeeQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  campusId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  employeeType: z.enum(EMPLOYEE_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  sort: z.enum(EMPLOYEE_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;
