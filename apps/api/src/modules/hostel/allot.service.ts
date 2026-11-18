import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { AllotInput, CheckInInput, PERMISSIONS, RoomChangeInput, VacateInput, fromPaise, hostelTakes, monthsLeft, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { ApprovalsService } from '../approvals/approvals.service';
import { FeeBillingService } from '../fees/billing.service';
import { HostelSetupService } from './setup.service';

const ALLOT = PERMISSIONS.HOSTEL_ALLOT;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const money = (v: unknown) => fromPaise(toPaise(String(v ?? 0)));
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Student = { id: string; tenantId: string; campusId: string; firstName: string; lastName: string | null; admissionNo: string; status: string; gender: string };

/**
 * Hostel allotment (M7.2). One student per bed and one bed per student — checked under a row lock
 * on the bed and guaranteed by partial unique indexes; the hostel type must match the student's
 * gender. The room fee (for the months left in the year) and the caution deposit (once) are billed
 * in the same transaction through the fee module. Check-in / check-out record each room item's
 * condition; anything damaged or missing at check-out becomes a damage charge that reaches the bills
 * only once approved.
 */
@Injectable()
export class HostelAllotService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly setup: HostelSetupService,
    private readonly billing: FeeBillingService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('HOSTEL_DAMAGE', (tx, d) => this.damageDecided(tx, d));
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  private async student(tx: Tx, id: string, auth: AuthContext): Promise<Student> {
    const s = await tx.student.findUnique({ where: { id }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true, status: true, gender: true } });
    if (!s || !canAccessCampus(this.setup.scope(auth, ALLOT), s.campusId)) throw NotFound('Student');
    return s;
  }

  /** The bed, its room and hostel, locked for this transaction. */
  private async lockBed(tx: Tx, bedId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM hostel_beds WHERE id = ${bedId}::uuid FOR UPDATE`;
    if (!rows.length) throw NotFound('Bed');
    return tx.hostelBed.findUniqueOrThrow({ where: { id: bedId }, include: { room: { include: { hostel: true } } } });
  }

  private checkBedFor(bed: Awaited<ReturnType<HostelAllotService['lockBed']>>, s: Student) {
    const h = bed.room.hostel;
    if (h.campusId !== s.campusId) throw unprocessable('hostel-other-campus', 'Choose a hostel of the student’s campus', 'bedId');
    if (h.status !== 'ACTIVE' || bed.room.status !== 'AVAILABLE') throw Conflict('room-unavailable', `Room ${bed.room.roomNo} is not available`);
    if (!hostelTakes(h.hostelType, s.gender)) throw unprocessable('hostel-gender', `${h.name} does not take ${s.gender === 'FEMALE' ? 'girls' : s.gender === 'MALE' ? 'boys' : 'this student'}`, 'bedId');
    if (bed.status !== 'VACANT') throw Conflict('bed-taken', `Bed ${bed.room.roomNo}-${bed.bedNo} is not free`);
  }

  async allot(input: AllotInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, input.studentId, auth);
      if (s.status !== 'ACTIVE') throw Conflict('student-not-active', 'Only a current student can be given a bed');
      const bed = await this.lockBed(tx, input.bedId);
      this.checkBedFor(bed, s);
      if (await tx.hostelAllotment.findFirst({ where: { studentId: s.id, status: { in: ['RESERVED', 'CHECKED_IN'] } }, select: { id: true } })) {
        throw Conflict('already-allotted', `${s.firstName} already has a hostel bed — change the room instead`);
      }
      const year = await tx.academicYear.findFirst({ where: { startDate: { lte: day(input.checkInDate) }, endDate: { gte: day(input.checkInDate) } }, select: { id: true, name: true, startDate: true, endDate: true, isCurrent: true, status: true } });
      if (!year || year.status === 'CLOSED') throw unprocessable('date-outside-year', 'The check-in date is not in an open academic year', 'checkInDate');
      if (input.bill && !year.isCurrent) throw unprocessable('bill-current-year', 'The hostel fee is billed in the current academic year only', 'checkInDate');

      let roomInvoiceId: string | null = null;
      let depositInvoiceId: string | null = null;
      const billed: { room?: string; deposit?: string } = {};
      if (input.bill) {
        const due = input.checkInDate < todayIST() ? todayIST() : input.checkInDate;
        const roomHead = await tx.feeHead.findFirst({ where: { feeType: 'HOSTEL', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (!roomHead) throw Conflict('no-hostel-fee-head', 'Add a fee head of type Hostel in Fees → Setup first, or untick "Add the hostel fee to the bills"');
        const total = monthsLeft(iso(year.startDate)!, iso(year.endDate)!, iso(year.startDate)!);
        const left = monthsLeft(iso(year.startDate)!, iso(year.endDate)!, input.checkInDate);
        const roomPaise = Math.round((toPaise(String(bed.room.feeAmount)) * left) / total / 100) * 100;
        if (roomPaise > 0) {
          const inv = await this.billing.chargeInTx(tx, s, { feeHeadId: roomHead.id, amount: fromPaise(roomPaise), dueDate: due, description: `Hostel fee ${year.name} · ${bed.room.hostel.name}, room ${bed.room.roomNo} (from ${pretty(input.checkInDate)})` }, auth.userId);
          roomInvoiceId = inv.id; billed.room = fromPaise(roomPaise);
        }
        const deposit = toPaise(String(bed.room.hostel.depositAmount));
        const hadDeposit = await tx.hostelAllotment.findFirst({ where: { studentId: s.id, depositInvoiceId: { not: null }, status: { not: 'CANCELLED' } }, select: { id: true } });
        if (deposit > 0 && !hadDeposit) {
          const depHead = await tx.feeHead.findFirst({ where: { feeType: 'DEPOSIT', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
          if (!depHead) throw Conflict('no-deposit-fee-head', 'Add a fee head of type Deposit in Fees → Setup for the caution deposit');
          const inv = await this.billing.chargeInTx(tx, s, { feeHeadId: depHead.id, amount: fromPaise(deposit), dueDate: due, description: `Hostel caution deposit · ${bed.room.hostel.name} (refundable)` }, auth.userId);
          depositInvoiceId = inv.id; billed.deposit = fromPaise(deposit);
        }
      }
      const a = await tx.hostelAllotment.create({
        data: { tenantId: auth.tenantId!, studentId: s.id, bedId: bed.id, academicYearId: year.id, checkInDate: day(input.checkInDate), roomInvoiceId, depositInvoiceId, createdBy: auth.userId },
      });
      await tx.hostelBed.update({ where: { id: bed.id }, data: { status: 'RESERVED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'HOSTEL_ALLOTMENT', entityId: a.id, newValues: { student: s.admissionNo, hostel: bed.room.hostel.name, room: bed.room.roomNo, bed: bed.bedNo, checkInDate: input.checkInDate, billed } }, client);
      return { ...a, checkInDate: iso(a.checkInDate), billed };
    });
  }

  private async allotment(tx: Tx, id: string, auth: AuthContext) {
    const a = await tx.hostelAllotment.findUnique({ where: { id }, include: { bed: { include: { room: { include: { hostel: true, inventory: { where: { status: 'ACTIVE' } } } } } } } });
    if (!a || !canAccessCampus(this.setup.scope(auth, ALLOT), a.bed.room.hostel.campusId)) throw NotFound('Allotment');
    return a;
  }

  /** Every active room item must be checked (condition at check-in / check-out). */
  private async recordChecks(tx: Tx, allotmentId: string, roomItems: { id: string }[], items: CheckInInput['items'], checkType: 'CHECK_IN' | 'CHECK_OUT', userId: string, tenantId: string) {
    const given = new Map(items.map((i) => [i.inventoryItemId, i]));
    for (const i of items) if (!roomItems.some((r) => r.id === i.inventoryItemId)) throw unprocessable('item-not-in-room', 'An item is not part of this room', 'items');
    const missing = roomItems.filter((r) => !given.has(r.id));
    if (missing.length) throw unprocessable('items-unchecked', `Check every item of the room (${missing.length} left)`, 'items');
    for (const i of items) {
      await tx.allotmentItemCheck.create({ data: { tenantId, allotmentId, checkType, inventoryItemId: i.inventoryItemId, condition: i.condition, remarks: i.remarks ?? null, checkedBy: userId } });
    }
  }

  checkIn(id: string, input: CheckInInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.allotment(tx, id, auth);
      if (a.status !== 'RESERVED') throw Conflict('not-reserved', 'Only a reserved bed can be checked in');
      if (iso(a.checkInDate)! > todayIST()) throw Conflict('check-in-later', `Check-in is planned for ${pretty(iso(a.checkInDate)!)}`);
      await this.recordChecks(tx, id, a.bed.room.inventory, input.items, 'CHECK_IN', auth.userId, auth.tenantId!);
      const after = await tx.hostelAllotment.update({ where: { id }, data: { status: 'CHECKED_IN', updatedBy: auth.userId } });
      await tx.hostelBed.update({ where: { id: a.bedId }, data: { status: 'OCCUPIED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.bed.room.hostel.campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_ALLOTMENT', entityId: id, oldValues: { status: 'RESERVED' }, newValues: { status: 'CHECKED_IN', items: input.items.length } }, client);
      return { ...after, checkInDate: iso(after.checkInDate) };
    });
  }

  /**
   * Checks the student out (or cancels a reservation): the bed is freed; items damaged or missing at
   * check-out (that were fine at check-in) become one damage charge, billed once approved.
   */
  async vacate(id: string, input: VacateInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.allotment(tx, id, auth);
      if (!['RESERVED', 'CHECKED_IN'].includes(a.status)) throw Conflict('allotment-closed', 'This student has already left the bed');
      if (input.checkOutDate < iso(a.checkInDate)! && a.status === 'CHECKED_IN') throw unprocessable('out-before-in', 'The check-out date is before the check-in date', 'checkOutDate');
      let damage: { id: string; amount: string; status: string } | null = null;
      if (a.status === 'CHECKED_IN') {
        await this.recordChecks(tx, id, a.bed.room.inventory, input.items, 'CHECK_OUT', auth.userId, auth.tenantId!);
        const atIn = new Map((await tx.allotmentItemCheck.findMany({ where: { allotmentId: id, checkType: 'CHECK_IN' } })).map((c) => [c.inventoryItemId, c.condition]));
        const lost = input.items.filter((i) => i.condition !== 'GOOD' && atIn.get(i.inventoryItemId) === 'GOOD');
        if (lost.length) {
          const items = a.bed.room.inventory.filter((r) => lost.some((l) => l.inventoryItemId === r.id));
          const amount = items.reduce((s, r) => s + toPaise(String(r.unitCost)), 0);
          if (amount > 0) {
            const description = `Room ${a.bed.room.roomNo}: ${items.map((r) => `${r.itemName} (${lost.find((l) => l.inventoryItemId === r.id)!.condition.toLowerCase()})`).join(', ')}`;
            const c = await tx.hostelDamageCharge.create({ data: { tenantId: auth.tenantId!, allotmentId: id, description, amount: fromPaise(amount), createdBy: auth.userId } });
            const s = await tx.student.findUniqueOrThrow({ where: { id: a.studentId }, select: { firstName: true, lastName: true, admissionNo: true } });
            const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'HOSTEL_DAMAGE', entityId: c.id, campusId: a.bed.room.hostel.campusId, summary: `${s.firstName} ${s.lastName ?? ''} (${s.admissionNo}) · ${description} · ₹${(amount / 100).toLocaleString('en-IN')}`.replace(/\s+/g, ' ') }, client);
            if (req) await tx.hostelDamageCharge.update({ where: { id: c.id }, data: { approvalRequestId: req.id } });
            else await this.chargeDamage(tx, c.id, auth.userId);
            const after = await tx.hostelDamageCharge.findUniqueOrThrow({ where: { id: c.id } });
            damage = { id: c.id, amount: money(after.amount), status: after.status };
          }
        }
      }
      const status = a.status === 'CHECKED_IN' ? 'VACATED' : 'CANCELLED';
      const after = await tx.hostelAllotment.update({ where: { id }, data: { status, checkOutDate: a.status === 'CHECKED_IN' ? day(input.checkOutDate) : null, endReason: input.reason ?? null, updatedBy: auth.userId } });
      await tx.hostelBed.update({ where: { id: a.bedId }, data: { status: 'VACANT' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: a.bed.room.hostel.campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_ALLOTMENT', entityId: id, oldValues: { status: a.status }, newValues: { status, checkOutDate: input.checkOutDate, damage } }, client);
      return { ...after, checkInDate: iso(after.checkInDate), checkOutDate: iso(after.checkOutDate), damage, deposit: await this.depositSummary(tx, a.studentId) };
    });
  }

  /** Bills an approved (or approval-free) damage charge under the hostel fee head. */
  private async chargeDamage(tx: Tx, chargeId: string, userId: string) {
    const c = await tx.hostelDamageCharge.findUniqueOrThrow({ where: { id: chargeId }, include: { allotment: true } });
    const head = await tx.feeHead.findFirst({ where: { feeType: { in: ['HOSTEL', 'FINE'] }, status: 'ACTIVE' }, orderBy: [{ feeType: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    if (!head) throw Conflict('no-hostel-fee-head', 'Add a fee head of type Hostel in Fees → Setup first');
    const s = await tx.student.findUniqueOrThrow({ where: { id: c.allotment.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    const inv = await this.billing.chargeInTx(tx, s, { feeHeadId: head.id, amount: money(c.amount), dueDate: todayIST(), description: `Hostel damage · ${c.description}`.slice(0, 200) }, userId);
    await tx.hostelDamageCharge.update({ where: { id: chargeId }, data: { status: 'CHARGED', invoiceId: inv.id } });
  }

  private async damageDecided(tx: Tx, d: { entityId: string; decision: 'APPROVED' | 'REJECTED' | 'CANCELLED'; userId: string }) {
    const c = await tx.hostelDamageCharge.findUnique({ where: { id: d.entityId } });
    if (!c || c.status !== 'PENDING') return;
    if (d.decision === 'APPROVED') await this.chargeDamage(tx, c.id, d.userId);
    else await tx.hostelDamageCharge.update({ where: { id: c.id }, data: { status: 'WAIVED' } });
  }

  /** Deposit billed and paid, damage charges, and what is left to refund. */
  async depositSummary(tx: Tx, studentId: string) {
    const a = await tx.hostelAllotment.findFirst({ where: { studentId, depositInvoiceId: { not: null }, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' }, select: { depositInvoiceId: true } });
    const inv = a?.depositInvoiceId ? await tx.feeInvoice.findUnique({ where: { id: a.depositInvoiceId }, select: { netAmount: true, paidAmount: true, status: true } }) : null;
    const damages = await tx.hostelDamageCharge.findMany({ where: { allotment: { studentId }, status: { in: ['PENDING', 'CHARGED'] } }, select: { amount: true, status: true } });
    const paid = inv && inv.status !== 'CANCELLED' ? toPaise(String(inv.paidAmount)) : 0;
    const charged = damages.filter((x) => x.status === 'CHARGED').reduce((s, x) => s + toPaise(String(x.amount)), 0);
    const pending = damages.filter((x) => x.status === 'PENDING').reduce((s, x) => s + toPaise(String(x.amount)), 0);
    return { billed: inv ? money(inv.netAmount) : '0.00', paid: fromPaise(paid), damagesCharged: fromPaise(charged), damagesPending: fromPaise(pending), refundable: fromPaise(Math.max(0, paid - charged - pending)) };
  }

  /** Moves a checked-in student to another free bed (no new bill; history kept). */
  changeRoom(id: string, input: RoomChangeInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await this.allotment(tx, id, auth);
      if (a.status !== 'CHECKED_IN') throw Conflict('not-checked-in', 'Only a checked-in student can change rooms');
      if (input.bedId === a.bedId) throw unprocessable('same-bed', 'Choose a different bed', 'bedId');
      const s = await this.student(tx, a.studentId, auth);
      const bed = await this.lockBed(tx, input.bedId);
      this.checkBedFor(bed, s);
      await tx.hostelAllotment.update({ where: { id }, data: { status: 'VACATED', checkOutDate: day(input.date), endReason: `Moved to ${bed.room.hostel.name} ${bed.room.roomNo}-${bed.bedNo}: ${input.reason}`, updatedBy: auth.userId } });
      await tx.hostelBed.update({ where: { id: a.bedId }, data: { status: 'VACANT' } });
      const n = await tx.hostelAllotment.create({ data: { tenantId: auth.tenantId!, studentId: s.id, bedId: bed.id, academicYearId: a.academicYearId, checkInDate: day(input.date), status: 'CHECKED_IN', movedFromId: id, createdBy: auth.userId } });
      await tx.hostelBed.update({ where: { id: bed.id }, data: { status: 'OCCUPIED' } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'HOSTEL_ALLOTMENT', entityId: n.id, oldValues: { bed: `${a.bed.room.roomNo}-${a.bed.bedNo}` }, newValues: { bed: `${bed.room.roomNo}-${bed.bedNo}`, reason: input.reason } }, client);
      return { ...n, checkInDate: iso(n.checkInDate) };
    });
  }

  /** Residents of a hostel (reserved and checked in), room by room. */
  residents(hostelId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      await this.setup.hostelOf(tx, hostelId, auth);
      const rows = await tx.$queryRaw<{ id: string; status: string; check_in_date: Date; student_id: string; name: string; admission_no: string; room_no: string; bed_no: string; block: string | null; floor: string | null; guardian_name: string | null; guardian_phone: string | null }[]>`
        SELECT a.id, a.status, a.check_in_date, s.id AS student_id, trim(s.first_name || ' ' || coalesce(s.last_name, '')) AS name, s.admission_no,
               r.room_no, b.bed_no, r.block, r.floor, g.name AS guardian_name, g.phone AS guardian_phone
          FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id JOIN students s ON s.id = a.student_id
          LEFT JOIN LATERAL (SELECT gg.name, gg.phone FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) g ON true
         WHERE r.hostel_id = ${hostelId}::uuid AND a.status IN ('RESERVED', 'CHECKED_IN')
         ORDER BY r.block NULLS FIRST, r.floor NULLS FIRST, r.room_no, b.bed_no`;
      return rows.map((r) => ({ id: r.id, status: r.status, checkInDate: iso(r.check_in_date), studentId: r.student_id, name: r.name, admissionNo: r.admission_no, roomNo: r.room_no, bedNo: r.bed_no, block: r.block, floor: r.floor, guardianName: r.guardian_name, guardianPhone: r.guardian_phone }));
    });
  }

  /** A student's hostel history, current stay first, with check items and the deposit position. */
  async forStudent(studentId: string, auth: AuthContext) {
    const sc = this.setup.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(sc, s.campusId)) throw NotFound('Student');
      return this.historyTx(tx, studentId);
    });
  }

  async historyTx(tx: Tx, studentId: string) {
    const rows = await tx.hostelAllotment.findMany({
      where: { studentId }, orderBy: { createdAt: 'desc' },
      include: { bed: { include: { room: { include: { hostel: { select: { id: true, name: true, wardenEmployeeId: true } }, inventory: { where: { status: 'ACTIVE' }, orderBy: { itemName: 'asc' } } } } } }, damages: true },
    });
    const wardens = await this.setup.staffNames(tx, rows.map((r) => r.bed.room.hostel.wardenEmployeeId).filter((x): x is string => !!x));
    return {
      stays: rows.map((a) => ({
        id: a.id, status: a.status, checkInDate: iso(a.checkInDate), checkOutDate: iso(a.checkOutDate), endReason: a.endReason,
        hostel: a.bed.room.hostel.name, hostelId: a.bed.room.hostel.id, roomId: a.bed.roomId, roomNo: a.bed.room.roomNo, bedNo: a.bed.bedNo, block: a.bed.room.block, floor: a.bed.room.floor,
        warden: a.bed.room.hostel.wardenEmployeeId ? wardens.get(a.bed.room.hostel.wardenEmployeeId) ?? null : null,
        items: a.bed.room.inventory.map((i) => ({ id: i.id, itemName: i.itemName, quantity: i.quantity, unitCost: money(i.unitCost) })),
        damages: a.damages.map((d) => ({ id: d.id, description: d.description, amount: money(d.amount), status: d.status })),
      })),
      deposit: await this.depositSummary(tx, studentId),
    };
  }

  /** Free beds a student may take (their campus, a hostel for their gender). */
  async freeBeds(studentId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, studentId, auth);
      const hostels = await tx.hostel.findMany({ where: { campusId: s.campusId, status: 'ACTIVE' }, orderBy: { name: 'asc' } });
      const ok = hostels.filter((h) => hostelTakes(h.hostelType, s.gender));
      const rooms = await tx.hostelRoom.findMany({
        where: { hostelId: { in: ok.map((h) => h.id) }, status: 'AVAILABLE' },
        orderBy: [{ roomNo: 'asc' }],
        include: { beds: { where: { status: 'VACANT' }, orderBy: { bedNo: 'asc' }, select: { id: true, bedNo: true } } },
      });
      const heads = await tx.feeHead.findMany({ where: { feeType: { in: ['HOSTEL', 'DEPOSIT'] }, status: 'ACTIVE' }, select: { feeType: true } });
      return {
        hasHostelHead: heads.some((h) => h.feeType === 'HOSTEL'), hasDepositHead: heads.some((h) => h.feeType === 'DEPOSIT'),
        hostels: ok.map((h) => ({
          id: h.id, name: h.name, hostelType: h.hostelType, depositAmount: money(h.depositAmount),
          rooms: rooms.filter((r) => r.hostelId === h.id && r.beds.length).map((r) => ({ id: r.id, roomNo: r.roomNo, roomType: r.roomType, isAc: r.isAc, feeAmount: money(r.feeAmount), floor: r.floor, block: r.block, beds: r.beds })),
        })),
      };
    });
  }
}
