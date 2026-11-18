import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { CorrectionInput, CorrectionQuery, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { alertAbsentees } from './absent-alerts';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MARK_LABEL: Record<string, string> = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', HALF_DAY: 'Half day', LEAVE: 'Leave' };

/**
 * Attendance corrections (M3.3). A submitted mark changes only through a correction: a reason is
 * required; when the institution has an approval rule for "Attendance correction" it waits for the
 * approvers, otherwise it applies at once. The change is made with the database's correction flag
 * set (the lock trigger allows nothing else). A change to ABSENT for today alerts the parent.
 */
@Injectable()
export class AttendanceCorrectionsService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('ATTENDANCE_CORRECTION', (tx, d) => this.decided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  request(input: CorrectionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const session = await tx.attendanceSession.findUnique({
        where: { id: input.sessionId },
        include: { section: { select: { name: true, level: { select: { name: true } } } }, period: { select: { name: true } } },
      });
      if (!session || !canAccessCampus(scopeFor(auth, PERMISSIONS.ATT_CORRECT)!, session.campusId)) throw NotFound('Attendance sheet');
      if (session.status === 'DRAFT') throw Conflict('sheet-not-submitted', 'This sheet is still a draft — change the mark directly');
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM attendance_records WHERE session_id = ${session.id}::uuid AND student_id = ${input.studentId}::uuid FOR UPDATE`;
      if (!rows.length) throw NotFound('Mark');
      const record = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: rows[0].id }, include: { student: { select: { firstName: true, lastName: true } } } });
      if (record.status === input.newStatus) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'no-change', 'The mark is already this', [{ field: 'newStatus', message: 'Choose a different mark' }]);
      if (await tx.attendanceCorrection.findFirst({ where: { recordId: record.id, status: 'PENDING' }, select: { id: true } })) throw Conflict('correction-pending', 'A correction for this mark is already waiting for approval');

      const name = `${record.student.firstName} ${record.student.lastName ?? ''}`.trim();
      let c = await tx.attendanceCorrection.create({
        data: {
          tenantId: session.tenantId, campusId: session.campusId, recordId: record.id, sessionId: session.id, studentId: record.studentId, attendanceDate: record.attendanceDate,
          oldStatus: record.status, newStatus: input.newStatus, reason: input.reason, requestedBy: auth.userId,
        },
      });
      const when = record.attendanceDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      const summary = `${name} · ${session.section.level.name} ${session.section.name} · ${when}${session.period ? ` (${session.period.name})` : ''}: ${MARK_LABEL[record.status] ?? record.status} → ${MARK_LABEL[input.newStatus] ?? input.newStatus}`;
      const approval = await this.approvals.submit(tx, { tenantId: session.tenantId, requestedBy: auth.userId, entityType: 'ATTENDANCE_CORRECTION', entityId: c.id, campusId: session.campusId, summary }, client);
      await this.audit.log(tx, { tenantId: session.tenantId, userId: auth.userId, campusId: session.campusId, action: 'CREATE', entityType: 'ATTENDANCE_CORRECTION', entityId: c.id, newValues: { summary, reason: input.reason, needsApproval: !!approval } }, client);
      if (approval) c = await tx.attendanceCorrection.update({ where: { id: c.id }, data: { approvalRequestId: approval.id } });
      else c = await this.apply(tx, c.id, auth.userId, null);
      return c;
    });
  }

  /** Makes the change (inside the caller's transaction). */
  private async apply(tx: Tx, id: string, userId: string, remarks: string | null) {
    const c = await tx.attendanceCorrection.findUniqueOrThrow({ where: { id } });
    await tx.$executeRaw`SELECT set_config('app.attendance_correction', 'on', true)`;
    await tx.attendanceRecord.update({ where: { id: c.recordId }, data: { status: c.newStatus } });
    await tx.$executeRaw`SELECT set_config('app.attendance_correction', '', true)`;
    const done = await tx.attendanceCorrection.update({ where: { id }, data: { status: 'APPROVED', decidedBy: userId, decidedAt: new Date(), decisionRemarks: remarks } });
    await this.audit.log(tx, { tenantId: c.tenantId, userId, campusId: c.campusId, action: 'UPDATE', entityType: 'ATTENDANCE', entityId: c.sessionId, oldValues: { studentId: c.studentId, status: c.oldStatus }, newValues: { studentId: c.studentId, status: c.newStatus, correctionId: id }, reason: c.reason });
    if (c.newStatus === 'ABSENT') {
      const s = await tx.attendanceSession.findUniqueOrThrow({ where: { id: c.sessionId }, include: { section: { select: { name: true, level: { select: { name: true } } } }, period: { select: { name: true } } } });
      await alertAbsentees(tx, { notifications: this.notifications, settings: this.settings }, {
        tenantId: c.tenantId, campusId: c.campusId, date: iso(c.attendanceDate), studentIds: [c.studentId], senderUserId: userId,
        className: `${s.section.level.name} – ${s.section.name}`, periodName: s.period?.name ?? null,
      });
    }
    return done;
  }

  private async decided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; remarks: string | null; userId: string }) {
    const c = await tx.attendanceCorrection.findUnique({ where: { id: d.entityId } });
    if (!c || c.status !== 'PENDING') return;
    if (d.decision === 'APPROVED') await this.apply(tx, c.id, d.userId, d.remarks);
    else await tx.attendanceCorrection.update({ where: { id: c.id }, data: { status: d.decision, decidedBy: d.userId, decidedAt: new Date(), decisionRemarks: d.remarks } });
  }

  list(q: CorrectionQuery, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ATT_READ)!;
    return this.db.run(this.ctx(auth), async (tx) => {
      const where = { ...(q.status ? { status: q.status } : {}), ...(q.sessionId ? { sessionId: q.sessionId } : {}), ...(scope.all ? {} : { campusId: { in: scope.campusIds } }) };
      const [total, rows] = await Promise.all([
        tx.attendanceCorrection.count({ where }),
        tx.attendanceCorrection.findMany({
          where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: { student: { select: { firstName: true, lastName: true, admissionNo: true } }, record: { select: { session: { select: { attendanceDate: true, section: { select: { name: true, level: { select: { name: true } } } }, period: { select: { name: true } } } } } } },
        }),
      ]);
      const users = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      return {
        total, page: q.page, pageSize: q.pageSize,
        items: rows.map(({ record, ...r }) => ({
          ...r, attendanceDate: iso(r.attendanceDate), className: `${record.session.section.level.name} – ${record.session.section.name}`, periodName: record.session.period?.name ?? null,
          requestedByName: users.get(r.requestedBy) ?? null, decidedByName: r.decidedBy ? users.get(r.decidedBy) ?? null : null,
        })),
      };
    });
  }
}
