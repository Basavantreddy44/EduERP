import { z } from 'zod';

/**
 * Class structure (B1 §5): one model for school, PU and degree.
 *   School  → programme "State Board School", levels Class 1…10, sections A/B/C
 *   PU      → programme "PU Science (PCMB)", levels I PUC, II PUC
 *   UG / PG → programme "B.Com", levels Semester 1…6
 */
export const BOARD_TYPES = ['SCHOOL_BOARD', 'PU_BOARD', 'UNIVERSITY'] as const;
export const GRADING_SYSTEMS = ['MARKS', 'GRADES', 'CBCS'] as const;
export const PROGRAM_TYPES = ['SCHOOL', 'PU', 'UG', 'PG', 'DIPLOMA'] as const;
export type ProgramType = (typeof PROGRAM_TYPES)[number];
export const STREAMS = ['SCIENCE', 'COMMERCE', 'ARTS'] as const;

/** Common boards offered with one click (Karnataka-first). */
export const COMMON_BOARDS: { name: string; boardType: (typeof BOARD_TYPES)[number]; gradingSystem: (typeof GRADING_SYSTEMS)[number] }[] = [
  { name: 'Karnataka State Board (KSEAB)', boardType: 'SCHOOL_BOARD', gradingSystem: 'MARKS' },
  { name: 'CBSE', boardType: 'SCHOOL_BOARD', gradingSystem: 'GRADES' },
  { name: 'ICSE', boardType: 'SCHOOL_BOARD', gradingSystem: 'MARKS' },
  { name: 'Karnataka PU Board (DPUE)', boardType: 'PU_BOARD', gradingSystem: 'MARKS' },
  { name: 'University (CBCS)', boardType: 'UNIVERSITY', gradingSystem: 'CBCS' },
];

/** Sensible defaults per programme type, used by the "Add programme" form. */
export const PROGRAM_PRESETS: Record<ProgramType, { levelLabel: string; durationLevels: number; startAt: number }> = {
  SCHOOL: { levelLabel: 'Class', durationLevels: 10, startAt: 1 },
  PU: { levelLabel: 'PUC', durationLevels: 2, startAt: 1 },
  UG: { levelLabel: 'Semester', durationLevels: 6, startAt: 1 },
  PG: { levelLabel: 'Semester', durationLevels: 4, startAt: 1 },
  DIPLOMA: { levelLabel: 'Semester', durationLevels: 6, startAt: 1 },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

/** Level names in promotion order. PU uses "I PUC, II PUC"; others "<Label> <n>". */
export function generateLevelNames(programType: ProgramType, levelLabel: string, count: number, startAt = 1): string[] {
  return Array.from({ length: count }, (_, i) => {
    const n = startAt + i;
    if (programType === 'PU' && levelLabel.trim().toUpperCase() === 'PUC') return `${ROMAN[n - 1] ?? n} PUC`;
    return `${levelLabel.trim()} ${n}`;
  });
}

export const createBoardSchema = z.object({
  name: z.string().trim().min(2).max(100),
  boardType: z.enum(BOARD_TYPES),
  gradingSystem: z.enum(GRADING_SYSTEMS),
});
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const createProgramSchema = z
  .object({
    campusId: z.string().uuid(),
    boardId: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(2).max(150),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 letters, digits, - or _'),
    programType: z.enum(PROGRAM_TYPES),
    stream: z.enum(STREAMS).nullable().optional(),
    levelLabel: z.string().trim().min(1).max(20),
    durationLevels: z.number().int().min(1).max(15),
    startAt: z.number().int().min(1).max(12).default(1),
    /** Optional custom names (e.g. LKG, UKG, Class 1…). Must match durationLevels. */
    levelNames: z.array(z.string().trim().min(1).max(50)).max(15).optional(),
  })
  .refine((v) => !v.levelNames || v.levelNames.length === v.durationLevels, { message: 'Give one name per level', path: ['levelNames'] })
  .refine((v) => !v.levelNames || new Set(v.levelNames.map((n) => n.toLowerCase())).size === v.levelNames.length, { message: 'Level names must be different', path: ['levelNames'] });
export type CreateProgramInput = z.infer<typeof createProgramSchema>;

export const updateProgramSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  boardId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;

export const renameLevelSchema = z.object({ name: z.string().trim().min(1).max(50) });

export const SECTION_NAME = z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{1,20}$/, 'Letters, digits, space or -');
export const createSectionsSchema = z.object({
  academicYearId: z.string().uuid(),
  programLevelId: z.string().uuid(),
  names: z.array(SECTION_NAME).min(1).max(20).refine((a) => new Set(a).size === a.length, { message: 'Section names must be different' }),
  capacity: z.number().int().min(1).max(500).default(40),
});
export type CreateSectionsInput = z.infer<typeof createSectionsSchema>;

export const updateSectionSchema = z.object({
  capacity: z.number().int().min(1).max(500).optional(),
  room: z.string().trim().max(30).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

export const sectionsQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
});
