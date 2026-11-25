import { z } from 'zod';

/**
 * Phase 21 — Residential edition: allotment list (R1), moves between schools (R2), warden's daily
 * report (R4) and health check-up camps (R5). The monthly report (R3) is in the report catalogue.
 */
const uuid = z.string().uuid();
const date = z.string().date('Enter a date');
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

// ───────────── R1 Allotment list ─────────────

export const ENTRANCE_ALLOTMENT_STATUSES = ['ALLOTTED', 'JOINED', 'NOT_REPORTED', 'CANCELLED'] as const;
export type EntranceAllotmentStatus = (typeof ENTRANCE_ALLOTMENT_STATUSES)[number];

export const allotmentListQuery = z.object({
  campusId: uuid.optional(),
  academicYearId: uuid.optional(),
  status: z.enum(ENTRANCE_ALLOTMENT_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});

/** The school marks the child as joined: the student is created in the chosen section. */
export const allotmentJoinSchema = z.object({
  sectionId: uuid,
  joinedOn: date,
  admissionNo: optText(30),
  rollNo: optText(10),
});
export type AllotmentJoinInput = z.infer<typeof allotmentJoinSchema>;

/** Not reported (by the school) or cancelled (by head office); back to allotted undoes either. */
export const allotmentStatusSchema = z.object({
  status: z.enum(['ALLOTTED', 'NOT_REPORTED', 'CANCELLED']),
  date: date,
  reason: z.string().trim().min(3, 'Give a reason (at least 3 letters)').max(300),
});
export type AllotmentStatusInput = z.infer<typeof allotmentStatusSchema>;

// ───────────── R2 Moves between schools ─────────────

export const studentMoveSchema = z.object({
  toCampusId: uuid,
  sectionId: uuid,
  transferDate: date,
  orderNo: optText(60),
  reason: z.string().trim().min(3, 'Give a reason (at least 3 letters)').max(300),
});
export type StudentMoveInput = z.infer<typeof studentMoveSchema>;

export const staffMoveSchema = z.object({
  toCampusId: uuid,
  departmentId: uuid.nullable().optional(),
  transferDate: date,
  orderNo: optText(60),
  reason: z.string().trim().min(3, 'Give a reason (at least 3 letters)').max(300),
});
export type StaffMoveInput = z.infer<typeof staffMoveSchema>;

export const movesQuery = z.object({
  personType: z.enum(['STUDENT', 'STAFF']).optional(),
  campusId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
});

// ───────────── R4 Warden's daily report ─────────────

export const hostelDayQuery = z.object({ date });
export const hostelDailyNoteSchema = z.object({
  date,
  remarks: z.string().trim().min(2, 'Write the remarks (at least 2 letters)').max(2000),
});
export type HostelDailyNoteInput = z.infer<typeof hostelDailyNoteSchema>;

// ───────────── R5 Health check-up camps ─────────────

export const healthCampSchema = z.object({
  campusId: uuid,
  campDate: date,
  title: z.string().trim().min(3, 'Enter a title (at least 3 letters)').max(150),
  conductedBy: optText(200),
  notes: optText(1000),
});
export type HealthCampInput = z.infer<typeof healthCampSchema>;
export const updateHealthCampSchema = healthCampSchema.omit({ campusId: true }).partial().extend({ status: z.enum(['OPEN', 'CLOSED']).optional() });
export type UpdateHealthCampInput = z.infer<typeof updateHealthCampSchema>;

const num = (min: number, max: number, label: string) =>
  z.union([z.literal(''), z.null(), z.coerce.number().min(min, `${label}: at least ${min}`).max(max, `${label}: at most ${max}`)]).optional().transform((v) => (v === '' || v === undefined ? null : v));

export const campEntrySchema = z.object({
  studentId: uuid,
  heightCm: num(50, 220, 'Height'),
  weightKg: num(8, 150, 'Weight'),
  vision: optText(30),
  dental: optText(100),
  skin: optText(100),
  haemoglobin: num(3, 25, 'Haemoglobin'),
  findings: optText(1000),
  referred: z.boolean().default(false),
});
export type CampEntryInput = z.infer<typeof campEntrySchema>;
export const campEntriesSchema = z.object({ entries: z.array(campEntrySchema).min(1).max(80) });

/** Body-mass index from height (cm) and weight (kg), one decimal; null when either is missing. */
export function bmiOf(heightCm: number | null | undefined, weightKg: number | null | undefined): number | null {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
