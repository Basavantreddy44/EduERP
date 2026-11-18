import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AttendanceMode, DayOverviewQuery, PERMISSIONS, SaveSheetInput, SavePeriodsInput, SheetQuery, WeeklyOff, isWeeklyOff,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertResult, alertAbsentees } from './absent-alerts';
import { onLeave } from '../leave/leave.service';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const unprocessable = (code: string, detail: string, errors?: { field: string; message: string }[]) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, errors);

export interface RosterStudent { id: string; firstName: string; lastName: string | null; admissionNo: string; rollNo: string | null; gender: string }

/**
 * Students on a section's sheet for a day: their place in the section covers the date (a student
 * who moved section that day is on the new section's sheet), and they are not on a long break.
 */
export async function rosterOf(tx: Tx, sectionId: string, date: string): Promise<RosterStudent[]> {
  return tx.$queryRaw<RosterStudent[]>`
    SELECT s.id, s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", e.roll_no AS "rollNo", s.gender
      FROM student_enrollments e
      JOIN students s ON s.id = e.student_id
     WHERE e.section_id = ${sectionId}::uuid
       AND e.status <> 'CANCELLED'
       AND e.enrolled_on <= ${date}::date
       AND (e.ended_on IS NULL OR e.ended_on > ${date}::date OR (e.ended_on = ${date}::date AND e.status <> 'MOVED'))
       AND s.status <> 'INACTIVE'
     ORDER BY NULLIF(regexp_replace(e.roll_no, '\\D', '', 'g'), '')::int NULLS LAST, s.first_name, s.last_name`;
}

/** Why attendance cannot be taken on a day (null = it can). */
export async function closedReason(tx: Tx, settings: SettingsService, campusId: string, date: string): Promise<{ code: string; detail: string } | null> {
  if (date > todayIST()) return { code: 'date-in-future', detail: 'Attendance cannot be taken for a future date' };
  const off = await settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', campusId);
  if (isWeeklyOff(date, off)) return { code: 'weekly-off', detail: 'This day is a weekly holiday' };
  const h = await tx.holiday.findFirst({ where: { holidayDate: day(date), OR: [{ campusId: null }, { campusId }] }, select: { name: true } });
  if (h) return { code: 'holiday', detail: `Holiday: ${h.name}` };
  return null;
}

/**
 * Student attendance (M3.2): bell timings per campus, the class sheet (everyone present unless
 * marked otherwise; save as draft or submit — submitted sheets are locked by the database), and the
 * day overview of which sections have been marked.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  // ───────────── Bell timings ─────────────

  periods(campusId: string, auth: AuthContext) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.ATT_READ) ?? scopeFor(auth, PERMISSIONS.ATT_SETUP)!, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), (tx) => tx.period.findMany({ where: { campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, sequence: true, isBreak: true } }));
  }

  /** Replaces a campus's bell timings. Periods are matched by name (so marks taken in them stay linked); missing ones are retired. */
  savePeriods(input: SavePeriodsInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.ATT_SETUP)!, input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      const before = await tx.period.findMany({ where: { campusId: input.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
      const byName = new Map(before.map((p) => [p.name.toLowerCase(), p]));
      // Retire first, so a re-used name never clashes with the one-active-name rule.
      const wanted = new Set(input.periods.map((p) => p.name.toLowerCase()));
      for (const p of before) if (!wanted.has(p.name.toLowerCase())) await tx.period.update({ where: { id: p.id }, data: { status: 'INACTIVE', updatedBy: auth.userId } });
      for (const [i, p] of input.periods.entries()) {
        const ex = byName.get(p.name.toLowerCase());
        const data = { name: p.name, startTime: p.startTime, endTime: p.endTime, isBreak: p.isBreak, sequence: i + 1 };
        if (ex) { await tx.period.update({ where: { id: ex.id }, data: { ...data, updatedBy: auth.userId } }); }
        else await tx.period.create({ data: { ...data, tenantId: auth.tenantId!, campusId: input.campusId, createdBy: auth.userId } });
      }
      const after = await tx.period.findMany({ where: { campusId: input.campusId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, sequence: true, isBreak: true } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: input.campusId, action: 'UPDATE', entityType: 'BELL_TIMINGS', entityId: input.campusId, oldValues: before.map((p) => `${p.name} ${p.startTime}-${p.endTime}`), newValues: after.map((p) => `${p.name} ${p.startTime}-${p.endTime}`) }, client);
      return after;
    });
  }

  // ───────────── Options ─────────────

  /** Campuses (with mode and weekly holidays), current-year sections and periods the user can mark. */
  options(auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ) ?? scopeFor(auth, PERMISSIONS.ATT_MARK)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true, startDate: true, endDate: true } });
      const campuses = await tx.campus.findMany({ where: { status: 'ACTIVE', ...(scope.all ? {} : { id: { in: scope.campusIds } }) }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } });
      const withMode = [];
      for (const c of campuses) {
        withMode.push({
          ...c,
          mode: await this.settings.effective<AttendanceMode>(tx, 'attendance.mode', c.id),
          weeklyOff: await this.settings.effective<WeeklyOff>(tx, 'attendance.weekly_off', c.id),
          periods: await tx.period.findMany({ where: { campusId: c.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, startTime: true, endTime: true, isBreak: true } }),
        });
      }
      const sections = year
        ? await tx.section.findMany({
            where: { academicYearId: year.id, status: 'ACTIVE', campusId: { in: campuses.map((c) => c.id) } },
            orderBy: [{ level: { program: { name: 'asc' } } }, { level: { sequence: 'asc' } }, { name: 'asc' }],
            select: { id: true, name: true, campusId: true, level: { select: { id: true, name: true, program: { select: { name: true } } } } },
          })
        : [];
      return { year: year ? { ...year, startDate: iso(year.startDate), endDate: iso(year.endDate) } : null, campuses: withMode, sections, today: todayIST() };
    });
  }

  // ───────────── Sheet ─────────────

  private async sectionFor(tx: Tx, sectionId: string, scope: CampusScope) {
    const s = await tx.section.findUnique({
      where: { id: sectionId },
      select: { id: true, name: true, campusId: true, academicYear: { select: { name: true, startDate: true, endDate: true } }, level: { select: { name: true, program: { select: { name: true } } } } },
    });
    if (!s || !canAccessCampus(scope, s.campusId)) throw NotFound('Section');
    return s;
  }

  private async periodFor(tx: Tx, campusId: string, mode: AttendanceMode, periodId: string | null | undefined) {
    if (mode === 'DAILY') {
      if (periodId) throw unprocessable('daily-attendance', 'This campus takes attendance once a day — no period is needed', [{ field: 'periodId', message: 'Not used for daily attendance' }]);
      return null;
    }
    if (!periodId) throw unprocessable('period-required', 'This campus takes attendance period-wise — choose a period', [{ field: 'periodId', message: 'Choose a period' }]);
    const p = await tx.period.findUnique({ where: { id: periodId }, select: { id: true, name: true, startTime: true, endTime: true, campusId: true, isBreak: true, status: true } });
    if (!p || p.campusId !== campusId || p.status !== 'ACTIVE') throw unprocessable('period-not-found', 'This period is not part of the campus bell timings', [{ field: 'periodId', message: 'Not a period of this campus' }]);
    if (p.isBreak) throw unprocessable('period-is-break', `${p.name} is a break`, [{ field: 'periodId', message: 'Breaks have no attendance' }]);
    return p;
  }

  private findSession(tx: Tx, sectionId: string, date: string, periodId: string | null) {
    return tx.attendanceSession.findFirst({ where: { sectionId, attendanceDate: day(date), periodId } });
  }

  /** The sheet for a section on a day (and period): who is on it, their marks so far, and whether it can be taken. */
  sheet(q: SheetQuery, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ) ?? scopeFor(auth, PERMISSIONS.ATT_MARK)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.sectionFor(tx, q.sectionId, scope);
      const mode = await this.settings.effective<AttendanceMode>(tx, 'attendance.mode', s.campusId);
      const period = await this.periodFor(tx, s.campusId, mode, q.periodId);
      let closed = await closedReason(tx, this.settings, s.campusId, q.date);
      if (!closed && (q.date < iso(s.academicYear.startDate) || q.date > iso(s.academicYear.endDate))) closed = { code: 'outside-year', detail: `The date is outside academic year ${s.academicYear.name}` };
      const roster = await rosterOf(tx, s.id, q.date);
      const session = await this.findSession(tx, s.id, q.date, period?.id ?? null);
      const marks = session ? await tx.attendanceRecord.findMany({ where: { sessionId: session.id }, select: { studentId: true, status: true, remarks: true, parentNotified: true } }) : [];
      const pending = new Map(session ? (await tx.attendanceCorrection.findMany({ where: { sessionId: session.id, status: 'PENDING' }, select: { id: true, studentId: true, newStatus: true } })).map((c) => [c.studentId, { id: c.id, newStatus: c.newStatus }]) : []);
      const byStudent = new Map(marks.map((m) => [m.studentId, m]));
      const leave = await onLeave(tx, 'STUDENT', roster.map((x) => x.id), q.date);
      const taker = session?.takenByUserId ? await tx.user.findUnique({ where: { id: session.takenByUserId }, select: { fullName: true } }) : null;
      const canMark = canAccessCampus(scopeFor(auth, PERMISSIONS.ATT_MARK) ?? { all: false, campusIds: [] }, s.campusId);
      return {
        section: { id: s.id, name: s.name, className: s.level.name, programName: s.level.program.name, campusId: s.campusId, year: s.academicYear.name },
        date: q.date, mode, period, closed,
        session: session ? { id: session.id, status: session.status, submittedAt: session.submittedAt, updatedAt: session.updatedAt, takenBy: taker?.fullName ?? null } : null,
        canMark: canMark && !closed && (!session || session.status === 'DRAFT'),
        canCorrect: !!session && session.status !== 'DRAFT' && canAccessCampus(scopeFor(auth, PERMISSIONS.ATT_CORRECT) ?? { all: false, campusIds: [] }, s.campusId),
        students: roster.map((r) => ({ ...r, status: byStudent.get(r.id)?.status ?? (leave.has(r.id) ? 'LEAVE' : null), remarks: byStudent.get(r.id)?.remarks ?? (leave.has(r.id) && !byStudent.has(r.id) ? leave.get(r.id)!.typeName : null), onLeave: leave.get(r.id) ?? null, parentNotified: byStudent.get(r.id)?.parentNotified ?? false, pendingCorrection: pending.get(r.id) ?? null })),
      };
    });
  }

  saveSheet(input: SaveSheetInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_MARK)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.sectionFor(tx, input.sectionId, scope);
      const mode = await this.settings.effective<AttendanceMode>(tx, 'attendance.mode', s.campusId);
      const period = await this.periodFor(tx, s.campusId, mode, input.periodId);
      const closed = await closedReason(tx, this.settings, s.campusId, input.date);
      if (closed) throw unprocessable(closed.code, closed.detail, [{ field: 'date', message: closed.detail }]);
      if (input.date < iso(s.academicYear.startDate) || input.date > iso(s.academicYear.endDate)) throw unprocessable('outside-year', `The date is outside academic year ${s.academicYear.name}`, [{ field: 'date', message: 'Outside the academic year' }]);

      // One sheet per section / day / period, even when two teachers save at the same moment.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`att:${s.id}:${input.date}:${period?.id ?? '-'}`}))`;
      let session = await this.findSession(tx, s.id, input.date, period?.id ?? null);
      if (session && session.status !== 'DRAFT') throw new AppError(HttpStatus.CONFLICT, 'attendance-locked', 'This attendance was already submitted. Changes need a correction request.');

      const roster = await rosterOf(tx, s.id, input.date);
      const onSheet = new Set(roster.map((r) => r.id));
      const given = new Set(input.records.map((r) => r.studentId));
      const extra = input.records.filter((r) => !onSheet.has(r.studentId));
      const missing = roster.filter((r) => !given.has(r.id));
      if (extra.length || missing.length) {
        throw unprocessable('roster-changed', 'The class list has changed since the sheet was opened — reload and mark again', [
          ...missing.map((m) => ({ field: 'records', message: `Missing: ${m.firstName} ${m.lastName ?? ''}`.trim() })),
          ...extra.map(() => ({ field: 'records', message: 'A student who is not in this section on this day' })),
        ]);
      }

      const employee = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      if (!session) {
        session = await tx.attendanceSession.create({
          data: { tenantId: auth.tenantId!, campusId: s.campusId, sectionId: s.id, attendanceDate: day(input.date), periodId: period?.id ?? null, takenBy: employee?.id ?? null, takenByUserId: auth.userId },
        });
      } else {
        await tx.attendanceSession.update({ where: { id: session.id }, data: { takenBy: employee?.id ?? null, takenByUserId: auth.userId } });
      }
      // All marks in one statement.
      const ids = input.records.map((r) => r.studentId);
      const statuses = input.records.map((r) => r.status);
      const remarks = input.records.map((r) => r.remarks || null);
      await tx.$executeRaw`
        INSERT INTO attendance_records (id, tenant_id, session_id, student_id, attendance_date, status, remarks, updated_at)
        SELECT gen_random_uuid(), app_current_tenant(), ${session.id}::uuid, x.sid, ${input.date}::date, x.st, x.rm, now()
          FROM unnest(${ids}::uuid[], ${statuses}::text[], ${remarks}::text[]) AS x(sid, st, rm)
        ON CONFLICT (session_id, student_id) DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, updated_at = now()
          WHERE attendance_records.status IS DISTINCT FROM EXCLUDED.status OR attendance_records.remarks IS DISTINCT FROM EXCLUDED.remarks`;
      let alerts: AlertResult | null = null;
      if (input.submit) {
        session = await tx.attendanceSession.update({ where: { id: session.id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
        alerts = await alertAbsentees(tx, { notifications: this.notifications, settings: this.settings }, {
          tenantId: auth.tenantId!, campusId: s.campusId, date: input.date, studentIds: input.records.filter((x) => x.status === 'ABSENT').map((x) => x.studentId),
          senderUserId: auth.userId, className: `${s.level.name} – ${s.name}`, periodName: period?.name ?? null,
        });
      }

      const counts = Object.fromEntries(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'].map((k) => [k, input.records.filter((r) => r.status === k).length]));
      await this.audit.log(tx, {
        tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: input.submit ? 'SUBMIT' : 'UPDATE', entityType: 'ATTENDANCE', entityId: session.id,
        newValues: { section: `${s.level.name} ${s.name}`, date: input.date, period: period?.name ?? null, ...counts },
      }, client);
      return { sessionId: session.id, status: session.status, counts, total: input.records.length, alerts };
    }, { timeout: 30_000 });
  }

  // ───────────── Day overview ─────────────

  /** Every current-year section in scope with whether its sheet for the day is taken, and the counts. */
  day(q: DayOverviewQuery, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ) ?? scopeFor(auth, PERMISSIONS.ATT_MARK)!;
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year) return { date: q.date, sections: [], totals: { sections: 0, submitted: 0, draft: 0, notTaken: 0, students: 0, present: 0, absent: 0 }, closed: {} };
      const campusIds = q.campusId ? [q.campusId] : scope.all ? undefined : scope.campusIds;
      const rows = await tx.$queryRaw<{ sectionId: string; sectionName: string; className: string; programName: string; campusId: string; students: number; status: string | null; present: number; absent: number; late: number; leave: number; halfDay: number; periodId: string | null }[]>`
        WITH secs AS (
          SELECT sec.id, sec.name, sec.campus_id, l.name AS level_name, l.sequence AS level_seq, p.name AS program_name
            FROM sections sec JOIN program_levels l ON l.id = sec.program_level_id JOIN programs p ON p.id = l.program_id
           WHERE sec.academic_year_id = ${year.id}::uuid AND sec.status = 'ACTIVE'
             AND (${campusIds ?? null}::uuid[] IS NULL OR sec.campus_id = ANY(${campusIds ?? null}::uuid[]))
        ),
        roster AS (
          SELECT e.section_id, count(*)::int AS n
            FROM student_enrollments e JOIN students s ON s.id = e.student_id
           WHERE e.section_id IN (SELECT id FROM secs) AND e.status <> 'CANCELLED' AND e.enrolled_on <= ${q.date}::date
             AND (e.ended_on IS NULL OR e.ended_on > ${q.date}::date OR (e.ended_on = ${q.date}::date AND e.status <> 'MOVED')) AND s.status <> 'INACTIVE'
           GROUP BY e.section_id
        ),
        sess AS (
          SELECT a.section_id, a.status, a.period_id,
                 count(r.id) FILTER (WHERE r.status = 'PRESENT')::int AS present, count(r.id) FILTER (WHERE r.status = 'ABSENT')::int AS absent,
                 count(r.id) FILTER (WHERE r.status = 'LATE')::int AS late, count(r.id) FILTER (WHERE r.status = 'LEAVE')::int AS leave,
                 count(r.id) FILTER (WHERE r.status = 'HALF_DAY')::int AS half_day
            FROM attendance_sessions a LEFT JOIN attendance_records r ON r.session_id = a.id
           WHERE a.attendance_date = ${q.date}::date AND a.section_id IN (SELECT id FROM secs)
             AND (${q.periodId ?? null}::uuid IS NULL AND a.period_id IS NULL OR a.period_id = ${q.periodId ?? null}::uuid)
           GROUP BY a.id
        )
        SELECT secs.id AS "sectionId", secs.name AS "sectionName", secs.level_name AS "className", secs.program_name AS "programName", secs.campus_id AS "campusId",
               coalesce(roster.n, 0) AS students, sess.status, sess.period_id AS "periodId",
               coalesce(sess.present, 0) AS present, coalesce(sess.absent, 0) AS absent, coalesce(sess.late, 0) AS late, coalesce(sess.leave, 0) AS leave, coalesce(sess.half_day, 0) AS "halfDay"
          FROM secs LEFT JOIN roster ON roster.section_id = secs.id LEFT JOIN sess ON sess.section_id = secs.id
         ORDER BY secs.program_name, secs.level_seq, secs.name`;
      const closed: Record<string, string> = {};
      for (const c of [...new Set(rows.map((r) => r.campusId))]) {
        const why = await closedReason(tx, this.settings, c, q.date);
        if (why) closed[c] = why.detail;
      }
      const withStudents = rows.filter((r) => r.students > 0);
      const sum = (k: 'present' | 'absent' | 'late' | 'leave' | 'halfDay') => withStudents.reduce((a, r) => a + r[k], 0);
      return {
        date: q.date,
        sections: rows,
        closed,
        totals: {
          sections: withStudents.length,
          submitted: withStudents.filter((r) => r.status === 'SUBMITTED' || r.status === 'LOCKED').length,
          draft: withStudents.filter((r) => r.status === 'DRAFT').length,
          notTaken: withStudents.filter((r) => !r.status).length,
          students: withStudents.reduce((a, r) => a + r.students, 0),
          present: sum('present') + sum('late') + sum('halfDay'),
          absent: sum('absent'),
          leave: sum('leave'),
        },
      };
    });
  }
}

