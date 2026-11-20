import { z } from 'zod';
import { money } from './fees';

/** Phase 16: library, health & infirmary, discipline & counselling (B5 §4–§6). */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const posInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

// ───────────── Library ─────────────

export const COPY_STATUSES = ['AVAILABLE', 'ISSUED', 'ON_HOLD', 'LOST', 'DAMAGED', 'WITHDRAWN'] as const;
export const MEMBER_TYPES = ['STUDENT', 'EMPLOYEE'] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

export const librarySettingsSchema = z.object({
  studentLoanDays: posInt(1, 365),
  staffLoanDays: posInt(1, 365),
  studentMaxBooks: posInt(0, 50),
  staffMaxBooks: posInt(0, 50),
  maxRenewals: posInt(0, 20),
  finePerDay: money,
  graceDays: posInt(0, 60),
  holdDays: posInt(1, 30),
});
export type LibrarySettingsInput = z.infer<typeof librarySettingsSchema>;

export const ISBN_RE = /^(97[89])?\d{9}[\dX]$/;
const isbn = z.string().trim().transform((v) => v.toUpperCase().replace(/[\s-]/g, '')).pipe(z.string().regex(ISBN_RE, 'ISBN is 10 or 13 digits')).optional().nullable().or(z.literal('').transform(() => null));

export const bookSchema = z.object({
  isbn,
  title: z.string().trim().min(1, 'Enter the title').max(300),
  authors: optText(300),
  publisher: optText(150),
  edition: optText(30),
  publishYear: z.coerce.number().int().min(1000).max(2100).nullable().optional(),
  language: optText(30),
  subject: optText(100),
  callNo: optText(50),
});
export type BookInput = z.infer<typeof bookSchema>;

export const copySchema = z.object({
  campusId: uuid,
  accessionNo: z.string().trim().max(30).optional().nullable().transform((v) => (v ? v.toUpperCase() : null)),
  barcode: optText(50),
  purchaseDate: date.nullable().optional(),
  price: money.nullable().optional(),
  rackLocation: optText(50),
});
export type CopyInput = z.infer<typeof copySchema>;
export const addCopiesSchema = copySchema.extend({ count: posInt(1, 50).default(1) });
export type AddCopiesInput = z.infer<typeof addCopiesSchema>;

export const memberRef = z.object({ memberType: z.enum(MEMBER_TYPES), memberId: uuid });
export const issueSchema = memberRef.extend({ code: z.string().trim().min(1, 'Scan or type the accession number').max(50), dueDate: date.optional() });
export type IssueInput = z.infer<typeof issueSchema>;
export const returnSchema = z.object({ code: z.string().trim().min(1).max(50), condition: z.enum(['GOOD', 'DAMAGED']).default('GOOD'), remarks: optText(200) });
export const reserveSchema = memberRef.extend({ bookId: uuid, campusId: uuid });
export const lostSchema = z.object({ remarks: optText(200) });

// ───────────── Health ─────────────

export const VISIT_OUTCOMES = ['RETURNED_TO_CLASS', 'REST', 'SENT_HOME', 'HOSPITAL_REFERRED'] as const;
export const CHECKUP_TYPES = ['GENERAL', 'DENTAL', 'EYE', 'BMI'] as const;
const measure = (min: number, max: number) => z.coerce.number().min(min).max(max).nullable().optional();
const phone = z.string().trim().regex(/^[6-9]\d{9}$|^0\d{9,11}$/, 'Enter a 10-digit mobile or a landline with STD code').optional().nullable().or(z.literal('').transform(() => null));

export const healthProfileSchema = z.object({
  heightCm: measure(30, 250),
  weightKg: measure(2, 250),
  allergies: optText(500),
  conditions: optText(500),
  medications: optText(500),
  disability: optText(200),
  doctorName: optText(150),
  doctorPhone: phone,
});
export type HealthProfileInput = z.infer<typeof healthProfileSchema>;

export const visitSchema = memberRef.extend({
  campusId: uuid,
  visitAt: z.string().datetime({ offset: true }).optional(),
  complaint: z.string().trim().min(2, 'What is the complaint?').max(300),
  temperature: measure(90, 110),
  treatment: optText(500),
  medicine: optText(300),
  outcome: z.enum(VISIT_OUTCOMES),
});
export type VisitInput = z.infer<typeof visitSchema>;

export const checkupSchema = z.object({
  checkupDate: date,
  checkupType: z.enum(CHECKUP_TYPES),
  heightCm: measure(30, 250),
  weightKg: measure(2, 250),
  findings: z.string().trim().min(2).max(1000),
  recommendation: optText(500),
  doctorName: optText(150),
});
export type CheckupInput = z.infer<typeof checkupSchema>;

export const vaccinationSchema = z.object({
  vaccineName: z.string().trim().min(2).max(100),
  doseNo: posInt(1, 10).default(1),
  vaccinationDate: date,
  nextDueDate: date.nullable().optional(),
  remarks: optText(200),
}).refine((v) => !v.nextDueDate || v.nextDueDate > v.vaccinationDate, { path: ['nextDueDate'], message: 'The next dose is due after this one' });
export type VaccinationInput = z.infer<typeof vaccinationSchema>;

// ───────────── Discipline & counselling ─────────────

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const INCIDENT_STATUSES = ['REPORTED', 'UNDER_REVIEW', 'ACTION_TAKEN', 'CLOSED'] as const;
export const ACTION_TYPES = ['WARNING', 'PARENT_MEETING', 'SUSPENSION', 'FINE', 'COUNSELLING', 'OTHER'] as const;
export const REFERRAL_SOURCES = ['SELF', 'TEACHER', 'PARENT', 'DISCIPLINE', 'OTHER'] as const;

export const incidentTypeSchema = z.object({ name: z.string().trim().min(2).max(100), severity: z.enum(SEVERITIES), notifyParent: z.boolean().default(false), isActive: z.boolean().default(true) });
export type IncidentTypeInput = z.infer<typeof incidentTypeSchema>;

export const incidentSchema = z.object({
  studentId: uuid,
  typeId: uuid,
  incidentAt: z.string().datetime({ offset: true }),
  location: optText(100),
  description: z.string().trim().min(5, 'Describe what happened').max(2000),
  witnesses: optText(300),
});
export type IncidentInput = z.infer<typeof incidentSchema>;

export const actionSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  description: z.string().trim().min(2).max(500),
  fromDate: date.nullable().optional(),
  toDate: date.nullable().optional(),
  fineAmount: money.nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.actionType === 'SUSPENSION') {
    if (!v.fromDate) ctx.addIssue({ code: 'custom', path: ['fromDate'], message: 'From which day?' });
    if (!v.toDate) ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'Until which day?' });
    if (v.fromDate && v.toDate && v.toDate < v.fromDate) ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'The end is before the start' });
  }
  if (v.actionType === 'FINE' && !(Number(v.fineAmount) > 0)) ctx.addIssue({ code: 'custom', path: ['fineAmount'], message: 'Enter the fine' });
});
export type ActionInput = z.infer<typeof actionSchema>;
export const closeIncidentSchema = z.object({ closingNote: optText(500) });

export const counsellingSchema = z.object({
  studentId: uuid,
  sessionAt: z.string().datetime({ offset: true }),
  referralSource: z.enum(REFERRAL_SOURCES),
  incidentId: uuid.nullable().optional(),
  notes: z.string().trim().max(10_000).optional().nullable(),
  followUpDate: date.nullable().optional(),
  isConfidential: z.boolean().default(true),
});
export type CounsellingInput = z.infer<typeof counsellingSchema>;

/** Starter incident types (an institution can rename or add its own). */
export const STARTER_INCIDENT_TYPES: { name: string; severity: (typeof SEVERITIES)[number]; notifyParent: boolean }[] = [
  { name: 'Late coming', severity: 'LOW', notifyParent: false },
  { name: 'Uniform or ID card', severity: 'LOW', notifyParent: false },
  { name: 'Homework not done', severity: 'LOW', notifyParent: false },
  { name: 'Mobile phone in class', severity: 'MEDIUM', notifyParent: true },
  { name: 'Disrespect or misconduct', severity: 'MEDIUM', notifyParent: true },
  { name: 'Damage to school property', severity: 'HIGH', notifyParent: true },
  { name: 'Fighting', severity: 'HIGH', notifyParent: true },
  { name: 'Bullying', severity: 'CRITICAL', notifyParent: true },
  { name: 'Ragging', severity: 'CRITICAL', notifyParent: true },
];
