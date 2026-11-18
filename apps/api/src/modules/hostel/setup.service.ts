import { HttpStatus, Injectable } from '@nestjs/common';
import {
  BulkRoomsInput, HostelInput, InventoryInput, PERMISSIONS, PermissionCode, RoomInput, UpdateHostelInput, UpdateRoomInput, fromPaise, toPaise,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const MANAGE = PERMISSIONS.HOSTEL_MANAGE;
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const money = (v: unknown) => fromPaise(toPaise(String(v ?? 0)));
/** Bed labels: A, B, C… up to 26, then 1, 2, 3… */
export const bedLabel = (i: number, capacity: number) => (capacity <= 26 ? String.fromCharCode(65 + i) : String(i + 1));

/**
 * Hostel set-up (M7.1): hostels (boys / girls / staff, warden from the staff list, caution deposit),
 * rooms with their beds — always as many in-use beds as the room's capacity; beds are never deleted:
 * reducing the capacity retires spare empty beds — and the room inventory used at check-in / out.
 */
@Injectable()
export class HostelSetupService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  scope(auth: AuthContext, code: PermissionCode = PERMISSIONS.HOSTEL_READ): CampusScope {
    return scopeFor(auth, code) ?? { all: false, campusIds: [] };
  }

  /** The hostel of a room / bed, checked against the user's campus scope. */
  async hostelOf(tx: Tx, hostelId: string, auth: AuthContext, code: PermissionCode = PERMISSIONS.HOSTEL_READ) {
    const h = await tx.hostel.findUnique({ where: { id: hostelId } });
    if (!h || !canAccessCampus(this.scope(auth, code), h.campusId)) throw NotFound('Hostel');
    return h;
  }

  hostels(auth: AuthContext, campusId?: string) {
    const s = this.scope(auth);
    if (campusId && !canAccessCampus(s, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.hostel.findMany({ where: campusId ? { campusId } : s.all ? {} : { campusId: { in: s.campusIds } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
      const counts = await tx.$queryRaw<{ hostel_id: string; rooms: number; beds: number; vacant: number; reserved: number; occupied: number; blocked: number }[]>`
        SELECT r.hostel_id, count(DISTINCT r.id)::int AS rooms,
               count(b.id) FILTER (WHERE b.status <> 'RETIRED')::int AS beds,
               count(b.id) FILTER (WHERE b.status = 'VACANT' AND r.status = 'AVAILABLE')::int AS vacant,
               count(b.id) FILTER (WHERE b.status = 'RESERVED')::int AS reserved,
               count(b.id) FILTER (WHERE b.status = 'OCCUPIED')::int AS occupied,
               count(b.id) FILTER (WHERE b.status = 'BLOCKED' OR (b.status = 'VACANT' AND r.status <> 'AVAILABLE'))::int AS blocked
          FROM hostel_rooms r LEFT JOIN hostel_beds b ON b.room_id = r.id
         WHERE r.hostel_id = ANY(${rows.map((h) => h.id)}::uuid[])
         GROUP BY r.hostel_id`;
      const wardens = await this.staffNames(tx, rows.map((h) => h.wardenEmployeeId).filter((x): x is string => !!x));
      return rows.map((h) => {
        const c = counts.find((x) => x.hostel_id === h.id);
        return { ...h, depositAmount: money(h.depositAmount), warden: h.wardenEmployeeId ? wardens.get(h.wardenEmployeeId) ?? null : null, rooms: c?.rooms ?? 0, beds: c?.beds ?? 0, vacant: c?.vacant ?? 0, reserved: c?.reserved ?? 0, occupied: c?.occupied ?? 0, blocked: c?.blocked ?? 0 };
      });
    });
  }

  async staffNames(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; name: string; phone: string | null }>();
    const rows = await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, phone: true } });
    return new Map(rows.map((e) => [e.id, { id: e.id, name: `${e.firstName} ${e.lastName ?? ''}`.trim(), phone: e.phone }]));
  }

  private async checkWarden(tx: Tx, campusId: string, wardenEmployeeId: string | null | undefined) {
    if (!wardenEmployeeId) return;
    const e = await tx.employee.findUnique({ where: { id: wardenEmployeeId }, select: { campusId: true, status: true } });
    if (!e || e.campusId !== campusId || !['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw unprocessable('warden-invalid', 'Choose a current staff member of this campus', 'wardenEmployeeId');
  }

  createHostel(input: HostelInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.scope(auth, MANAGE), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      if (await tx.hostel.findUnique({ where: { tenantId_campusId_name: { tenantId: auth.tenantId!, campusId: input.campusId, name: input.name } }, select: { id: true } })) {
        throw Conflict('hostel-name-taken', `${input.name} already exists on this campus`);
      }
      await this.checkWarden(tx, input.campusId, input.wardenEmployeeId);
      const h = await tx.hostel.create({ data: { ...input, wardenEmployeeId: input.wardenEmployeeId ?? null, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'CREATE', entityType: 'HOSTEL', entityId: h.id, newValues: input }, client);
      return { ...h, depositAmount: money(h.depositAmount) };
    });
  }

  updateHostel(id: string, input: UpdateHostelInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.hostelOf(tx, id, auth, MANAGE);
      if (input.name && input.name !== h.name && (await tx.hostel.findUnique({ where: { tenantId_campusId_name: { tenantId: auth.tenantId!, campusId: h.campusId, name: input.name } }, select: { id: true } }))) {
        throw Conflict('hostel-name-taken', `${input.name} already exists on this campus`);
      }
      await this.checkWarden(tx, h.campusId, input.wardenEmployeeId);
      if (input.status === 'INACTIVE' && (await tx.hostelBed.count({ where: { status: { in: ['RESERVED', 'OCCUPIED'] }, room: { hostelId: id } } }))) {
        throw Conflict('hostel-in-use', 'Students still stay in this hostel — move them first');
      }
      const after = await tx.hostel.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'UPDATE', entityType: 'HOSTEL', entityId: id, oldValues: h, newValues: input }, client);
      return { ...after, depositAmount: money(after.depositAmount) };
    });
  }

  /** Rooms with their beds (who is in each) and inventory. */
  rooms(hostelId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.hostelOf(tx, hostelId, auth);
      const rooms = await tx.hostelRoom.findMany({
        where: { hostelId },
        orderBy: [{ block: 'asc' }, { floor: 'asc' }, { roomNo: 'asc' }],
        include: { beds: { where: { status: { not: 'RETIRED' } }, orderBy: { bedNo: 'asc' } }, inventory: { where: { status: 'ACTIVE' }, orderBy: { itemName: 'asc' } } },
      });
      const bedIds = rooms.flatMap((r) => r.beds.map((b) => b.id));
      const occ = await tx.$queryRaw<{ bed_id: string; allotment_id: string; status: string; student_id: string; name: string; admission_no: string }[]>`
        SELECT a.bed_id, a.id AS allotment_id, a.status, s.id AS student_id, trim(s.first_name || ' ' || coalesce(s.last_name, '')) AS name, s.admission_no
          FROM hostel_allotments a JOIN students s ON s.id = a.student_id
         WHERE a.bed_id = ANY(${bedIds}::uuid[]) AND a.status IN ('RESERVED', 'CHECKED_IN')`;
      return {
        hostel: { ...h, depositAmount: money(h.depositAmount) },
        rooms: rooms.map((r) => ({
          ...r, feeAmount: money(r.feeAmount),
          inventory: r.inventory.map((i) => ({ ...i, unitCost: money(i.unitCost) })),
          beds: r.beds.map((b) => {
            const o = occ.find((x) => x.bed_id === b.id);
            return { ...b, occupant: o ? { allotmentId: o.allotment_id, studentId: o.student_id, name: o.name, admissionNo: o.admission_no, status: o.status } : null };
          }),
        })),
      };
    });
  }

  private async addRoomTx(tx: Tx, hostelId: string, input: RoomInput, tenantId: string) {
    if (await tx.hostelRoom.findUnique({ where: { tenantId_hostelId_roomNo: { tenantId, hostelId, roomNo: input.roomNo } }, select: { id: true } })) {
      throw Conflict('room-no-taken', `Room ${input.roomNo} already exists in this hostel`);
    }
    const r = await tx.hostelRoom.create({ data: { tenantId, hostelId, block: input.block ?? null, floor: input.floor ?? null, roomNo: input.roomNo, roomType: input.roomType, capacity: input.capacity, isAc: input.isAc, feeAmount: input.feeAmount } });
    await tx.hostelBed.createMany({ data: Array.from({ length: input.capacity }, (_, i) => ({ tenantId, roomId: r.id, bedNo: bedLabel(i, input.capacity) })) });
    return r;
  }

  addRoom(hostelId: string, input: RoomInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.hostelOf(tx, hostelId, auth, MANAGE);
      const r = await this.addRoomTx(tx, hostelId, input, auth.tenantId!);
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'CREATE', entityType: 'HOSTEL_ROOM', entityId: r.id, newValues: input }, client);
      return { ...r, feeAmount: money(r.feeAmount) };
    });
  }

  bulkRooms(hostelId: string, input: BulkRoomsInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const h = await this.hostelOf(tx, hostelId, auth, MANAGE);
      const made: string[] = [];
      for (let n = input.from; n <= input.to; n++) {
        const roomNo = `${input.prefix}${n}`;
        await this.addRoomTx(tx, hostelId, { block: input.block, floor: input.floor, roomNo, roomType: input.roomType, capacity: input.capacity, isAc: input.isAc, feeAmount: input.feeAmount }, auth.tenantId!);
        made.push(roomNo);
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'CREATE', entityType: 'HOSTEL_ROOM', entityId: hostelId, newValues: { rooms: made, ...input } }, client);
      return { created: made.length, rooms: made };
    });
  }

  updateRoom(roomId: string, input: UpdateRoomInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.hostelRoom.findUnique({ where: { id: roomId }, include: { beds: { orderBy: { bedNo: 'asc' } } } });
      if (!r) throw NotFound('Room');
      const h = await this.hostelOf(tx, r.hostelId, auth, MANAGE);
      if (input.roomNo && input.roomNo !== r.roomNo && (await tx.hostelRoom.findUnique({ where: { tenantId_hostelId_roomNo: { tenantId: auth.tenantId!, hostelId: r.hostelId, roomNo: input.roomNo } }, select: { id: true } }))) {
        throw Conflict('room-no-taken', `Room ${input.roomNo} already exists in this hostel`);
      }
      const inUse = r.beds.filter((b) => b.status !== 'RETIRED');
      if (input.capacity !== undefined && input.capacity !== inUse.length) {
        if (input.capacity > inUse.length) {
          // Re-use retired beds first, then add new labels.
          let need = input.capacity - inUse.length;
          for (const b of r.beds.filter((x) => x.status === 'RETIRED')) { if (!need) break; await tx.hostelBed.update({ where: { id: b.id }, data: { status: 'VACANT', blockedReason: null } }); need--; }
          const taken = new Set(r.beds.map((b) => b.bedNo));
          for (let i = 0; need > 0; i++) { const label = bedLabel(i, Math.max(input.capacity, r.beds.length + need)); if (taken.has(label)) continue; await tx.hostelBed.create({ data: { tenantId: auth.tenantId!, roomId, bedNo: label } }); taken.add(label); need--; }
        } else {
          const spare = inUse.filter((b) => b.status === 'VACANT' || b.status === 'BLOCKED').reverse();
          const drop = inUse.length - input.capacity;
          if (spare.length < drop) throw Conflict('beds-occupied', `Only ${spare.length} bed(s) are empty — the room cannot have fewer than ${inUse.length - spare.length}`);
          for (const b of spare.slice(0, drop)) await tx.hostelBed.update({ where: { id: b.id }, data: { status: 'RETIRED', blockedReason: 'Room capacity reduced' } });
        }
      }
      if (input.status && input.status !== 'AVAILABLE' && inUse.some((b) => b.status === 'OCCUPIED' || b.status === 'RESERVED') && input.status === 'BLOCKED') {
        throw Conflict('room-in-use', 'Students stay in this room — move them before blocking it');
      }
      const after = await tx.hostelRoom.update({ where: { id: roomId }, data: { ...input } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'UPDATE', entityType: 'HOSTEL_ROOM', entityId: roomId, oldValues: { ...r, beds: undefined }, newValues: input }, client);
      return { ...after, feeAmount: money(after.feeAmount) };
    });
  }

  /** Blocks or frees an empty bed (e.g. broken cot). */
  setBed(bedId: string, status: 'VACANT' | 'BLOCKED', reason: string | null | undefined, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const b = await tx.hostelBed.findUnique({ where: { id: bedId }, include: { room: { select: { hostelId: true, roomNo: true } } } });
      if (!b) throw NotFound('Bed');
      const h = await this.hostelOf(tx, b.room.hostelId, auth, MANAGE);
      if (!['VACANT', 'BLOCKED'].includes(b.status)) throw Conflict('bed-in-use', 'A student has this bed');
      const after = await tx.hostelBed.update({ where: { id: bedId }, data: { status, blockedReason: status === 'BLOCKED' ? reason ?? null : null } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'STATUS_CHANGE', entityType: 'HOSTEL_BED', entityId: bedId, oldValues: { status: b.status }, newValues: { status, reason } }, client);
      return after;
    });
  }

  /** Replaces the room's inventory list (matched by id; items left out are retired, history kept). */
  saveInventory(roomId: string, input: InventoryInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.hostelRoom.findUnique({ where: { id: roomId }, select: { id: true, hostelId: true, roomNo: true } });
      if (!r) throw NotFound('Room');
      const h = await this.hostelOf(tx, r.hostelId, auth, MANAGE);
      const before = await tx.roomInventoryItem.findMany({ where: { roomId, status: 'ACTIVE' } });
      const keep = new Set(input.items.map((i) => i.id).filter(Boolean));
      for (const i of input.items) if (i.id && !before.some((b) => b.id === i.id)) throw NotFound('Item');
      for (const b of before) if (!keep.has(b.id)) await tx.roomInventoryItem.update({ where: { id: b.id }, data: { status: 'INACTIVE' } });
      for (const i of input.items) {
        const data = { itemName: i.itemName, quantity: i.quantity, unitCost: i.unitCost };
        if (i.id) await tx.roomInventoryItem.update({ where: { id: i.id }, data });
        else await tx.roomInventoryItem.create({ data: { ...data, tenantId: auth.tenantId!, roomId } });
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: h.campusId, action: 'UPDATE', entityType: 'ROOM_INVENTORY', entityId: roomId, oldValues: before.map((b) => `${b.quantity} × ${b.itemName}`), newValues: input.items.map((i) => `${i.quantity} × ${i.itemName}`) }, client);
      return (await tx.roomInventoryItem.findMany({ where: { roomId, status: 'ACTIVE' }, orderBy: { itemName: 'asc' } })).map((i) => ({ ...i, unitCost: money(i.unitCost) }));
    });
  }
}
