import { Injectable } from '@nestjs/common';
import {
  ATTENDED_VALUE, AttendanceStatus, PERMISSIONS, PermissionCode, PortalAttendance, PortalAttendanceDay, PortalLeaveInput, WeeklyOff, attendancePct, isWeeklyOff,
} from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuthContext } from '../../common/auth-context';
import { NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { FeeBillingService } from '../fees/billing.service';
import { FeeCollectionService } from '../fees/collection.service';
import { FeeOnlineService } from '../fees/online.service';
import { LeaveService } from '../leave/leave.service';
import { TransportRidersService } from '../transport/riders.service';
import { HostelAllotService } from '../hostel/allot.service';
import { HostelLifeService } from '../hostel/life.service';
import { MessService } from '../hostel/mess.service';
import { TimetableService } from '../academics/timetable.service';
import { HomeworkService } from '../academics/homework.service';
import { ResultsService } from '../exams/results.service';
import { MaterialsService } from '../academics/materials.service';
import { FilesService } from '../files/files.service';

const MARK: Record<AttendanceStatus, string> = { PRESENT: 'P', ABSENT: 'A', LATE: 'L', HALF_DAY: 'H', LEAVE: 'LV' };
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

/**
 * The child's day-to-day for parents and students (M5.2). Every request first checks the child is
 * one of the signed-in person's own (auth.portalStudentIds). Fees, receipts, payment links and leave
 * then run through the office's own code with a narrowed context — only the codes that call needs,
 * only on the child's campus — so a parent always sees exactly what the office sees, and nothing more.
 */
@Injectable()
export class PortalChildService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly billing: FeeBillingService,
    private readonly collection: FeeCollectionService,
    private readonly online: FeeOnlineService,
    private readonly leave: LeaveService,
    private readonly riders: TransportRidersService,
    private readonly hostelAllot: HostelAllotService,
    private readonly hostelLife: HostelLifeService,
    private readonly mess: MessService,
    private readonly timetable: TimetableService,
    private readonly homework: HomeworkService,
    private readonly results: ResultsService,
    private readonly materials: MaterialsService,
    private readonly files: FilesService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** The child, if it is one of this person's. */
  private async child(id: string, auth: AuthContext) {
    if (!(auth.portalStudentIds ?? []).includes(id)) throw NotFound('Student');
    const s = await this.db.run(this.ctx(auth), (tx) => tx.student.findUnique({ where: { id }, select: { id: true, campusId: true, admissionDate: true } }));
    if (!s) throw NotFound('Student');
    return s;
  }

  /** The office code's view, limited to this child's campus and the given read codes. Never used outside this service. */
  private narrowed(auth: AuthContext, campusId: string, codes: PermissionCode[]): AuthContext {
    return { ...auth, permissions: new Map(codes.map((c) => [c, { all: false as const, campusIds: [campusId] }])) };
  }

  // ───────────── Attendance ─────────────

  /** One month: the kind of each day, the mark, and totals by the attendance-report rule. */
  async attendance(id: string, month: string, auth: AuthContext): Promise<PortalAttendance> {
    const s = await this.child(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const first = `${month}-01`;
      const last = iso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
      const off = await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', s.campusId);
      const min = await this.settings.effective<number>(tx, 'attendance.min_percent', s.campusId);
      const hol = new Map((await tx.holiday.findMany({ where: { holidayDate: { gte: day(first), lte: day(last) }, OR: [{ campusId: null }, { campusId: s.campusId }] }, select: { holidayDate: true, name: true } })).map((h) => [iso(h.holidayDate), h.name]));
      const rows = await tx.$queryRaw<{ date: Date; status: AttendanceStatus; n: number }[]>`
        SELECT r.attendance_date AS date, r.status, count(*)::int AS n
          FROM attendance_records r JOIN attendance_sessions a ON a.id = r.session_id
         WHERE r.student_id = ${id}::uuid AND a.status <> 'DRAFT' AND r.attendance_date BETWEEN ${first}::date AND ${last}::date
         GROUP BY r.attendance_date, r.status`;
      const byDay = new Map<string, { status: AttendanceStatus; n: number }[]>();
      const t = { present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, marked: 0, attended: 0 };
      const key: Record<AttendanceStatus, keyof typeof t> = { PRESENT: 'present', LATE: 'late', HALF_DAY: 'halfDay', ABSENT: 'absent', LEAVE: 'leave' };
      for (const r of rows) {
        const k = iso(r.date);
        byDay.set(k, [...(byDay.get(k) ?? []), r]);
        t[key[r.status]] += r.n; t.marked += r.n; t.attended += ATTENDED_VALUE[r.status] * r.n;
      }
      const today = todayIST();
      const days: PortalAttendanceDay[] = [];
      for (let d = first; d <= last; d = iso(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000))) {
        const marks = byDay.get(d);
        let mark: string | null = null;
        if (marks) {
          const n = marks.reduce((a, m) => a + m.n, 0);
          mark = n === 1 ? MARK[marks[0].status] : `${marks.reduce((a, m) => a + ATTENDED_VALUE[m.status] * m.n, 0)}/${n}`;
        }
        days.push({ date: d, kind: d > today ? 'future' : hol.has(d) ? 'holiday' : isWeeklyOff(d, off) ? 'off' : 'working', holiday: hol.get(d) ?? null, mark });
      }
      return { month, days, totals: { ...t, pct: attendancePct(t.attended, t.marked) }, minPercent: min };
    });
  }

  // ───────────── Fees ─────────────

  /** Bills, receipts and what is still owed — the office's fee account, without office-only parts. */
  async fees(id: string, auth: AuthContext) {
    const s = await this.child(id, auth);
    const a = await this.billing.account(id, this.narrowed(auth, s.campusId, [PERMISSIONS.FEE_READ]));
    return {
      year: a.year,
      totals: a.totals,
      credit: a.credit.balance,
      invoices: a.invoices.filter((i) => i.status !== 'CANCELLED').map((i) => ({
        id: i.id, invoiceNo: i.invoiceNo, description: i.description, academicYear: i.yearLabel, isEarlier: i.isEarlier, dueDate: i.dueDate, status: i.status,
        net: i.netAmount, paid: i.paidAmount, balance: i.balanceAmount, fine: i.fineAmount, concession: i.concessionAmount,
        items: i.items.map((x) => ({ head: x.feeHead.name, amount: x.amount })),
      })),
      receipts: a.payments.map((p) => ({ id: p.id, receiptNo: p.receiptNo, paymentDate: p.paymentDate, amount: p.amount, paymentMode: p.paymentMode, status: p.status })),
      onlinePayment: this.online.gateway.mode !== 'off',
    };
  }

  /** A receipt of this child only (the same receipt the office prints). */
  async receipt(id: string, paymentId: string, auth: AuthContext) {
    const s = await this.child(id, auth);
    const r = await this.collection.receipt(paymentId, this.narrowed(auth, s.campusId, [PERMISSIONS.FEE_READ]));
    if (r.studentId !== id) throw NotFound('Receipt');
    const { cashierName: _c, createdBy: _b, ...rest } = r as typeof r & { createdBy?: unknown };
    return rest;
  }

  /** A one-day payment link for everything due; the parent is taken to the usual secure payment page. */
  async pay(id: string, auth: AuthContext, client: ClientInfo) {
    const s = await this.child(id, auth);
    const link = await this.online.createLink({ studentId: id, expiresInDays: 1, sendEmail: false }, this.narrowed(auth, s.campusId, [PERMISSIONS.FEE_COLLECT]), client);
    return { url: link.url, amount: link.amount };
  }

  // ───────────── Leave ─────────────

  /** Leave types with the days left, and every leave request of this child. */
  async leaveOverview(id: string, auth: AuthContext) {
    const s = await this.child(id, auth);
    const narrow = this.narrowed(auth, s.campusId, [PERMISSIONS.LEAVE_STUDENT, PERMISSIONS.LEAVE_READ]);
    const [balance, list] = await Promise.all([
      this.leave.balance('STUDENT', id, narrow),
      this.leave.list({ studentId: id, applicantType: 'STUDENT', page: 1, pageSize: 50 } as Parameters<LeaveService['list']>[0], narrow),
    ]);
    return {
      types: balance.types,
      year: balance.year,
      requests: list.items.map((r) => ({
        id: r.id, type: r.leaveType.name, fromDate: r.fromDate, toDate: r.toDate, halfDay: r.halfDay, days: r.days, reason: r.reason, status: r.status,
        decisionRemarks: r.decisionRemarks, appliedByMe: r.appliedBy === auth.userId,
        canCancel: r.appliedBy === auth.userId && (r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > todayIST())),
      })),
    };
  }

  /** Applies for the child's leave; it goes to the school's approvers like any other request. */
  async applyLeave(id: string, input: PortalLeaveInput, auth: AuthContext, client: ClientInfo) {
    const s = await this.child(id, auth);
    return this.leave.apply({ ...input, applicantType: 'STUDENT', studentId: id, employeeId: null }, this.narrowed(auth, s.campusId, [PERMISSIONS.LEAVE_STUDENT]), client);
  }

  /** Withdraws leave this person applied for (waiting, or approved and not started). */
  async cancelLeave(id: string, requestId: string, auth: AuthContext, client: ClientInfo) {
    await this.child(id, auth);
    const r = await this.db.run(this.ctx(auth), (tx) => tx.leaveRequest.findUnique({ where: { id: requestId }, select: { studentId: true, appliedBy: true } }));
    if (!r || r.studentId !== id || r.appliedBy !== auth.userId) throw NotFound('Leave request');
    return this.leave.cancel(requestId, { ...auth, permissions: new Map() }, client);
  }

  // ───────────── Bus (Phase 6) ─────────────

  /** The child's bus this year (route, stop, timings, vehicle, driver) and earlier ones. Live location: coming soon. */
  async transport(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = (await this.riders.forStudent(tx, id)).map((x) => ({ ...x, startDate: iso(x.startDate), endDate: x.endDate ? iso(x.endDate) : null }));
      return { current: rows.find((r) => r.status === 'ACTIVE') ?? null, history: rows.filter((r) => r.status !== 'ACTIVE'), liveTracking: false };
    });
  }

  // ───────────── Hostel (Phase 7) ─────────────

  /** The child's hostel stay (room, warden, items), last 7 nights, outpasses, home-goings, mess plan and today's menu. */
  async hostel(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.hostelAllot.historyTx(tx, id);
      const stay = h.stays.find((x) => x.status === 'CHECKED_IN' || x.status === 'RESERVED') ?? null;
      const life = await this.hostelLife.forParent(tx, id);
      const mess = await this.mess.forStudentTx(tx, id);
      return { stay: stay ? { ...stay, items: undefined, damages: undefined } : null, deposit: h.deposit, ...life, mess, smsAlerts: false };
    });
  }

  /** A parent approves or refuses their child's outpass. */
  async decideOutpass(id: string, outpassId: string, input: { approve: boolean; remarks?: string | null }, auth: AuthContext) {
    await this.child(id, auth);
    const o = await this.db.run(this.ctx(auth), (tx) => tx.hostelOutpass.findUnique({ where: { id: outpassId }, select: { studentId: true } }));
    if (!o || o.studentId !== id) throw NotFound('Outpass');
    return this.hostelLife.parentDecide(outpassId, input, auth);
  }

  // ───────────── Academics (Phase 8) ─────────────

  /** The child's section week (published) with substitutions in the coming days. */
  async timetableOf(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId: id, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true } }));
      return { timetable: e ? await this.timetable.forSectionTx(tx, e.sectionId) : null };
    });
  }

  async homeworkOf(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), async (tx) => ({ ...(await this.homework.forStudentTx(tx, id)), diary: (await this.homework.diaryForStudentTx(tx, id)).items }));
  }

  async submitHomework(id: string, homeworkId: string, input: { text?: string | null; fileId?: string | null }, auth: AuthContext) {
    await this.child(id, auth);
    return this.homework.submit(id, homeworkId, input, auth);
  }

  async acknowledgeDiary(id: string, noteId: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.homework.acknowledge(id, noteId, auth);
  }

  // ───────────── Results (Phase 9) ─────────────

  /** The child's published results (latest version per term). */
  async resultsOf(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), (tx) => this.results.forStudentTx(tx, id));
  }

  /** One published report card of the child. */
  async reportCard(id: string, resultId: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), (tx) => this.results.cardForStudentTx(tx, id, resultId));
  }

  // ───────────── Study material (Phase 10) ─────────────

  async materialsOf(id: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), (tx) => this.materials.forStudentTx(tx, id));
  }

  /** Opening an item counts it as seen by the child. */
  async openMaterial(id: string, materialId: string, auth: AuthContext) {
    await this.child(id, auth);
    return this.db.run(this.ctx(auth), (tx) => this.materials.openForStudentTx(tx, id, materialId));
  }

  /** The item's file — only after the same check (published, the child's class). */
  async materialFile(id: string, materialId: string, auth: AuthContext) {
    const m = await this.openMaterial(id, materialId, auth);
    if (!m.fileId) throw NotFound('File');
    return this.files.openChecked(m.fileId, auth);
  }
}