import { z } from 'zod';

/**
 * The 32 v1 modules (REQUIREMENTS_DISCUSSION §3). `core` modules are always on; the rest are
 * switched on per institution by its plan (tenant_modules), with platform overrides.
 */
export interface ModuleDef {
  code: string;
  name: string;
  group: 'Core' | 'Academics' | 'Finance' | 'Campus life' | 'Operations' | 'Engagement';
  core?: boolean;
}

export const MODULES = [
  { code: 'SETUP', name: 'Institution & campus setup', group: 'Core', core: true },
  { code: 'USERS', name: 'Users, roles & permissions', group: 'Core', core: true },
  { code: 'ADMISSIONS', name: 'Admissions', group: 'Academics' },
  { code: 'STUDENTS', name: 'Student management', group: 'Academics' },
  { code: 'ACADEMICS', name: 'Academics', group: 'Academics' },
  { code: 'TIMETABLE', name: 'Timetable', group: 'Academics' },
  { code: 'ATTENDANCE', name: 'Attendance', group: 'Academics' },
  { code: 'HOMEWORK', name: 'Homework, diary & lesson plans', group: 'Academics' },
  { code: 'EXAMS', name: 'Exams & results', group: 'Academics' },
  { code: 'FEES', name: 'Fees', group: 'Finance' },
  { code: 'ACCOUNTS', name: 'Accounts', group: 'Finance' },
  { code: 'HR_PAYROLL', name: 'HR & payroll', group: 'Finance' },
  { code: 'HOSTEL', name: 'Hostel', group: 'Campus life' },
  { code: 'TRANSPORT', name: 'Transport', group: 'Campus life' },
  { code: 'LIBRARY', name: 'Library', group: 'Campus life' },
  { code: 'INVENTORY', name: 'Inventory, store & purchase', group: 'Operations' },
  { code: 'COMMUNICATION', name: 'Communication', group: 'Core', core: true },
  { code: 'NEWS_FEED', name: 'News feed', group: 'Engagement' },
  { code: 'MEETINGS', name: 'Meetings (parents and staff)', group: 'Engagement' },
  { code: 'EVENTS', name: 'Events & calendar', group: 'Engagement' },
  { code: 'DEPT_REQUESTS', name: 'Department requests', group: 'Operations' },
  { code: 'FRONT_OFFICE', name: 'Front office', group: 'Operations' },
  { code: 'GRIEVANCE', name: 'Complaints & grievance', group: 'Engagement' },
  { code: 'HEALTH', name: 'Health & infirmary', group: 'Campus life' },
  { code: 'DISCIPLINE', name: 'Discipline & behaviour', group: 'Campus life' },
  { code: 'LMS', name: 'Study material', group: 'Academics' },
  { code: 'DOCUMENTS', name: 'Documents & certificates', group: 'Core', core: true },
  { code: 'REPORTS', name: 'Reports & dashboards', group: 'Core', core: true },
  { code: 'AUDIT', name: 'Audit & security', group: 'Core', core: true },
  { code: 'SPORTS', name: 'Sports & activities', group: 'Campus life' },
  { code: 'PLACEMENTS', name: 'Placements', group: 'Academics' },
  { code: 'LABS', name: 'Labs', group: 'Operations' },
] as const satisfies readonly ModuleDef[];

export type ModuleCode = (typeof MODULES)[number]['code'];
export const MODULE_CODES = MODULES.map((m) => m.code) as unknown as [ModuleCode, ...ModuleCode[]];
export const CORE_MODULES: ModuleCode[] = MODULES.filter((m) => 'core' in m && m.core).map((m) => m.code);

// ───────────── Plans (platform console) ─────────────

const money = z.number().nonnegative().max(99_999_999.99).multipleOf(0.01);

export const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, '2–30 capital letters, digits or _'),
  description: z.string().trim().max(300).optional().nullable(),
  pricePerStudent: money,
  billingCycle: z.enum(['MONTHLY', 'YEARLY']),
  maxStudents: z.number().int().positive().nullable().optional(),
  modules: z.array(z.enum(MODULE_CODES)).max(MODULES.length),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const assignPlanSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(['TRIAL', 'ACTIVE']),
  startDate: z.string().date(),
  endDate: z.string().date(),
  studentCount: z.number().int().min(0).max(1_000_000).default(0),
}).refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
export type AssignPlanInput = z.infer<typeof assignPlanSchema>;

export const moduleOverrideSchema = z.object({
  moduleCode: z.enum(MODULE_CODES),
  isEnabled: z.boolean(),
});
export type ModuleOverrideInput = z.infer<typeof moduleOverrideSchema>;
