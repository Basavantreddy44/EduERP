import { z } from 'zod';

/** Academics I (Phase 8): subjects & teachers, timetable & substitution, homework & class diary. */

export const SUBJECT_TYPES = ['THEORY', 'PRACTICAL', 'THEORY_PRACTICAL', 'ACTIVITY'] as const;
export const SUBJECT_GROUPS = ['CORE', 'ELECTIVE', 'LANGUAGE_1', 'LANGUAGE_2', 'LANGUAGE_3', 'OPEN_ELECTIVE'] as const;
export const ROOM_KINDS = ['CLASSROOM', 'LAB', 'HALL', 'LIBRARY', 'STAFF_ROOM'] as const;
export const TIMETABLE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const SUBMISSION_STATUSES = ['SUBMITTED', 'MARKED'] as const;

const isoDate = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

// ───────────── M8.1 Subjects & teachers ─────────────

export const subjectSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  nameLocal: optText(100),
  subjectType: z.enum(SUBJECT_TYPES),
  credits: z.coerce.number().min(0).max(40).optional().nullable(),
  isLanguage: z.boolean().default(false),
});
export type SubjectInput = z.infer<typeof subjectSchema>;
export const updateSubjectSchema = subjectSchema.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

/** The whole syllabus of one class (program level). */
export const syllabusSchema = z.object({
  programLevelId: z.string().uuid(),
  subjects: z.array(z.object({ subjectId: z.string().uuid(), subjectGroup: z.enum(SUBJECT_GROUPS), isOptional: z.boolean().default(false) })).max(40)
    .refine((v) => new Set(v.map((x) => x.subjectId)).size === v.length, 'A subject is listed twice'),
});
export type SyllabusInput = z.infer<typeof syllabusSchema>;

/** Class teacher and subject teachers of one section. */
export const sectionTeachersSchema = z.object({
  classTeacherId: z.string().uuid().optional().nullable(),
  subjects: z.array(z.object({ subjectId: z.string().uuid(), employeeIds: z.array(z.string().uuid()).max(5) })).max(40),
});
export type SectionTeachersInput = z.infer<typeof sectionTeachersSchema>;

/** A student's chosen optional subjects for their current class. */
export const electivesSchema = z.object({ subjectIds: z.array(z.string().uuid()).max(20) });
export type ElectivesInput = z.infer<typeof electivesSchema>;

// ───────────── M8.2 Timetable & substitution ─────────────

export const classRoomSchema = z.object({
  campusId: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  roomType: z.enum(ROOM_KINDS),
  capacity: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  building: optText(30),
  floor: optText(30),
});
export type ClassRoomInput = z.infer<typeof classRoomSchema>;

export const timetableEntrySchema = z.object({
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: z.number().int().min(1).max(7),
  periodId: z.string().uuid(),
  subjectId: z.string().uuid(),
  employeeId: z.string().uuid(),
  roomId: z.string().uuid().optional().nullable(),
});
/** Saves the draft timetable of a section (the whole week). */
export const saveTimetableSchema = z.object({
  sectionId: z.string().uuid(),
  effectiveFrom: isoDate,
  entries: z.array(timetableEntrySchema).max(120)
    .refine((v) => new Set(v.map((e) => `${e.dayOfWeek}-${e.periodId}`)).size === v.length, 'Two lessons in the same period'),
});
export type SaveTimetableInput = z.infer<typeof saveTimetableSchema>;

export const substitutionSchema = z.object({
  timetableEntryId: z.string().uuid(),
  date: isoDate,
  substituteEmployeeId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
});
export type SubstitutionInput = z.infer<typeof substitutionSchema>;

// ───────────── M8.3 Homework & class diary ─────────────

export const homeworkSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(3000).optional().nullable(),
  dueDate: isoDate,
  fileIds: z.array(z.string().uuid()).max(5).default([]),
  /** Students submit work in the app (otherwise it is read-only, e.g. "learn chapter 3"). */
  allowSubmission: z.boolean().default(true),
});
export type HomeworkInput = z.infer<typeof homeworkSchema>;

export const submissionSchema = z.object({
  text: z.string().trim().max(5000).optional().nullable(),
  fileId: z.string().uuid().optional().nullable(),
}).refine((v) => !!v.text || !!v.fileId, { message: 'Write the answer or attach a file', path: ['text'] });
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const markSubmissionSchema = z.object({
  grade: z.string().trim().min(1).max(10),
  feedback: z.string().trim().max(1000).optional().nullable(),
});
export type MarkSubmissionInput = z.infer<typeof markSubmissionSchema>;

export const diarySchema = z.object({
  sectionId: z.string().uuid(),
  /** One student only (otherwise the whole class). */
  studentId: z.string().uuid().optional().nullable(),
  noteDate: isoDate,
  note: z.string().trim().min(3).max(2000),
  /** Ask parents to acknowledge (they tap "Seen" in the app). */
  needsAck: z.boolean().default(true),
});
export type DiaryInput = z.infer<typeof diarySchema>;
