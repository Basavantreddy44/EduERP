import { z } from 'zod';

/** Home dashboard (M4.1): one campus, or every campus the user can see. */
export const dashboardQuerySchema = z.object({ campusId: z.string().uuid().optional() });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface DashboardCampus { id: string; code: string; name: string }

/** A class whose sheet for today is not submitted yet (status null = not started, DRAFT = saved, not submitted). */
export interface DashboardOpenSheet { sectionId: string; campusId: string; programName: string; className: string; sectionName: string; students: number; status: 'DRAFT' | null; periodId: string | null }

export interface DashboardSummary {
  date: string;
  campusId: string | null;
  campuses: DashboardCampus[];
  /** Campuses closed today (weekly holiday / holiday), with the reason. */
  closed: Record<string, string>;
  attendance?: {
    sections: number; submitted: number; draft: number; notTaken: number;
    students: number; present: number; absent: number; leave: number;
    /** Present (late and half day included) ÷ students marked, one decimal; null when nothing is marked. */
    presentPct: number | null;
    open: DashboardOpenSheet[];
  };
  staff?: { staff: number; present: number; absent: number; onLeave: number; notMarked: number; notMarkedCampuses: string[] };
  fees?: {
    /** Money as exact decimal strings, e.g. "1250.00" (as in the fee reports). */
    today: { amount: string; receipts: number };
    month: { from: string; to: string; amount: string; receipts: number; byMode: { key: string; amount: string; count: number }[] };
    outstanding: { students: number; balance: string; overdue: string; overdueStudents: number };
  };
  admissions?: {
    enquiries?: { open: number; byStatus: Record<string, number>; dueToday: number; overdue: number };
    applications?: { year: string | null; byStatus: Record<string, number>; pending: number; enrolled: number };
  };
  approvals: { waiting: number; items: { id: string; entityType: string; summary: string | null; requesterName: string; createdAt: string }[] };
}

/** Trends (M4.3): the last 30 days of fee collection and 4 weeks of student attendance. */
export const TREND_COLLECTION_DAYS = 30;
export const TREND_ATTENDANCE_DAYS = 28;

export interface DashboardTrends {
  from: string;
  to: string;
  /** Every day, oldest first; days with no receipts are zero (the collection report's days). */
  collection?: { date: string; amount: string; receipts: number }[];
  /**
   * Days a campus in view was open, oldest first (weekly holidays and holidays left out). pct is the
   * student-percentage report's overall figure for that one day; null when nothing was marked.
   */
  attendance?: { date: string; pct: number | null; attended: number; marked: number }[];
}
