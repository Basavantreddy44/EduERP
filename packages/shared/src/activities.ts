import { z } from 'zod';
import { money } from './fees';

/** Phase 18: labs (B6 §2) and sports & activities (B6 §3). */

const uuid = z.string().uuid();
const date = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export const EQUIPMENT_CONDITIONS = ['WORKING', 'NEEDS_REPAIR', 'DAMAGED', 'DISPOSED'] as const;
export const LAB_SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export const BREAKAGE_STATUSES = ['REPORTED', 'PENDING_APPROVAL', 'CHARGED', 'WAIVED'] as const;
export const ACTIVITY_TYPES = ['SPORT', 'CLUB', 'HOUSE'] as const;
export const MEMBER_ROLES = ['MEMBER', 'CAPTAIN', 'VICE_CAPTAIN', 'SECRETARY'] as const;
export const COMPETITION_LEVELS = ['INTRA', 'INTER_SCHOOL', 'ZONAL', 'DISTRICT', 'STATE', 'NATIONAL', 'INTERNATIONAL'] as const;
export const COMPETITION_RESULTS = ['PARTICIPATED', 'WINNER', 'RUNNER_UP', 'THIRD', 'SPECIAL'] as const;
export const ACHIEVEMENT_CATEGORIES = ['SPORTS', 'ACADEMIC', 'CULTURAL', 'NCC_NSS', 'OTHER'] as const;
/** Calibration falling due within this many days is listed as due soon. */
export const CALIBRATION_DUE_DAYS = 30;

// ───────────── Labs ─────────────

export const labSchema = z.object({
  campusId: uuid,
  name: z.string().trim().min(2).max(100),
  departmentId: uuid.nullable().optional(),
  inchargeEmployeeId: uuid.nullable().optional(),
  assistantEmployeeId: uuid.nullable().optional(),
  storeId: uuid.nullable().optional(),
  capacity: z.coerce.number().int().min(1).max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type LabInput = z.infer<typeof labSchema>;

export const equipmentSchema = z.object({
  labId: uuid,
  itemId: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(200),
  assetTag: z.string().trim().toUpperCase().min(1).max(50).regex(/^[A-Z0-9][A-Z0-9/_-]*$/, 'Letters, digits, - / _'),
  quantity: z.coerce.number().int().min(0).max(10000).default(1),
  condition: z.enum(EQUIPMENT_CONDITIONS).default('WORKING'),
  lastCalibrationDate: date.nullable().optional(),
  nextCalibrationDate: date.nullable().optional(),
  notes: optText(300),
}).refine((v) => !v.lastCalibrationDate || !v.nextCalibrationDate || v.nextCalibrationDate >= v.lastCalibrationDate, { path: ['nextCalibrationDate'], message: 'The next calibration is before the last one' });
export type EquipmentInput = z.infer<typeof equipmentSchema>;

export const labSessionSchema = z.object({
  labId: uuid,
  sectionId: uuid,
  subjectId: uuid.nullable().optional(),
  batchName: optText(20),
  employeeId: uuid.nullable().optional(),
  sessionDate: date,
  startTime: hhmm,
  endTime: hhmm,
  experimentTitle: z.string().trim().min(3, 'Name the experiment').max(200),
}).refine((v) => v.endTime > v.startTime, { path: ['endTime'], message: 'The end is before the start' });
export type LabSessionInput = z.infer<typeof labSessionSchema>;

export const completeSessionSchema = z.object({
  status: z.enum(['COMPLETED', 'CANCELLED']),
  studentsPresent: z.coerce.number().int().min(0).max(500).nullable().optional(),
  remarks: optText(300),
});

export const breakageSchema = z.object({
  labId: uuid,
  equipmentId: uuid.nullable().optional(),
  sessionId: uuid.nullable().optional(),
  itemDescription: z.string().trim().min(2, 'What was broken?').max(200),
  studentId: uuid.nullable().optional(),
  breakageDate: date,
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
  chargeAmount: money.default('0'),
  remarks: optText(300),
  /** Equipment is marked damaged and its working count reduced. */
  markDamaged: z.boolean().default(false),
});
export type BreakageInput = z.infer<typeof breakageSchema>;
export const breakageDecisionSchema = z.object({ action: z.enum(['CHARGE', 'WAIVE']), reason: optText(300) })
  .refine((v) => v.action !== 'WAIVE' || !!v.reason, { path: ['reason'], message: 'Say why it is waived' });

// ───────────── Sports & activities ─────────────

export const activitySchema = z.object({
  campusId: uuid,
  name: z.string().trim().min(2).max(100),
  activityType: z.enum(ACTIVITY_TYPES),
  coordinatorEmployeeId: uuid.nullable().optional(),
  description: optText(500),
  isActive: z.boolean().default(true),
});
export type ActivityInput = z.infer<typeof activitySchema>;

export const memberSchema = z.object({
  studentIds: z.array(uuid).min(1, 'Choose at least one student').max(200),
  teamName: optText(50),
  memberRole: z.enum(MEMBER_ROLES).default('MEMBER'),
});
export type MemberInput = z.infer<typeof memberSchema>;
export const memberUpdateSchema = z.object({ teamName: optText(50), memberRole: z.enum(MEMBER_ROLES) });

export const competitionSchema = z.object({
  activityId: uuid,
  name: z.string().trim().min(3).max(200),
  level: z.enum(COMPETITION_LEVELS),
  venue: optText(200),
  startDate: date,
  endDate: date,
  description: optText(500),
  /** Also put it on the school calendar. */
  addToCalendar: z.boolean().default(false),
}).refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'The end is before the start' });
export type CompetitionInput = z.infer<typeof competitionSchema>;

export const participantSchema = z.object({
  studentIds: z.array(uuid).min(1, 'Choose at least one student').max(200),
  category: z.string().trim().max(100).default(''),
});
export const resultSchema = z.object({ result: z.enum(COMPETITION_RESULTS), remarks: optText(200) });

export const achievementSchema = z.object({
  studentId: uuid.nullable().optional(),
  employeeId: uuid.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  category: z.enum(ACHIEVEMENT_CATEGORIES),
  level: z.enum(COMPETITION_LEVELS),
  achievementDate: date,
  description: optText(500),
}).refine((v) => !!v.studentId !== !!v.employeeId, { path: ['studentId'], message: 'Choose the student or the staff member' });
export type AchievementInput = z.infer<typeof achievementSchema>;
export const verifyAchievementSchema = z.object({ postToFeed: z.boolean().default(false) });

/** Achievement title from a competition result, e.g. "Winner — 100 m U-14, District athletics meet". */
export const RESULT_TITLE: Record<(typeof COMPETITION_RESULTS)[number], string> = { WINNER: 'Winner', RUNNER_UP: 'Runner-up', THIRD: 'Third place', SPECIAL: 'Special mention', PARTICIPATED: 'Participated' };
