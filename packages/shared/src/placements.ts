import { z } from 'zod';
import { money } from './fees';

/**
 * Phase 19: placements (B6 §4) and reports & exports (B6 §5).
 * Owner decisions 2026-11-21: the placement cell enters CGPA / percentage and backlogs until CBCS
 * exists; background exports are Excel and CSV only (PDF stays "Print / save as PDF").
 */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const COMPANY_STATUSES = ['ACTIVE', 'BLACKLISTED'] as const;
export const SCORE_TYPES = ['CGPA', 'PERCENT'] as const;
export const JOB_TYPES = ['FULL_TIME', 'INTERNSHIP'] as const;
export const DRIVE_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'] as const;
export const PLACEMENT_APP_STATUSES = ['APPLIED', 'SHORTLISTED', 'IN_PROCESS', 'SELECTED', 'REJECTED', 'WITHDRAWN'] as const;
export const OFFER_STATUSES = ['OFFERED', 'ACCEPTED', 'DECLINED', 'REVOKED'] as const;
export const EXPORT_FORMATS = ['XLSX', 'CSV'] as const;
export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;
export const REPORT_SCHEDULES = ['NONE', 'WEEKLY', 'MONTHLY'] as const;
/** Export files are kept this many days. */
export const EXPORT_KEEP_DAYS = 7;

const scoreRefine = <T extends { scoreType?: string | null; score?: string | null }>(v: T) => !v.score || !v.scoreType || (v.scoreType === 'CGPA' ? Number(v.score) <= 10 : Number(v.score) <= 100);

export const companySchema = z.object({
  name: z.string().trim().min(2).max(200),
  industry: optText(100),
  website: z.string().trim().url('Enter a full web address (https://…)').max(200).optional().nullable().or(z.literal('').transform(() => null)),
  hrName: optText(100),
  hrEmail: z.string().trim().email().max(150).optional().nullable().or(z.literal('').transform(() => null)),
  hrPhone: z.string().trim().regex(/^\d{6,15}$/, 'Phone: 6 to 15 digits').optional().nullable().or(z.literal('').transform(() => null)),
  address: optText(500),
  status: z.enum(COMPANY_STATUSES).default('ACTIVE'),
  blacklistReason: optText(300),
}).refine((v) => v.status !== 'BLACKLISTED' || !!v.blacklistReason, { path: ['blacklistReason'], message: 'Say why the company is blacklisted' });
export type CompanyInput = z.infer<typeof companySchema>;

/** The placement cell's entry for one student (score verified by the officer saving it). */
export const placementProfileSchema = z.object({
  isOptedIn: z.boolean().default(true),
  passingYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  scoreType: z.enum(SCORE_TYPES).nullable().optional(),
  score: money.nullable().optional(),
  backlogs: z.coerce.number().int().min(0).max(99).nullable().optional(),
  skills: optText(500),
  preferredLocations: optText(200),
}).refine((v) => !v.score || !!v.scoreType, { path: ['scoreType'], message: 'Say whether it is CGPA or a percentage' })
  .refine(scoreRefine, { path: ['score'], message: 'CGPA is 0–10 and a percentage 0–100' });
export type PlacementProfileInput = z.infer<typeof placementProfileSchema>;

export const driveSchema = z.object({
  campusId: uuid,
  companyId: uuid,
  title: z.string().trim().min(2).max(200),
  jobType: z.enum(JOB_TYPES).default('FULL_TIME'),
  ctcMin: money.nullable().optional(),
  ctcMax: money.nullable().optional(),
  eligibleProgramIds: z.array(uuid).max(50).default([]),
  passingYear: z.coerce.number().int().min(2000).max(2100),
  scoreType: z.enum(SCORE_TYPES).default('CGPA'),
  minScore: money.nullable().optional(),
  maxBacklogs: z.coerce.number().int().min(0).max(99).nullable().optional(),
  allowPlaced: z.boolean().default(false),
  lastDateToApply: date,
  driveDate: date.nullable().optional(),
  rounds: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  description: optText(2000),
}).refine((v) => !v.ctcMin || !v.ctcMax || Number(v.ctcMax) >= Number(v.ctcMin), { path: ['ctcMax'], message: 'The maximum is below the minimum' })
  .refine((v) => !v.driveDate || v.driveDate >= v.lastDateToApply, { path: ['driveDate'], message: 'The drive is before the last date to apply' })
  .refine((v) => !v.minScore || (v.scoreType === 'CGPA' ? Number(v.minScore) <= 10 : Number(v.minScore) <= 100), { path: ['minScore'], message: 'CGPA is 0–10 and a percentage 0–100' });
export type DriveInput = z.infer<typeof driveSchema>;
export const driveStatusSchema = z.object({ status: z.enum(['OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED']) });

export const placementEnrolSchema = z.object({ studentIds: z.array(uuid).min(1).max(500) });
export const applicationUpdateSchema = z.object({ status: z.enum(['SHORTLISTED', 'IN_PROCESS', 'SELECTED', 'REJECTED', 'WITHDRAWN']), currentRound: optText(50), remarks: optText(300) });

export const offerSchema = z.object({
  ctc: money.refine((v) => Number(v) > 0, 'Enter the CTC'),
  offerDate: date,
  joiningDate: date.nullable().optional(),
  remarks: optText(300),
}).refine((v) => !v.joiningDate || v.joiningDate >= v.offerDate, { path: ['joiningDate'], message: 'Joining is before the offer date' });
export type OfferInput = z.infer<typeof offerSchema>;
export const offerStatusSchema = z.object({ status: z.enum(['ACCEPTED', 'DECLINED', 'REVOKED']), remarks: optText(300) });

// ───────────── Reports & exports ─────────────

export const CATALOGUE_REPORT_CODES = ['STUDENT_LIST', 'FEE_DUES', 'FEE_COLLECTION', 'ATTENDANCE_SUMMARY', 'STAFF_LIST', 'LIBRARY_OVERDUE', 'STOCK_VALUE', 'ACHIEVEMENTS', 'PLACEMENT_OFFERS', 'GOV_SATS', 'GOV_UDISE', 'STAFF_GOVT', 'WELFARE_STATUS', 'MIS_MONTHLY'] as const;
export type CatalogueReportCode = (typeof CATALOGUE_REPORT_CODES)[number];
/** Filters every report understands; each report uses the ones it needs. */
export const reportFiltersSchema = z.object({
  campusId: uuid.optional(),
  sectionId: uuid.optional(),
  storeId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  status: z.string().trim().max(30).optional(),
  mode: z.string().trim().max(20).optional(),
  passingYear: z.coerce.number().int().min(2000).max(2100).optional(),
  minBalance: z.coerce.number().min(0).optional(),
  schemeId: uuid.optional(),
}).refine((v) => !v.from || !v.to || v.to >= v.from, { path: ['to'], message: 'The end is before the start' });
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const savedReportSchema = z.object({
  reportCode: z.enum(CATALOGUE_REPORT_CODES),
  name: z.string().trim().min(2).max(150),
  filters: reportFiltersSchema.default({}),
  isShared: z.boolean().default(false),
  schedule: z.enum(REPORT_SCHEDULES).default('NONE'),
  scheduleFormat: z.enum(EXPORT_FORMATS).default('XLSX'),
});
export type SavedReportInput = z.infer<typeof savedReportSchema>;
export const exportSchema = z.object({ reportCode: z.enum(CATALOGUE_REPORT_CODES), filters: reportFiltersSchema.default({}), format: z.enum(EXPORT_FORMATS).default('XLSX') });
export type ExportInput = z.infer<typeof exportSchema>;
