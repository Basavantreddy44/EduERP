import { z } from 'zod';

/** Engagement I (Phase 11): news feed, events & calendar, parent-teacher meetings. */

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 250 or 250.50');

/** Who something is for. ALL = everyone in the institution. */
export const TARGET_TYPES = ['ALL', 'CAMPUS', 'LEVEL', 'SECTION'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
const targets = z.array(z.object({ targetType: z.enum(TARGET_TYPES), targetId: z.string().uuid().optional().nullable() }))
  .min(1, 'Choose who it is for').max(30)
  .refine((v) => v.every((t) => (t.targetType === 'ALL') === !t.targetId), 'Each audience needs a campus, class or section (except "everyone")');

// ───────────── M11.1 News feed ─────────────

export const POST_TYPES = ['NEWS', 'CIRCULAR', 'ACHIEVEMENT', 'EVENT', 'GALLERY'] as const;
export const REACTIONS = ['LIKE', 'LOVE', 'CLAP', 'CELEBRATE'] as const;
export const REPORT_REASONS = ['SPAM', 'ABUSIVE', 'INAPPROPRIATE', 'PRIVACY', 'OTHER'] as const;

export const postSchema = z.object({
  postType: z.enum(POST_TYPES),
  title: optText(200),
  body: z.string().trim().min(2).max(5000),
  fileIds: z.array(z.string().uuid()).max(10).default([]),
  allowComments: z.boolean().default(true),
  targets,
  eventId: z.string().uuid().optional().nullable(),
});
export type PostInput = z.infer<typeof postSchema>;
export const commentSchema = z.object({ comment: z.string().trim().min(1).max(1000), parentCommentId: z.string().uuid().optional().nullable() });
export const reactionSchema = z.object({ reaction: z.enum(REACTIONS).nullable() });
export const reportSchema = z.object({ postId: z.string().uuid().optional().nullable(), commentId: z.string().uuid().optional().nullable(), reason: z.enum(REPORT_REASONS), details: optText(500) })
  .refine((v) => !!v.postId !== !!v.commentId, 'Report a post or a comment');
export type ReportInput = z.infer<typeof reportSchema>;

// ───────────── M11.2 Events ─────────────

export const EVENT_TYPES = ['CULTURAL', 'SPORTS', 'ACADEMIC', 'TRIP', 'CELEBRATION', 'WORKSHOP', 'OTHER'] as const;
export const eventSchema = z.object({
  campusId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3).max(200),
  description: optText(5000),
  eventType: z.enum(EVENT_TYPES),
  startDate: z.string().date(),
  endDate: z.string().date(),
  startTime: time.optional().nullable(),
  endTime: time.optional().nullable(),
  venue: optText(200),
  organiserEmployeeId: z.string().uuid().optional().nullable(),
  registrationRequired: z.boolean().default(false),
  maxParticipants: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  requiresConsent: z.boolean().default(false),
  feeHeadId: z.string().uuid().optional().nullable(),
  feeAmount: money.optional().nullable(),
  targets,
  publish: z.boolean().default(true),
}).refine((v) => v.endDate >= v.startDate, { message: 'Ends before it starts', path: ['endDate'] })
  .refine((v) => !v.startTime || !v.endTime || v.startDate !== v.endDate || v.endTime > v.startTime, { message: 'Ends before it starts', path: ['endTime'] })
  .refine((v) => !v.feeAmount || !!v.feeHeadId, { message: 'Choose the fee head for the charge', path: ['feeHeadId'] })
  .refine((v) => !v.feeAmount || v.registrationRequired || v.requiresConsent, { message: 'A paid event needs registration or consent', path: ['feeAmount'] });
export type EventInput = z.infer<typeof eventSchema>;
/** A parent's (or staff member's) answer for one student. */
export const eventResponseSchema = z.object({ going: z.boolean() });

// ───────────── M11.3 Parent-teacher meetings ─────────────

export const PTM_MODES = ['IN_PERSON', 'ONLINE', 'BOTH'] as const;
export const ptmSchema = z.object({
  campusId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  ptmDate: z.string().date(),
  startTime: time,
  endTime: time,
  slotMinutes: z.coerce.number().int().min(5).max(60),
  mode: z.enum(PTM_MODES).default('IN_PERSON'),
  bookingOpens: z.string().datetime({ offset: true }),
  bookingCloses: z.string().datetime({ offset: true }),
  programLevelIds: z.array(z.string().uuid()).min(1, 'Choose the classes').max(40),
}).refine((v) => v.endTime > v.startTime, { message: 'Ends before it starts', path: ['endTime'] })
  .refine((v) => v.bookingCloses > v.bookingOpens, { message: 'Booking closes before it opens', path: ['bookingCloses'] });
export type PtmInput = z.infer<typeof ptmSchema>;
export const ptmBookSchema = z.object({ slotId: z.string().uuid() });
export const ptmOutcomeSchema = z.object({ status: z.enum(['ATTENDED', 'NO_SHOW']), notes: optText(2000) });
export const ptmFeedbackSchema = z.object({ feedback: z.string().trim().min(2).max(500) });

/** The slot start times of a PTM day (HH:MM). */
export function ptmSlotTimes(start: string, end: string, minutes: number): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let m = toMin(start); m + minutes <= toMin(end); m += minutes) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
}
export const addMinutes = (t: string, minutes: number) => { const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + minutes; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
