import { z } from 'zod';

// ───────────── Enquiries ─────────────

export const ENQUIRY_SOURCES = ['WALK_IN', 'WEBSITE', 'PHONE', 'REFERRAL', 'CAMPAIGN', 'SOCIAL'] as const;
export const ENQUIRY_STATUSES = ['NEW', 'FOLLOW_UP', 'INTERESTED', 'CONVERTED', 'LOST'] as const;
export const FOLLOWUP_MODES = ['CALL', 'VISIT', 'SMS', 'WHATSAPP'] as const;

const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const isoDate = z.string().date();

export const createEnquirySchema = z.object({
  campusId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  programLevelId: z.string().uuid(),
  studentName: z.string().trim().min(2).max(150),
  dob: isoDate.optional().nullable(),
  parentName: z.string().trim().min(2).max(150),
  phone,
  email: z.string().trim().toLowerCase().email().max(150).optional().nullable(),
  source: z.enum(ENQUIRY_SOURCES),
  nextFollowUp: isoDate.optional().nullable(),
  notes: optText(500),
});
export type CreateEnquiryInput = z.infer<typeof createEnquirySchema>;

export const addFollowupSchema = z.object({
  mode: z.enum(FOLLOWUP_MODES),
  remarks: z.string().trim().min(2).max(500),
  status: z.enum(['FOLLOW_UP', 'INTERESTED', 'LOST']),
  nextFollowUp: isoDate.optional().nullable(),
});
export type AddFollowupInput = z.infer<typeof addFollowupSchema>;

export const enquiryQuerySchema = z.object({
  status: z.enum(ENQUIRY_STATUSES).optional(),
  due: z.enum(['today', 'overdue']).optional(),
  search: z.string().trim().max(100).optional(),
  campusId: z.string().uuid().optional(),
});

// ───────────── Applications ─────────────

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
/** Karnataka reservation categories plus central ones (configurable later). */
export const CATEGORIES = ['GENERAL', 'SC', 'ST', 'OBC', 'CAT_1', '2A', '2B', '3A', '3B'] as const;
export const APPLICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WAITLISTED', 'ENROLLED', 'CANCELLED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
/** Statuses in which details can still be edited. */
export const APPLICATION_EDITABLE: ApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

/**
 * Aadhaar (G-16): only the last 4 digits are ever stored. A full 12-digit number is refused with a
 * clear message rather than silently cut, so staff learn not to type it.
 */
export const aadhaarLast4 = z
  .string()
  .trim()
  .refine((v) => !/^\d{12}$/.test(v.replace(/\s/g, '')), { message: 'Do not enter the full Aadhaar number — only the last 4 digits' })
  .refine((v) => /^\d{4}$/.test(v), { message: 'Enter the last 4 digits only' });

const applicationFields = {
  campusId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  programLevelId: z.string().uuid(),
  enquiryId: z.string().uuid().optional().nullable(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
  nameLocal: optText(150),
  dob: isoDate,
  gender: z.enum(GENDERS),
  category: z.enum(CATEGORIES).optional().nullable(),
  religion: optText(30),
  motherTongue: optText(30),
  aadhaarLast4: aadhaarLast4.optional().nullable(),
  fatherName: optText(150),
  motherName: optText(150),
  guardianName: optText(150),
  parentPhone: phone,
  parentEmail: z.string().trim().toLowerCase().email().max(150).optional().nullable(),
  address: optText(500),
  previousInstitution: optText(200),
  previousMarksPercent: z.number().min(0).max(100).optional().nullable(),
};

export const createApplicationSchema = z
  .object({
    ...applicationFields,
    /** Required when the duplicate check found matches: why this is still a new application. */
    duplicateReason: z.string().trim().min(5).max(300).optional().nullable(),
  })
  .refine((v) => v.fatherName || v.motherName || v.guardianName, { message: 'Enter at least one parent or guardian', path: ['fatherName'] })
  .refine((v) => new Date(`${v.dob}T00:00:00Z`) < new Date(), { message: 'Date of birth must be in the past', path: ['dob'] });
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object(applicationFields).partial().omit({ campusId: true, academicYearId: true, enquiryId: true });
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const duplicateCheckSchema = z.object({
  parentPhone: phone,
  dob: isoDate.optional().nullable(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().nullable(),
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const decideApplicationSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'WAITLIST']),
    remarks: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.decision !== 'REJECT' || (v.remarks && v.remarks.length >= 5), { message: 'Give a reason when rejecting', path: ['remarks'] });
export type DecideApplicationInput = z.infer<typeof decideApplicationSchema>;

export const enrolSchema = z.object({
  sectionId: z.string().uuid(),
  admissionDate: isoDate.optional().nullable(),
  rollNo: z.string().trim().max(10).optional().nullable(),
});
export type EnrolInput = z.infer<typeof enrolSchema>;

export const applicationQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  campusId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
});
