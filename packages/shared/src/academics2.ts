import { z } from 'zod';

/** Academics II (Phase 10): lesson plans & syllabus tracking, study material, certificates. */

const isoDate = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

// ───────────── M10.1 Syllabus units, topics, lesson plans ─────────────

/** The whole syllabus (units with topics) of one class and subject for the current year. */
export const syllabusPlanSchema = z.object({
  programLevelId: z.string().uuid(),
  subjectId: z.string().uuid(),
  units: z.array(z.object({
    id: z.string().uuid().optional().nullable(),
    title: z.string().trim().min(2).max(200),
    plannedHours: z.coerce.number().min(0).max(500).optional().nullable(),
    topics: z.array(z.object({ id: z.string().uuid().optional().nullable(), title: z.string().trim().min(2).max(300) })).max(60),
  })).max(40),
});
export type SyllabusPlanInput = z.infer<typeof syllabusPlanSchema>;

export const LESSON_STATUSES = ['PLANNED', 'COMPLETED', 'POSTPONED'] as const;
export const lessonPlanSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  topicId: z.string().uuid(),
  plannedDate: isoDate,
  objectives: optText(2000),
  teachingMethod: optText(100),
  resources: optText(1000),
});
export type LessonPlanInput = z.infer<typeof lessonPlanSchema>;
export const lessonStatusSchema = z.object({
  status: z.enum(['COMPLETED', 'POSTPONED']),
  /** For POSTPONED: the new date. */
  newDate: isoDate.optional().nullable(),
  notes: optText(300),
}).refine((v) => v.status !== 'POSTPONED' || !!v.newDate, { message: 'Choose the new date', path: ['newDate'] });
export type LessonStatusInput = z.infer<typeof lessonStatusSchema>;

// ───────────── M10.2 Study material ─────────────

export const MATERIAL_TYPES = ['NOTE', 'LINK', 'VIDEO', 'FILE'] as const;
export const materialSchema = z.object({
  programLevelId: z.string().uuid(),
  /** One section only (otherwise every section of the class). */
  sectionId: z.string().uuid().optional().nullable(),
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3).max(200),
  description: optText(2000),
  materialType: z.enum(MATERIAL_TYPES),
  url: z.string().trim().url().max(500).refine((u) => /^https:\/\//i.test(u), 'Use an https:// link').optional().nullable(),
  body: optText(20000),
  fileId: z.string().uuid().optional().nullable(),
  publish: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if ((v.materialType === 'LINK' || v.materialType === 'VIDEO') && !v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'Paste the link' });
  if (v.materialType === 'NOTE' && !v.body) ctx.addIssue({ code: 'custom', path: ['body'], message: 'Write the notes' });
  if (v.materialType === 'FILE' && !v.fileId) ctx.addIssue({ code: 'custom', path: ['fileId'], message: 'Attach the file' });
});
export type MaterialInput = z.infer<typeof materialSchema>;

// ───────────── M10.3 Certificates ─────────────

export const CERTIFICATE_TYPES = ['BONAFIDE', 'STUDY', 'CHARACTER', 'CONDUCT'] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];
export const CERT_LANGUAGES = ['en', 'kn'] as const;

/** Placeholders a template may use; filled from the student's record when the certificate is issued. */
export const CERT_PLACEHOLDERS = ['studentName', 'parentName', 'fatherName', 'motherName', 'admissionNo', 'className', 'academicYear', 'dateOfBirth', 'admissionDate', 'gender', 'heShe', 'hisHer', 'sonDaughter', 'purpose', 'issueDate', 'schoolName', 'campusName'] as const;

export const certTemplateSchema = z.object({
  certificateType: z.enum(CERTIFICATE_TYPES),
  name: z.string().trim().min(3).max(100),
  language: z.enum(CERT_LANGUAGES),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(5000),
  requiresApproval: z.boolean().default(false),
}).superRefine((v, ctx) => {
  for (const m of v.body.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (!(CERT_PLACEHOLDERS as readonly string[]).includes(m[1])) ctx.addIssue({ code: 'custom', path: ['body'], message: `Unknown placeholder {{${m[1]}}}` });
  }
});
export type CertTemplateInput = z.infer<typeof certTemplateSchema>;

export const certRequestSchema = z.object({
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
  purpose: z.string().trim().min(3).max(200),
});
export type CertRequestInput = z.infer<typeof certRequestSchema>;
export const certCancelSchema = z.object({ reason: z.string().trim().min(5).max(300) });

/** Fills {{placeholders}}; unknown or empty values become a dash so nothing is left blank silently. */
export function fillTemplate(body: string, values: Partial<Record<(typeof CERT_PLACEHOLDERS)[number], string | null>>): string {
  return body.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k: string) => (values as Record<string, string | null | undefined>)[k] || '—');
}

/** Ready-made templates (copied in as editable data). */
export const DEFAULT_CERT_TEMPLATES: Omit<CertTemplateInput, 'requiresApproval'>[] = [
  { certificateType: 'BONAFIDE', name: 'Bonafide certificate', language: 'en', title: 'Bonafide Certificate',
    body: 'This is to certify that {{studentName}}, {{sonDaughter}} of {{parentName}}, is a bonafide student of this institution, studying in {{className}} during the academic year {{academicYear}}. {{heShe}} was admitted on {{admissionDate}} with admission number {{admissionNo}}, and {{hisHer}} date of birth as per our records is {{dateOfBirth}}.\n\nThis certificate is issued on request for the purpose of {{purpose}}.' },
  { certificateType: 'STUDY', name: 'Study certificate', language: 'en', title: 'Study Certificate',
    body: 'This is to certify that {{studentName}}, {{sonDaughter}} of {{parentName}}, has been studying in this institution since {{admissionDate}} (admission number {{admissionNo}}) and is at present in {{className}} in the academic year {{academicYear}}. {{hisHer}} date of birth as per our records is {{dateOfBirth}}.\n\nIssued for the purpose of {{purpose}}.' },
  { certificateType: 'CHARACTER', name: 'Character certificate', language: 'en', title: 'Character Certificate',
    body: 'This is to certify that {{studentName}}, {{sonDaughter}} of {{parentName}}, admission number {{admissionNo}}, is a student of {{className}} in the academic year {{academicYear}}. To the best of our knowledge {{heShe}} bears a good moral character and has not taken part in any activity against the rules of the institution.\n\nIssued for the purpose of {{purpose}}.' },
  { certificateType: 'CONDUCT', name: 'Conduct certificate', language: 'en', title: 'Conduct Certificate',
    body: 'This is to certify that the conduct of {{studentName}}, {{sonDaughter}} of {{parentName}}, a student of {{className}} (admission number {{admissionNo}}) in the academic year {{academicYear}}, has been good during {{hisHer}} time in this institution.\n\nIssued for the purpose of {{purpose}}.' },
  { certificateType: 'BONAFIDE', name: 'ವಾಸ್ತವಿಕ ವಿದ್ಯಾರ್ಥಿ ಪ್ರಮಾಣಪತ್ರ', language: 'kn', title: 'ವಾಸ್ತವಿಕ ವಿದ್ಯಾರ್ಥಿ ಪ್ರಮಾಣಪತ್ರ',
    body: '{{parentName}} ಅವರ ಮಗು {{studentName}} ಅವರು ಈ ಸಂಸ್ಥೆಯ ವಾಸ್ತವಿಕ ವಿದ್ಯಾರ್ಥಿಯಾಗಿದ್ದು, {{academicYear}} ಶೈಕ್ಷಣಿಕ ವರ್ಷದಲ್ಲಿ {{className}} ತರಗತಿಯಲ್ಲಿ ಓದುತ್ತಿದ್ದಾರೆ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ. ದಾಖಲಾತಿ ಸಂಖ್ಯೆ {{admissionNo}}, ದಾಖಲಾದ ದಿನಾಂಕ {{admissionDate}}, ನಮ್ಮ ದಾಖಲೆಗಳ ಪ್ರಕಾರ ಜನ್ಮ ದಿನಾಂಕ {{dateOfBirth}}.\n\n{{purpose}} ಉದ್ದೇಶಕ್ಕಾಗಿ ಕೋರಿಕೆಯ ಮೇರೆಗೆ ಈ ಪ್ರಮಾಣಪತ್ರ ನೀಡಲಾಗಿದೆ.' },
  { certificateType: 'STUDY', name: 'ವ್ಯಾಸಂಗ ಪ್ರಮಾಣಪತ್ರ', language: 'kn', title: 'ವ್ಯಾಸಂಗ ಪ್ರಮಾಣಪತ್ರ',
    body: '{{parentName}} ಅವರ ಮಗು {{studentName}} ಅವರು {{admissionDate}} ರಿಂದ ಈ ಸಂಸ್ಥೆಯಲ್ಲಿ ಓದುತ್ತಿದ್ದು (ದಾಖಲಾತಿ ಸಂಖ್ಯೆ {{admissionNo}}), ಪ್ರಸ್ತುತ {{academicYear}} ರಲ್ಲಿ {{className}} ತರಗತಿಯಲ್ಲಿದ್ದಾರೆ ಎಂದು ಪ್ರಮಾಣೀಕರಿಸಲಾಗಿದೆ. ನಮ್ಮ ದಾಖಲೆಗಳ ಪ್ರಕಾರ ಜನ್ಮ ದಿನಾಂಕ {{dateOfBirth}}.\n\n{{purpose}} ಉದ್ದೇಶಕ್ಕಾಗಿ ನೀಡಲಾಗಿದೆ.' },
];

/** A verification code: 12 characters without look-alikes (0/O, 1/I/L), grouped for reading aloud. */
export const VERIFY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const verifyCodeSchema = z.string().trim().toUpperCase().regex(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, 'Not a valid code');
