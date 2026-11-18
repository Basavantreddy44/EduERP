import { Injectable } from '@nestjs/common';
import {
  APPLICATION_STATUSES, ATTENDED_VALUE, AttendanceMode, AttendanceStatus, CORE_MODULES, DashboardOpenSheet, DashboardQuery, DashboardSummary, DashboardTrends,
  PERMISSIONS, TREND_ATTENDANCE_DAYS, TREND_COLLECTION_DAYS, WeeklyOff, attendancePct, duesQuerySchema, isWeeklyOff, toPaise,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import { SettingsService } from '../settings/settings.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AttendanceService, closedReason } from '../attendance/attendance.service';
import { StaffAttendanceService } from '../leave/staff-attendance.service';
import { FeeDuesService } from '../fees/dues.service';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const OPEN_ENQUIRY = { notIn: ['CONVERTED', 'LOST'] };
const PENDING_APPLICATION = ['SUBMITTED', 'UNDER_REVIEW'];
const STAFF_PRESENT = new Set(['PRESENT', 'ON_DUTY', 'HALF_DAY']);
const OPEN_LIST_MAX = 20;

/**
 * Home dashboard (M4.1). Every figure comes from the same code as the report behind it (attendance
 * day view, staff sheet, collection report, dues list), so the two can never disagree. A block is
 * left out when the user may not open that report or the module is not on the plan.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly attendance: AttendanceService,
    private readonly staffAttendance: StaffAttendanceService,
    private readonly dues: FeeDuesService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  async summary(q: DashboardQuery, auth: AuthContext): Promise<DashboardSummary> {
    const date = todayIST();
    const { modules, campuses } = await this.db.run(this.ctx(auth), async (tx) => ({
      modules: new Set([...CORE_MODULES, ...(await tx.tenantModule.findMany({ where: { isEnabled: true }, select: { moduleCode: true } })).map((m) => m.moduleCode)]),
      campuses: await tx.campus.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
    }));
    const scopes = {
      attendance: modules.has('ATTENDANCE') ? scopeFor(auth, PERMISSIONS.ATT_READ) ?? scopeFor(auth, PERMISSIONS.ATT_MARK) : null,
      staff: modules.has('ATTENDANCE') ? scopeFor(auth, PERMISSIONS.STAFF_ATT_MARK) : null,
      fees: modules.has('FEES') ? scopeFor(auth, PERMISSIONS.FEE_READ) : null,
      enquiries: modules.has('ADMISSIONS') ? scopeFor(auth, PERMISSIONS.ADM_ENQUIRY_MANAGE) : null,
      applications: modules.has('ADMISSIONS') ? scopeFor(auth, PERMISSIONS.ADM_APPLICATION_MANAGE) : null,
    };
    const any = Object.values(scopes).filter((s): s is CampusScope => !!s);
    const visible = campuses.filter((c) => any.some((s) => canAccessCampus(s, c.id)));
    if (q.campusId && !visible.some((c) => c.id === q.campusId)) throw NotFound('Campus');
    /** Campuses of one block: the chosen one (if the block covers it) or all it covers. */
    const of = (s: CampusScope | null) => (s ? visible.filter((c) => (q.campusId ? c.id === q.campusId : true) && canAccessCampus(s, c.id)).map((c) => c.id) : []);

    const [attendance, staff, fees, admissions, approvals, closed] = await Promise.all([
      scopes.attendance && of(scopes.attendance).length ? this.attendanceBlock(of(scopes.attendance), date, auth) : undefined,
      scopes.staff && of(scopes.staff).length ? this.staffBlock(of(scopes.staff), date, auth) : undefined,
      scopes.fees && of(scopes.fees).length ? this.feesBlock(q.campusId, date, auth) : undefined,
      this.admissionsBlock(q.campusId, of(scopes.enquiries).length ? scopes.enquiries : null, of(scopes.applications).length ? scopes.applications : null, date, auth),
      this.approvals.inbox(auth) as Promise<{ id: string; entityType: string; summary: string | null; requesterName: string; createdAt: Date }[]>,
      this.closedToday(q.campusId ? [q.campusId] : visible.map((c) => c.id), date, auth),
    ]);
    return {
      date,
      campusId: q.campusId ?? null,
      campuses: visible,
      closed,
      ...(attendance ? { attendance } : {}),
      ...(staff ? { staff } : {}),
      ...(fees ? { fees } : {}),
      ...(admissions ? { admissions } : {}),
      approvals: {
        waiting: approvals.length,
        items: approvals.slice(0, 5).map((a) => ({ id: a.id, entityType: a.entityType, summary: a.summary, requesterName: a.requesterName, createdAt: new Date(a.createdAt).toISOString() })),
      },
    };
  }

  private closedToday(campusIds: string[], date: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx: Tx) => {
      const out: Record<string, string> = {};
      for (const id of campusIds) {
        const why = await closedReason(tx, this.settings, id, date);
        if (why) out[id] = why.detail;
      }
      return out;
    });
  }

  /** Today's student attendance — the attendance day view per campus (period-wise campuses: the first period). */
  private async attendanceBlock(campusIds: string[], date: string, auth: AuthContext): Promise<NonNullable<DashboardSummary['attendance']>> {
    const firstPeriod = await this.db.run(this.ctx(auth), async (tx) => {
      const m = new Map<string, string | undefined>();
      for (const id of campusIds) {
        const mode = await this.settings.effective<AttendanceMode>(tx, 'attendance.mode', id);
        m.set(id, mode === 'PERIOD' ? (await tx.period.findFirst({ where: { campusId: id, status: 'ACTIVE', isBreak: false }, orderBy: { sequence: 'asc' }, select: { id: true } }))?.id : undefined);
      }
      return m;
    });
    const t = { sections: 0, submitted: 0, draft: 0, notTaken: 0, students: 0, present: 0, absent: 0, leave: 0 };
    const open: DashboardOpenSheet[] = [];
    for (const id of campusIds) {
      const d = await this.attendance.day({ date, campusId: id, periodId: firstPeriod.get(id) }, auth);
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += (d.totals as Record<string, number>)[k] ?? 0;
      for (const s of d.sections) {
        if (s.students > 0 && s.status !== 'SUBMITTED' && s.status !== 'LOCKED') {
          open.push({ sectionId: s.sectionId, campusId: s.campusId, programName: s.programName, className: s.className, sectionName: s.sectionName, students: s.students, status: s.status === 'DRAFT' ? 'DRAFT' : null, periodId: firstPeriod.get(id) ?? null });
        }
      }
    }
    return { ...t, presentPct: pct(t.present, t.present + t.absent + t.leave), open: open.slice(0, OPEN_LIST_MAX) };
  }

  /** Today's staff attendance — the staff sheet per campus. Approved leave counts as on leave even before the office saves the day. */
  private async staffBlock(campusIds: string[], date: string, auth: AuthContext): Promise<NonNullable<DashboardSummary['staff']>> {
    const t = { staff: 0, present: 0, absent: 0, onLeave: 0, notMarked: 0, notMarkedCampuses: [] as string[] };
    for (const id of campusIds) {
      const sheet = await this.staffAttendance.sheet(id, date, auth);
      let missing = 0;
      for (const s of sheet.staff) {
        t.staff += 1;
        if (s.status && STAFF_PRESENT.has(s.status)) t.present += 1;
        else if (s.status === 'ABSENT') t.absent += 1;
        else if (s.status === 'LEAVE' || (!s.status && s.onLeave)) t.onLeave += 1;
        else missing += 1;
      }
      t.notMarked += missing;
      if (missing) t.notMarkedCampuses.push(id);
    }
    return t;
  }

  /** Money: today and this month (the collection report), and what is still owed (the dues list). */
  private async feesBlock(campusId: string | undefined, date: string, auth: AuthContext): Promise<NonNullable<DashboardSummary['fees']>> {
    const from = `${date.slice(0, 8)}01`;
    const [month, all, overdue] = await Promise.all([
      this.dues.collection({ from, to: date, campusId }, auth),
      this.dues.dues(auth, duesQuerySchema.parse({ campusId, pageSize: 1 })),
      this.dues.dues(auth, duesQuerySchema.parse({ campusId, pageSize: 1, minDaysOverdue: 1 })),
    ]);
    const today = month.byDay.find((d) => d.key === date);
    return {
      today: { amount: today?.amount ?? '0.00', receipts: today?.count ?? 0 },
      month: { from, to: date, amount: month.total, receipts: month.receipts, byMode: month.byMode.sort((a, b) => toPaise(b.amount) - toPaise(a.amount)) },
      outstanding: { students: all.totals.students, balance: all.totals.balance, overdue: all.totals.overdue, overdueStudents: overdue.totals.students },
    };
  }

  /** Enquiries (open, follow-ups due) and this year's applications by stage — the same filters as the admissions lists. */
  private async admissionsBlock(campusId: string | undefined, enq: CampusScope | null, app: CampusScope | null, date: string, auth: AuthContext): Promise<DashboardSummary['admissions']> {
    if (!enq && !app) return undefined;
    const where = (s: CampusScope) => (campusId ? (canAccessCampus(s, campusId) ? { campusId } : null) : s.all ? {} : { campusId: { in: s.campusIds } });
    return this.db.run(this.ctx(auth), async (tx) => {
      const out: NonNullable<DashboardSummary['admissions']> = {};
      const ew = enq && where(enq);
      if (ew) {
        const counts = await tx.enquiry.groupBy({ by: ['status'], where: ew, _count: true });
        const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
        out.enquiries = {
          byStatus,
          open: counts.filter((c) => !OPEN_ENQUIRY.notIn.includes(c.status)).reduce((a, c) => a + c._count, 0),
          dueToday: await tx.enquiry.count({ where: { ...ew, nextFollowUp: day(date), status: OPEN_ENQUIRY } }),
          overdue: await tx.enquiry.count({ where: { ...ew, nextFollowUp: { lt: day(date) }, status: OPEN_ENQUIRY } }),
        };
      }
      const aw = app && where(app);
      if (aw) {
        const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
        const counts = year ? await tx.admissionApplication.groupBy({ by: ['status'], where: { ...aw, academicYearId: year.id }, _count: true }) : [];
        const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?._count ?? 0]));
        out.applications = {
          year: year?.name ?? null,
          byStatus,
          pending: PENDING_APPLICATION.reduce((a, s) => a + (byStatus[s] ?? 0), 0),
          enrolled: byStatus.ENROLLED ?? 0,
        };
      }
      return Object.keys(out).length ? out : undefined;
    });
  }

  // ───────────── Trends (M4.3) ─────────────

  /**
   * Fee collection per day for the last 30 days (the collection report) and student attendance % per
   * open day for the last 4 weeks (the student-percentage report's rule, one day at a time).
   */
  async trends(q: DashboardQuery, auth: AuthContext): Promise<DashboardTrends> {
    const to = todayIST();
    const { modules, campuses } = await this.db.run(this.ctx(auth), async (tx) => ({
      modules: new Set([...CORE_MODULES, ...(await tx.tenantModule.findMany({ where: { isEnabled: true }, select: { moduleCode: true } })).map((m) => m.moduleCode)]),
      campuses: (await tx.campus.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((c) => c.id),
    }));
    const feeScope = modules.has('FEES') ? scopeFor(auth, PERMISSIONS.FEE_READ) : null;
    const attScope = modules.has('ATTENDANCE') ? scopeFor(auth, PERMISSIONS.ATT_READ) : null;
    const inView = (s: CampusScope | null) => (s ? campuses.filter((c) => (q.campusId ? c === q.campusId : true) && canAccessCampus(s, c)) : []);
    if (q.campusId && !inView(feeScope).length && !inView(attScope).length) throw NotFound('Campus');
    const out: DashboardTrends = { from: shiftDay(to, -(TREND_COLLECTION_DAYS - 1)), to };

    if (inView(feeScope).length) {
      const r = await this.dues.collection({ from: out.from, to, campusId: q.campusId }, auth);
      const byDay = new Map(r.byDay.map((d) => [d.key, d]));
      out.collection = daysBetween(out.from, to).map((date) => ({ date, amount: byDay.get(date)?.amount ?? '0.00', receipts: byDay.get(date)?.count ?? 0 }));
    }

    const attCampuses = inView(attScope);
    if (attCampuses.length) {
      const from = shiftDay(to, -(TREND_ATTENDANCE_DAYS - 1));
      out.attendance = await this.db.run(this.ctx(auth), async (tx) => {
        const off = new Map<string, WeeklyOff>();
        for (const c of attCampuses) off.set(c, await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', c));
        const holidays = await tx.holiday.findMany({ where: { holidayDate: { gte: day(from), lte: day(to) }, OR: [{ campusId: null }, { campusId: { in: attCampuses } }] }, select: { holidayDate: true, campusId: true } });
        const closed = (date: string, c: string) => isWeeklyOff(date, off.get(c)!) || holidays.some((h) => h.holidayDate.toISOString().slice(0, 10) === date && (h.campusId === null || h.campusId === c));
        const rows = await tx.$queryRaw<{ date: Date; status: AttendanceStatus; n: number }[]>`
          SELECT r.attendance_date AS date, r.status, count(*)::int AS n
            FROM attendance_records r JOIN attendance_sessions a ON a.id = r.session_id
           WHERE a.status <> 'DRAFT' AND r.attendance_date BETWEEN ${from}::date AND ${to}::date
             AND a.campus_id = ANY(${attCampuses}::uuid[])
           GROUP BY r.attendance_date, r.status`;
        const tally = new Map<string, { attended: number; marked: number }>();
        for (const r of rows) {
          const k = r.date.toISOString().slice(0, 10);
          const t = tally.get(k) ?? { attended: 0, marked: 0 };
          t.marked += r.n; t.attended += ATTENDED_VALUE[r.status] * r.n;
          tally.set(k, t);
        }
        return daysBetween(from, to)
          .filter((date) => tally.has(date) || attCampuses.some((c) => !closed(date, c)))
          .map((date) => {
            const t = tally.get(date) ?? { attended: 0, marked: 0 };
            return { date, attended: t.attended, marked: t.marked, pct: attendancePct(t.attended, t.marked) };
          });
      });
    }
    return out;
  }
}

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
