import { z } from 'zod';
import { CATEGORIES, GENDERS, aadhaarLast4 } from './admissions';

/**
 * Students & parents (M1.3). Statuses: ACTIVE and INACTIVE (a long break; the seat is kept) and
 * DROPPED (discontinued; the seat is freed) are changed here. TRANSFERRED and PASSED_OUT come only
 * from the year-end promotion and the Transfer Certificate (M1.4).
 */
export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'DROPPED', 'TRANSFERRED', 'PASSED_OUT'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export const MANUAL_STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'DROPPED'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const GUARDIAN_RELATIONS = ['FATHER', 'MOTHER', 'GUARDIAN'] as const;

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().date();
const notFuture = (d: string) => d <= new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);

export const STUDENT_SORTS = ['name', 'admissionNo', 'class'] as const;
export const studentQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  campusId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  programLevelId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  sort: z.enum(STUDENT_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StudentQuery = z.infer<typeof studentQuerySchema>;

export const updateStudentSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).nullable(),
    nameLocal: optText(150),
    dob: isoDate,
    gender: z.enum(GENDERS),
    category: z.enum(CATEGORIES).nullable(),
    religion: optText(30),
    motherTongue: optText(30),
    bloodGroup: z.enum(BLOOD_GROUPS).nullable(),
    aadhaarLast4: aadhaarLast4.nullable(),
    apaarId: z.string().trim().regex(/^\d{12}$/, 'APAAR ID has 12 digits').nullable(),
    address: optText(500),
    rollNo: z.string().trim().max(10).nullable(),
  })
  .partial()
  .refine((v) => !v.dob || v.dob < new Date().toISOString().slice(0, 10), { message: 'Date of birth must be in the past', path: ['dob'] });
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const changeStudentStatusSchema = z.object({
  status: z.enum(MANUAL_STUDENT_STATUSES),
  effectiveDate: isoDate.refine(notFuture, 'The date cannot be in the future'),
  reason: z.string().trim().min(5).max(300),
  /** Needed when a dropped student comes back: the section to re-join this year. */
  sectionId: z.string().uuid().optional().nullable(),
});
export type ChangeStudentStatusInput = z.infer<typeof changeStudentStatusSchema>;

export const changeSectionSchema = z.object({
  sectionId: z.string().uuid(),
  effectiveDate: isoDate.refine(notFuture, 'The date cannot be in the future'),
  reason: z.string().trim().min(5).max(300),
  rollNo: z.string().trim().max(10).optional().nullable(),
});
export type ChangeSectionInput = z.infer<typeof changeSectionSchema>;

const guardianFields = {
  name: z.string().trim().min(2).max(150),
  phone: phone.nullable(),
  email: z.string().trim().toLowerCase().email().max(150).nullable(),
  occupation: optText(100),
};

/** Add a parent: either link an existing one (a sibling's parent) or enter a new one. */
export const addGuardianSchema = z
  .object({
    relation: z.enum(GUARDIAN_RELATIONS),
    isPrimary: z.boolean().default(false),
    guardianId: z.string().uuid().optional(),
    name: guardianFields.name.optional(),
    phone: guardianFields.phone.optional(),
    email: guardianFields.email.optional(),
    occupation: guardianFields.occupation,
  })
  .refine((v) => v.guardianId || v.name, { message: 'Enter the name', path: ['name'] })
  .refine((v) => !v.isPrimary || v.guardianId || v.phone, { message: 'The main contact needs a mobile number', path: ['phone'] });
export type AddGuardianInput = z.infer<typeof addGuardianSchema>;

export const updateGuardianSchema = z.object(guardianFields).partial();
export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;

export const updateGuardianLinkSchema = z.object({ relation: z.enum(GUARDIAN_RELATIONS).optional(), isPrimary: z.literal(true).optional() });
export type UpdateGuardianLinkInput = z.infer<typeof updateGuardianLinkSchema>;

export const guardianLookupSchema = z.object({ phone });

// ───────────── Lifecycle (M1.4) ─────────────

/**
 * Year-end promotion. Preview first (nothing changes), then commit. Each class goes to the next class
 * of its programme (same section name unless mapped); the final class passes out; students listed in
 * `detainIds` stay in the same class. Students already placed in the new year are skipped.
 */
export const promotionSchema = z.object({
  fromYearId: z.string().uuid(),
  toYearId: z.string().uuid(),
  programLevelIds: z.array(z.string().uuid()).min(1).max(100),
  detainIds: z.array(z.string().uuid()).max(5000).default([]),
  /** fromSectionId → toSectionId, when the same section name does not exist (or a different one is wanted). */
  sectionMap: z.record(z.string().uuid(), z.string().uuid()).default({}),
});
export type PromotionInput = z.infer<typeof promotionSchema>;

export const CONDUCT_OPTIONS = ['GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT'] as const;
export const issueTcSchema = z.object({
  leavingDate: isoDate.refine(notFuture, 'The date cannot be in the future'),
  reason: z.string().trim().min(3).max(200),
  conduct: z.enum(CONDUCT_OPTIONS),
  remarks: optText(300),
});
export type IssueTcInput = z.infer<typeof issueTcSchema>;
