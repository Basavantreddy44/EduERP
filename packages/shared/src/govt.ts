import { z } from 'zod';

/**
 * Improvement round G1–G5 (2026-11-23): the government residential school pack — SATS / UDISE+
 * student data and exports, welfare items and allowances, the diet scale and daily meal register,
 * government staff details, and the head-office overview of schools (campuses).
 */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const blank = <T extends z.ZodTypeAny>(s: T) => z.union([z.literal('').transform(() => null), s.nullable()]).optional().transform((v) => (v === undefined ? null : v));

// ───────────── G1 Government student data ─────────────

export const RATION_CARD_TYPES = ['APL', 'BPL', 'AAY', 'NONE'] as const;
export const MINORITY_GROUPS = ['MUSLIM', 'CHRISTIAN', 'SIKH', 'BUDDHIST', 'PARSI', 'JAIN', 'NONE'] as const;
export const MEDIUMS = ['KANNADA', 'ENGLISH', 'URDU', 'TAMIL', 'TELUGU', 'MARATHI', 'HINDI', 'OTHER'] as const;

export const govProfileSchema = z.object({
  satsId: blank(z.string().trim().regex(/^[0-9A-Za-z]{6,20}$/, 'SATS ID: 6 to 20 letters or digits')),
  penNo: blank(z.string().trim().regex(/^[0-9A-Za-z]{6,20}$/, 'PEN: 6 to 20 letters or digits')),
  rationCardType: blank(z.enum(RATION_CARD_TYPES)),
  isEws: z.boolean().nullable().optional().transform((v) => v ?? null),
  minorityGroup: blank(z.enum(MINORITY_GROUPS)),
  isCwsn: z.boolean().default(false),
  disabilityType: optText(60),
  mediumOfInstruction: blank(z.enum(MEDIUMS)),
  distanceKm: blank(z.coerce.number().min(0).max(999)),
  previousSchool: optText(200),
}).superRefine((v, ctx) => {
  if (!v.isCwsn && v.disabilityType) ctx.addIssue({ code: 'custom', path: ['disabilityType'], message: 'Only for a child with special needs' });
  if (v.isCwsn && !v.disabilityType) ctx.addIssue({ code: 'custom', path: ['disabilityType'], message: 'Enter the type of special need' });
});
export type GovProfileInput = z.infer<typeof govProfileSchema>;

export const GOV_EXPORT_CODES = ['SATS', 'UDISE'] as const;
export type GovExportCode = (typeof GOV_EXPORT_CODES)[number];

/** Every field a government export can use; `required` fields are checked by the readiness list. */
export const GOV_FIELDS = [
  { key: 'satsId', label: 'SATS student ID', type: 'text', required: ['SATS'] },
  { key: 'penNo', label: 'PEN (UDISE+)', type: 'text', required: ['UDISE'] },
  { key: 'apaarId', label: 'APAAR ID', type: 'text', required: [] },
  { key: 'admissionNo', label: 'Admission no', type: 'text', required: [] },
  { key: 'admissionDate', label: 'Admission date', type: 'date', required: [] },
  { key: 'name', label: 'Student name', type: 'text', required: [] },
  { key: 'nameLocal', label: 'Name in Kannada', type: 'text', required: [] },
  { key: 'gender', label: 'Gender', type: 'text', required: [] },
  { key: 'dob', label: 'Date of birth', type: 'date', required: [] },
  { key: 'className', label: 'Class', type: 'text', required: [] },
  { key: 'section', label: 'Section', type: 'text', required: [] },
  { key: 'rollNo', label: 'Roll no', type: 'text', required: [] },
  { key: 'medium', label: 'Medium of instruction', type: 'text', required: ['SATS', 'UDISE'] },
  { key: 'motherTongue', label: 'Mother tongue', type: 'text', required: ['SATS', 'UDISE'] },
  { key: 'religion', label: 'Religion', type: 'text', required: ['SATS'] },
  { key: 'category', label: 'Caste category (Karnataka)', type: 'text', required: ['SATS'] },
  { key: 'socialCategory', label: 'Social category (GEN / SC / ST / OBC)', type: 'text', required: ['UDISE'] },
  { key: 'minorityGroup', label: 'Minority group', type: 'text', required: [] },
  { key: 'fatherName', label: 'Father name', type: 'text', required: ['SATS', 'UDISE'] },
  { key: 'motherName', label: 'Mother name', type: 'text', required: ['SATS', 'UDISE'] },
  { key: 'guardianName', label: 'Guardian name', type: 'text', required: [] },
  { key: 'parentPhone', label: 'Parent mobile', type: 'text', required: ['SATS', 'UDISE'] },
  { key: 'parentEmail', label: 'Parent email', type: 'text', required: [] },
  { key: 'address', label: 'Address', type: 'text', required: ['UDISE'] },
  { key: 'aadhaarLast4', label: 'Aadhaar (last 4 digits)', type: 'text', required: [] },
  { key: 'rationCard', label: 'Ration card (APL / BPL / AAY)', type: 'text', required: [] },
  { key: 'bpl', label: 'BPL (Yes / No)', type: 'text', required: [] },
  { key: 'aay', label: 'AAY (Yes / No)', type: 'text', required: [] },
  { key: 'ews', label: 'EWS (Yes / No)', type: 'text', required: [] },
  { key: 'cwsn', label: 'Child with special needs (Yes / No)', type: 'text', required: [] },
  { key: 'disabilityType', label: 'Type of special need', type: 'text', required: [] },
  { key: 'heightCm', label: 'Height (cm)', type: 'number', required: [] },
  { key: 'weightKg', label: 'Weight (kg)', type: 'number', required: [] },
  { key: 'bloodGroup', label: 'Blood group', type: 'text', required: [] },
  { key: 'distanceKm', label: 'Distance from home (km)', type: 'number', required: [] },
  { key: 'previousSchool', label: 'Previous school', type: 'text', required: [] },
  { key: 'campus', label: 'School (campus)', type: 'text', required: [] },
  { key: 'udiseCode', label: 'School UDISE code', type: 'text', required: ['UDISE'] },
] as const satisfies readonly { key: string; label: string; type: 'text' | 'date' | 'number'; required: readonly GovExportCode[] }[];
export type GovFieldKey = (typeof GOV_FIELDS)[number]['key'];
export const GOV_FIELD_KEYS = GOV_FIELDS.map((f) => f.key) as unknown as [GovFieldKey, ...GovFieldKey[]];

/** The standard column layouts (fields published for each portal); an institution may change them. */
export const GOV_STANDARD_LAYOUTS: Record<GovExportCode, GovFieldKey[]> = {
  SATS: ['satsId', 'name', 'nameLocal', 'gender', 'dob', 'className', 'section', 'admissionNo', 'admissionDate', 'medium', 'motherTongue', 'religion', 'category', 'fatherName', 'motherName', 'parentPhone', 'address', 'aadhaarLast4', 'apaarId', 'rationCard', 'cwsn', 'disabilityType', 'heightCm', 'weightKg', 'bloodGroup', 'previousSchool'],
  UDISE: ['penNo', 'name', 'gender', 'dob', 'motherName', 'fatherName', 'guardianName', 'aadhaarLast4', 'address', 'parentPhone', 'parentEmail', 'motherTongue', 'socialCategory', 'minorityGroup', 'bpl', 'aay', 'ews', 'cwsn', 'disabilityType', 'admissionNo', 'admissionDate', 'className', 'section', 'rollNo', 'medium', 'apaarId', 'heightCm', 'weightKg', 'distanceKm', 'bloodGroup', 'udiseCode'],
};

export const govLayoutSchema = z.object({
  columns: z.array(z.object({ key: z.enum(GOV_FIELD_KEYS), label: z.string().trim().min(1).max(60) })).min(1).max(GOV_FIELDS.length),
}).superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.columns.forEach((c, i) => { if (seen.has(c.key)) ctx.addIssue({ code: 'custom', path: ['columns', i, 'key'], message: 'This field is already in the layout' }); seen.add(c.key); });
});
export type GovLayoutInput = z.infer<typeof govLayoutSchema>;

// ───────────── G2 Welfare ─────────────

export const WELFARE_KINDS = ['ITEM', 'CASH'] as const;
export const WELFARE_GENDERS = ['ALL', 'MALE', 'FEMALE'] as const;

export const welfareSchemeSchema = z.object({
  academicYearId: uuid,
  name: z.string().trim().min(2, 'Enter a name (at least 2 letters)').max(120),
  kind: z.enum(WELFARE_KINDS),
  inventoryItemId: uuid.nullable().optional().transform((v) => v ?? null),
  quantityPerStudent: blank(z.coerce.number().positive().max(9999).multipleOf(0.01)),
  amountPerStudent: blank(z.coerce.number().positive().max(9_999_999).multipleOf(0.01)),
  levelNames: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  gender: z.enum(WELFARE_GENDERS).default('ALL'),
  status: z.enum(['ACTIVE', 'CLOSED']).default('ACTIVE'),
}).superRefine((v, ctx) => {
  if (v.kind === 'ITEM' && !v.quantityPerStudent) ctx.addIssue({ code: 'custom', path: ['quantityPerStudent'], message: 'Enter how many each student gets' });
  if (v.kind === 'CASH' && !v.amountPerStudent) ctx.addIssue({ code: 'custom', path: ['amountPerStudent'], message: 'Enter the amount for each student' });
  if (v.kind === 'CASH' && v.inventoryItemId) ctx.addIssue({ code: 'custom', path: ['inventoryItemId'], message: 'A cash allowance has no store item' });
});
export type WelfareSchemeInput = z.infer<typeof welfareSchemeSchema>;

export const welfareGiveSchema = z.object({
  sectionId: uuid,
  givenOn: date,
  /** Store the items leave from (item schemes linked to a store item). */
  storeId: uuid.nullable().optional().transform((v) => v ?? null),
  /** Cash: payment reference (cheque, transfer or DBT number). */
  reference: optText(60),
  remarks: optText(200),
  /** Students to give to; empty = everyone in the class still due. */
  studentIds: z.array(uuid).max(500).default([]),
});
export type WelfareGiveInput = z.infer<typeof welfareGiveSchema>;

// ───────────── G3 Diet scale & meals ─────────────

export const dietScaleSchema = z.object({
  inventoryItemId: uuid,
  quantityPerChild: z.coerce.number().positive().max(99).multipleOf(0.001),
  levelNames: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  effectiveFrom: date,
  effectiveTo: blank(date),
}).refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: 'Ends before it starts', path: ['effectiveTo'] });
export type DietScaleInput = z.infer<typeof dietScaleSchema>;

const count = z.coerce.number().int().min(0).max(5000);
export const mealCountsSchema = z.object({
  campusId: uuid,
  mealDate: date,
  rows: z.array(z.object({ levelName: z.string().trim().min(1).max(50), breakfast: count, lunch: count, snacks: count, dinner: count })).min(1).max(40),
});
export type MealCountsInput = z.infer<typeof mealCountsSchema>;

// ───────────── G4 Government staff details ─────────────

export const GOVT_EMPLOYMENT = ['GOVERNMENT', 'OUTSOURCED', 'GUEST', 'PRIVATE'] as const;
export const govStaffSchema = z.object({
  govtEmployment: blank(z.enum(GOVT_EMPLOYMENT)),
  kgidNo: blank(z.string().trim().regex(/^[0-9A-Za-z/-]{4,20}$/, 'KGID number: 4 to 20 letters or digits')),
  hrmsId: blank(z.string().trim().regex(/^[0-9A-Za-z]{4,20}$/, 'HRMS ID: 4 to 20 letters or digits')),
  pranNo: blank(z.string().trim().regex(/^\d{12}$/, 'PRAN is 12 digits')),
  gpfNo: optText(30),
  payScale: optText(60),
  govtServiceDate: blank(date),
});
export type GovStaffInput = z.infer<typeof govStaffSchema>;

export const ddoSchema = z.object({ ddoCode: blank(z.string().trim().regex(/^[0-9A-Za-z]{4,20}$/, 'DDO code: 4 to 20 letters or digits')) });
