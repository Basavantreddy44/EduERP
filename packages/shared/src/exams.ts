import { z } from 'zod';

/**
 * Exams & report cards (Phase 9). Each board's pattern is data: grade scales (bands by lowest %),
 * schemes (terms with a weight in the final result; components with maximum marks and a weight in
 * their term), exams (one component for a campus and year), mark sheets per subject and section.
 */

export const ROUNDING_RULES = ['NONE', 'ROUND', 'CEIL'] as const;
export const RESULT_METHODS = ['MARKS', 'GRADES'] as const;
export const ATTENDANCE_CODES = ['PRESENT', 'ABSENT', 'MALPRACTICE', 'EXEMPT'] as const;
export const SHEET_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED'] as const;
export const FINAL_TERM = 'FINAL';

const pct = z.coerce.number().min(0).max(100);
const code = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only').transform((v) => v.toUpperCase());

// ───────────── M9.1 Grade scales ─────────────

export const gradeScaleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  items: z.array(z.object({
    grade: z.string().trim().min(1).max(5),
    /** Lowest percentage of the band (inclusive); the band runs up to the next band's lowest. */
    minPercent: pct,
    gradePoint: z.coerce.number().min(0).max(10).optional().nullable(),
    description: z.string().trim().max(50).optional().nullable(),
    isFail: z.boolean().default(false),
  })).min(2).max(15),
}).superRefine((v, ctx) => {
  const mins = v.items.map((i) => i.minPercent);
  if (new Set(mins).size !== mins.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Two bands start at the same percentage' });
  if (!mins.includes(0)) ctx.addIssue({ code: 'custom', path: ['items'], message: 'One band must start at 0%' });
  if (new Set(v.items.map((i) => i.grade.toUpperCase())).size !== v.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'A grade is listed twice' });
});
export type GradeScaleInput = z.infer<typeof gradeScaleSchema>;

/** The band for a percentage: the highest band whose lowest % is at or below it. */
export function gradeFor<T extends { minPercent: number | string }>(items: T[], percent: number): T | null {
  const sorted = [...items].sort((a, b) => Number(b.minPercent) - Number(a.minPercent));
  return sorted.find((i) => percent >= Number(i.minPercent)) ?? null;
}

// ───────────── M9.1 Schemes ─────────────

export const schemeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  boardId: z.string().uuid().optional().nullable(),
  resultMethod: z.enum(RESULT_METHODS).default('MARKS'),
  gradeScaleId: z.string().uuid(),
  coScaleId: z.string().uuid().optional().nullable(),
  passPercent: pct,
  subjectPassPercent: pct,
  roundingRule: z.enum(ROUNDING_RULES).default('ROUND'),
  terms: z.array(z.object({ code, name: z.string().trim().min(1).max(50), finalWeight: pct })).min(1).max(6),
  components: z.array(z.object({
    termCode: code, code, name: z.string().trim().min(1).max(80),
    maxMarks: z.coerce.number().positive().max(1000), weightage: pct, isInternal: z.boolean().default(false),
  })).min(1).max(40),
  coAreas: z.array(z.string().trim().min(2).max(80)).max(12).default([]),
  /** Classes (program levels) that use this scheme. */
  programLevelIds: z.array(z.string().uuid()).max(40).default([]),
}).superRefine((v, ctx) => {
  const terms = v.terms.map((t) => t.code);
  if (new Set(terms).size !== terms.length) ctx.addIssue({ code: 'custom', path: ['terms'], message: 'A term is listed twice' });
  if (terms.includes(FINAL_TERM)) ctx.addIssue({ code: 'custom', path: ['terms'], message: 'FINAL is the whole-year result — choose another term code' });
  if (v.terms.length > 1 && Math.abs(v.terms.reduce((a, t) => a + t.finalWeight, 0) - 100) > 0.001) ctx.addIssue({ code: 'custom', path: ['terms'], message: 'Term weights in the final result must add up to 100' });
  const codes = v.components.map((c) => c.code);
  if (new Set(codes).size !== codes.length) ctx.addIssue({ code: 'custom', path: ['components'], message: 'A component code is used twice' });
  for (const t of v.terms) {
    const inTerm = v.components.filter((c) => c.termCode === t.code);
    if (!inTerm.length) ctx.addIssue({ code: 'custom', path: ['components'], message: `${t.name} has no components` });
    else if (Math.abs(inTerm.reduce((a, c) => a + c.weightage, 0) - 100) > 0.001) ctx.addIssue({ code: 'custom', path: ['components'], message: `Weights in ${t.name} must add up to 100` });
  }
  for (const c of v.components) if (!terms.includes(c.termCode)) ctx.addIssue({ code: 'custom', path: ['components'], message: `${c.name} is in an unknown term` });
});
export type SchemeInput = z.infer<typeof schemeSchema>;

// ───────────── Ready-made patterns (applied as editable data) ─────────────

export type PresetScale = { code: string; name: string; items: { grade: string; minPercent: number; gradePoint?: number; description: string; isFail?: boolean }[] };
export const PRESET_SCALES: PresetScale[] = [
  { code: 'CBSE_8', name: 'CBSE 8-point', items: [
    { grade: 'A1', minPercent: 91, gradePoint: 10, description: 'Outstanding' }, { grade: 'A2', minPercent: 81, gradePoint: 9, description: 'Excellent' },
    { grade: 'B1', minPercent: 71, gradePoint: 8, description: 'Very good' }, { grade: 'B2', minPercent: 61, gradePoint: 7, description: 'Good' },
    { grade: 'C1', minPercent: 51, gradePoint: 6, description: 'Above average' }, { grade: 'C2', minPercent: 41, gradePoint: 5, description: 'Average' },
    { grade: 'D', minPercent: 33, gradePoint: 4, description: 'Pass' }, { grade: 'E', minPercent: 0, description: 'Needs improvement', isFail: true },
  ] },
  { code: 'KA_STATE', name: 'Karnataka State', items: [
    { grade: 'A+', minPercent: 90, description: 'Distinction' }, { grade: 'A', minPercent: 80, description: 'Excellent' }, { grade: 'B+', minPercent: 70, description: 'Very good' },
    { grade: 'B', minPercent: 60, description: 'Good' }, { grade: 'C+', minPercent: 50, description: 'Average' }, { grade: 'C', minPercent: 35, description: 'Pass' },
    { grade: 'F', minPercent: 0, description: 'Below pass', isFail: true },
  ] },
  { code: 'KA_PU', name: 'Karnataka PU classes', items: [
    { grade: 'DIST', minPercent: 85, description: 'Distinction' }, { grade: 'I', minPercent: 60, description: 'First class' }, { grade: 'II', minPercent: 50, description: 'Second class' },
    { grade: 'P', minPercent: 35, description: 'Pass class' }, { grade: 'F', minPercent: 0, description: 'Fail', isFail: true },
  ] },
  { code: 'CO_3', name: 'Co-scholastic 3-point', items: [
    { grade: 'A', minPercent: 67, description: 'Outstanding' }, { grade: 'B', minPercent: 34, description: 'Very good' }, { grade: 'C', minPercent: 0, description: 'Fair' },
  ] },
];

export type PresetScheme = Omit<SchemeInput, 'gradeScaleId' | 'coScaleId' | 'programLevelIds' | 'boardId'> & { code: string; scale: string; coScale?: string };
const cbseTerm = (t: string, n: string) => [
  { termCode: t, code: `PT${n}`, name: `Periodic Test ${n}`, maxMarks: 20, weightage: 10, isInternal: true },
  { termCode: t, code: `NB${n}`, name: `Notebook ${n}`, maxMarks: 5, weightage: 5, isInternal: true },
  { termCode: t, code: `SE${n}`, name: `Subject Enrichment ${n}`, maxMarks: 5, weightage: 5, isInternal: true },
  { termCode: t, code: n === '1' ? 'HY' : 'AE', name: n === '1' ? 'Half-yearly exam' : 'Annual exam', maxMarks: 80, weightage: 80, isInternal: false },
];
export const PRESET_SCHEMES: PresetScheme[] = [
  { code: 'CBSE', name: 'CBSE (two terms)', scale: 'CBSE_8', coScale: 'CO_3', resultMethod: 'MARKS', passPercent: 33, subjectPassPercent: 33, roundingRule: 'ROUND',
    terms: [{ code: 'TERM_1', name: 'Term 1', finalWeight: 50 }, { code: 'TERM_2', name: 'Term 2', finalWeight: 50 }],
    components: [...cbseTerm('TERM_1', '1'), ...cbseTerm('TERM_2', '2')],
    coAreas: ['Work Education', 'Art Education', 'Health & Physical Education', 'Discipline'] },
  { code: 'KA_STATE', name: 'Karnataka State (FA + SA)', scale: 'KA_STATE', resultMethod: 'MARKS', passPercent: 35, subjectPassPercent: 35, roundingRule: 'ROUND',
    terms: [{ code: 'TERM_1', name: 'First term', finalWeight: 50 }, { code: 'TERM_2', name: 'Second term', finalWeight: 50 }],
    components: [
      { termCode: 'TERM_1', code: 'FA1', name: 'Formative Assessment 1', maxMarks: 20, weightage: 15, isInternal: true },
      { termCode: 'TERM_1', code: 'FA2', name: 'Formative Assessment 2', maxMarks: 20, weightage: 15, isInternal: true },
      { termCode: 'TERM_1', code: 'SA1', name: 'Summative Assessment 1', maxMarks: 80, weightage: 70, isInternal: false },
      { termCode: 'TERM_2', code: 'FA3', name: 'Formative Assessment 3', maxMarks: 20, weightage: 15, isInternal: true },
      { termCode: 'TERM_2', code: 'FA4', name: 'Formative Assessment 4', maxMarks: 20, weightage: 15, isInternal: true },
      { termCode: 'TERM_2', code: 'SA2', name: 'Summative Assessment 2', maxMarks: 80, weightage: 70, isInternal: false },
    ], coAreas: [] },
  { code: 'KA_PU', name: 'Karnataka PU (college exams)', scale: 'KA_PU', resultMethod: 'MARKS', passPercent: 35, subjectPassPercent: 35, roundingRule: 'CEIL',
    terms: [{ code: 'ANNUAL', name: 'Whole year', finalWeight: 100 }],
    components: [
      { termCode: 'ANNUAL', code: 'UT1', name: 'Unit Test 1', maxMarks: 25, weightage: 10, isInternal: true },
      { termCode: 'ANNUAL', code: 'MID', name: 'Mid-term exam', maxMarks: 100, weightage: 30, isInternal: false },
      { termCode: 'ANNUAL', code: 'PREP', name: 'Preparatory exam', maxMarks: 100, weightage: 60, isInternal: false },
    ], coAreas: [] },
];

// ───────────── M9.2 Exams & marks ─────────────

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const examSchema = z.object({
  campusId: z.string().uuid(),
  schemeId: z.string().uuid(),
  componentId: z.string().uuid(),
  name: z.string().trim().min(3).max(100),
  startDate: z.string().date(),
  endDate: z.string().date(),
}).refine((v) => v.endDate >= v.startDate, { message: 'The last day is before the first', path: ['endDate'] });
export type ExamInput = z.infer<typeof examSchema>;

/** The exam timetable for one class (program level): its subjects with date, time and marks. */
export const examScheduleSchema = z.object({
  programLevelId: z.string().uuid(),
  subjects: z.array(z.object({
    subjectId: z.string().uuid(),
    examDate: z.string().date(),
    startTime: time.optional().nullable(),
    endTime: time.optional().nullable(),
    maxMarks: z.coerce.number().positive().max(1000),
    passMarks: z.coerce.number().min(0).max(1000).optional().nullable(),
  }).refine((s) => s.passMarks == null || s.passMarks <= s.maxMarks, { message: 'Pass marks are above the maximum', path: ['passMarks'] })
    .refine((s) => !s.startTime || !s.endTime || s.endTime > s.startTime, { message: 'Ends before it starts', path: ['endTime'] })).max(30)
    .refine((v) => new Set(v.map((s) => s.subjectId)).size === v.length, 'A subject is listed twice'),
});
export type ExamScheduleInput = z.infer<typeof examScheduleSchema>;

export const marksSchema = z.object({
  marks: z.array(z.object({
    studentId: z.string().uuid(),
    attendanceCode: z.enum(ATTENDANCE_CODES).default('PRESENT'),
    marks: z.coerce.number().min(0).max(1000).optional().nullable(),
  }).refine((m) => m.attendanceCode !== 'PRESENT' || (m.marks !== null && m.marks !== undefined), { message: 'Enter the marks (or mark the student absent)', path: ['marks'] })).max(200),
  /** Required to change marks after they are verified. */
  reason: z.string().trim().min(5).max(300).optional().nullable(),
});
export type MarksInput = z.infer<typeof marksSchema>;

// ───────────── M9.3 Results ─────────────

export const calculateSchema = z.object({ sectionId: z.string().uuid(), termCode: z.string().trim().min(1).max(20) });
export type CalculateInput = z.infer<typeof calculateSchema>;
export const resultRemarksSchema = z.object({ remarks: z.string().trim().max(500).optional().nullable() });
export type ResultRemarksInput = z.infer<typeof resultRemarksSchema>;
export const coGradesSchema = z.object({
  sectionId: z.string().uuid(),
  termCode: z.string().trim().min(1).max(20),
  grades: z.array(z.object({ studentId: z.string().uuid(), areaId: z.string().uuid(), grade: z.string().trim().min(1).max(5) })).max(2000),
});
export type CoGradesInput = z.infer<typeof coGradesSchema>;

/** Rounds a percentage by the scheme's rule (NONE keeps two decimals). */
export function roundBy(rule: (typeof ROUNDING_RULES)[number], v: number): number {
  if (rule === 'ROUND') return Math.round(v);
  if (rule === 'CEIL') return Math.ceil(v - 1e-9);
  return Math.round(v * 100) / 100;
}

/** Competition ranking: equal percentages share a rank, the next rank skips (1, 1, 3). */
export function ranks(values: { id: string; percent: number }[]): Map<string, number> {
  const sorted = [...values].sort((a, b) => b.percent - a.percent);
  const out = new Map<string, number>();
  sorted.forEach((v, i) => out.set(v.id, i > 0 && v.percent === sorted[i - 1].percent ? out.get(sorted[i - 1].id)! : i + 1));
  return out;
}
