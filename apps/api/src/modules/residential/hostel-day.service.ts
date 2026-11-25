import { HttpStatus, Injectable } from '@nestjs/common';
import { HostelDailyNoteInput, PERMISSIONS } from '@eduerp/shared';
import { Db } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { day, todayIST } from '../students/student-records';

const name = (s: { firstName: string; lastName: string | null }) => `${s.firstName} ${s.lastName ?? ''}`.trim();

/**
 * Warden's daily report (Phase 21 R4) for one hostel and date: residents, roll call, children out on
 * outpass or home-going, sick visits, the school's meal register, and the warden's remarks.
 */
@Injectable()
export class HostelDayService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  async report(hostelId: string, date: string, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.HOSTEL_READ);
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await tx.hostel.findUnique({ where: { id: hostelId }, select: { id: true, name: true, campusId: true, hostelType: true } });
      if (!h || !scope || !canAccessCampus(scope, h.campusId)) throw NotFound('Hostel');
      const d = day(date);
      const dayEnd = new Date(d.getTime() + 86_400_000 - 1);
      const stays = await tx.hostelAllotment.findMany({
        where: { status: { in: ['CHECKED_IN', 'VACATED'] }, checkInDate: { lte: d }, OR: [{ checkOutDate: null }, { checkOutDate: { gt: d } }], bed: { room: { hostelId } } },
        select: { studentId: true, bedId: true },
      });
      const beds = new Map((await tx.hostelBed.findMany({ where: { id: { in: stays.map((s) => s.bedId) } }, select: { id: true, bedNo: true, roomId: true } })).map((b) => [b.id, b]));
      const rooms = new Map((await tx.hostelRoom.findMany({ where: { hostelId }, select: { id: true, roomNo: true } })).map((r) => [r.id, r.roomNo]));
      const kids = new Map((await tx.student.findMany({ where: { id: { in: stays.map((s) => s.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((k) => [k.id, k]));
      const campus = await tx.campus.findUnique({ where: { id: h.campusId }, select: { name: true } });
      const ids = stays.map((s) => s.studentId);
      const roll = await tx.hostelRollCall.findMany({ where: { hostelId, attendanceDate: d }, select: { studentId: true, status: true, remarks: true } });
      const byStudent = new Map(roll.map((r) => [r.studentId, r]));
      const outpasses = await tx.hostelOutpass.findMany({
        where: { hostelId, studentId: { in: ids }, actualOut: { lte: dayEnd }, OR: [{ actualReturn: null }, { actualReturn: { gte: d } }] },
        select: { studentId: true, destination: true, expectedReturn: true, actualReturn: true, status: true },
      });
      const homeGoing = await tx.hostelHomeGoing.findMany({
        where: { hostelId, studentId: { in: ids }, fromDate: { lte: d }, toDate: { gte: d }, status: { in: ['APPROVED', 'DEPARTED', 'RETURNED'] } },
        select: { studentId: true, fromDate: true, toDate: true, status: true, returnedAt: true },
      });
      const visits = await tx.infirmaryVisit.findMany({
        where: { studentId: { in: ids }, visitAt: { gte: new Date(d.getTime() - 330 * 60_000), lt: new Date(d.getTime() + 86_400_000 - 330 * 60_000) } },
        select: { studentId: true, complaint: true, outcome: true, visitAt: true },
        orderBy: { visitAt: 'asc' },
      });
      const meals = await tx.mealCount.findMany({ where: { campusId: h.campusId, mealDate: d }, select: { breakfast: true, lunch: true, snacks: true, dinner: true } });
      const note = await tx.hostelDailyNote.findUnique({ where: { tenantId_hostelId_noteDate: { tenantId: auth.tenantId!, hostelId, noteDate: d } }, select: { remarks: true, updatedAt: true } });
      const who = new Map(stays.map((s) => { const k = kids.get(s.studentId)!; const b = beds.get(s.bedId); return [s.studentId, { name: name(k), admissionNo: k.admissionNo, room: b ? rooms.get(b.roomId) ?? '' : '', bed: b?.bedNo ?? '' }]; }));
      const count = (st: string) => roll.filter((r) => r.status === st && who.has(r.studentId)).length;
      const sum = (k: 'breakfast' | 'lunch' | 'snacks' | 'dinner') => (meals.length ? meals.reduce((t, m) => t + m[k], 0) : null);
      return {
        hostel: { id: h.id, name: h.name, campus: campus?.name ?? '', hostelType: h.hostelType },
        date,
        residents: stays.length,
        rollCallTaken: roll.length > 0,
        present: count('PRESENT'),
        absent: count('ABSENT'),
        onOutpass: count('ON_OUTPASS'),
        onLeave: count('ON_LEAVE'),
        notMarked: ids.filter((id) => !byStudent.has(id)).length,
        absentees: ids.filter((id) => byStudent.get(id)?.status === 'ABSENT').map((id) => ({ ...who.get(id)!, studentId: id, remarks: byStudent.get(id)!.remarks })),
        out: [
          ...outpasses.map((o) => ({ ...who.get(o.studentId)!, studentId: o.studentId, kind: 'OUTPASS' as const, detail: o.destination, back: o.actualReturn ? o.actualReturn.toISOString() : null, due: o.expectedReturn.toISOString() })),
          ...homeGoing.map((g) => ({ ...who.get(g.studentId)!, studentId: g.studentId, kind: 'HOME' as const, detail: `${g.fromDate.toISOString().slice(0, 10)} – ${g.toDate.toISOString().slice(0, 10)}`, back: g.returnedAt ? g.returnedAt.toISOString() : null, due: null })),
        ],
        sick: visits.map((v) => ({ ...who.get(v.studentId!)!, studentId: v.studentId, complaint: v.complaint, outcome: v.outcome, at: v.visitAt.toISOString() })),
        meals: meals.length ? { breakfast: sum('breakfast'), lunch: sum('lunch'), snacks: sum('snacks'), dinner: sum('dinner'), forSchool: true } : null,
        remarks: note?.remarks ?? null,
        remarksSavedAt: note?.updatedAt.toISOString() ?? null,
        canWrite: !!scopeFor(auth, PERMISSIONS.HOSTEL_WARDEN) && canAccessCampus(scopeFor(auth, PERMISSIONS.HOSTEL_WARDEN)!, h.campusId),
      };
    });
  }

  async saveNote(hostelId: string, input: HostelDailyNoteInput, auth: AuthContext, client: ClientInfo) {
    const scope = scopeFor(auth, PERMISSIONS.HOSTEL_WARDEN);
    if (input.date > todayIST().toISOString().slice(0, 10)) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'future-date', 'Remarks can be written for today or an earlier day', [{ field: 'date', message: 'Today or earlier' }]);
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await tx.hostel.findUnique({ where: { id: hostelId }, select: { campusId: true } });
      if (!h || !scope || !canAccessCampus(scope, h.campusId)) throw NotFound('Hostel');
      const d = day(input.date);
      const before = await tx.hostelDailyNote.findUnique({ where: { tenantId_hostelId_noteDate: { tenantId: auth.tenantId!, hostelId, noteDate: d } } });
      const n = await tx.hostelDailyNote.upsert({
        where: { tenantId_hostelId_noteDate: { tenantId: auth.tenantId!, hostelId, noteDate: d } },
        update: { remarks: input.remarks, updatedBy: auth.userId },
        create: { tenantId: auth.tenantId!, hostelId, noteDate: d, remarks: input.remarks, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: before ? 'UPDATE' : 'CREATE', entityType: 'HOSTEL_DAILY_NOTE', entityId: n.id, oldValues: before ? { remarks: before.remarks } : null, newValues: { date: input.date, remarks: input.remarks } }, client);
      return { remarks: n.remarks, remarksSavedAt: n.updatedAt.toISOString() };
    });
  }
}
