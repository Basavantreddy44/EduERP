import { z } from 'zod';

/**
 * Parent & student app (M5.1). A parent or student signs in like everyone else; what they can see
 * comes only from their links (guardian ↔ student, student ↔ login), never from staff roles.
 */

/** Student statuses whose families keep access to the app. Leaving (TC), dropping out or passing out ends it. */
export const PORTAL_STUDENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/** Office: give a guardian or the student a login. The email defaults to the guardian's email on file. */
export const portalInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(150).optional(),
});
export type PortalInviteInput = z.infer<typeof portalInviteSchema>;

/** One person's login status on a student's profile. */
export interface PortalAccessRow {
  kind: 'GUARDIAN' | 'STUDENT';
  /** Guardian id, or the student id for the student's own login. */
  id: string;
  name: string;
  relation: string | null;
  email: string | null;
  /** NONE = no login; INVITED = login made, password not set yet; ACTIVE = can sign in. */
  login: 'NONE' | 'INVITED' | 'ACTIVE';
}

export interface PortalChild {
  id: string;
  name: string;
  admissionNo: string;
  campusName: string;
  className: string | null;
  sectionName: string | null;
  /** How the signed-in person is linked: a guardian relation (FATHER, MOTHER…) or SELF. */
  relation: string;
}

export interface PortalMe {
  /** true when the person has at least one child (or themself) in this institution's app. */
  hasPortal: boolean;
  children: PortalChild[];
}

// ───────────── M5.2: the child's day-to-day ─────────────

export const portalMonthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });
export type PortalMonthQuery = z.infer<typeof portalMonthSchema>;

/** A parent applies for their child's leave (same rules as the office form). */
export const portalLeaveSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    fromDate: z.string().date(),
    toDate: z.string().date(),
    halfDay: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'The last day is before the first day', path: ['toDate'] })
  .refine((v) => !v.halfDay || v.toDate === v.fromDate, { message: 'A half day is one day only', path: ['halfDay'] })
  .refine((v) => Date.parse(v.toDate) - Date.parse(v.fromDate) <= 366 * 86_400_000, { message: 'At most one year at a time', path: ['toDate'] });
export type PortalLeaveInput = z.infer<typeof portalLeaveSchema>;

/** One day of the child's month: what kind of day it was and the mark (P / A / L / H / LV, or "3/5" periods). */
export interface PortalAttendanceDay { date: string; kind: 'working' | 'off' | 'holiday' | 'future'; holiday: string | null; mark: string | null }
export interface PortalAttendance {
  month: string;
  days: PortalAttendanceDay[];
  totals: { present: number; late: number; halfDay: number; absent: number; leave: number; marked: number; attended: number; pct: number | null };
  /** The school's minimum (setting attendance.min_percent). */
  minPercent: number;
}
