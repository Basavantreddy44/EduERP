import { z } from 'zod';
import { toPaise } from './fees';

/** Hostel & mess (Phase 7). SMS / WhatsApp alerts and gate devices: Coming soon. */

export const HOSTEL_TYPES = ['BOYS', 'GIRLS', 'STAFF'] as const;
export const ROOM_TYPES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'DORMITORY'] as const;
export const ROOM_STATUSES = ['AVAILABLE', 'MAINTENANCE', 'BLOCKED'] as const;
export const BED_STATUSES = ['VACANT', 'RESERVED', 'OCCUPIED', 'BLOCKED'] as const;
export const ALLOTMENT_STATUSES = ['RESERVED', 'CHECKED_IN', 'VACATED', 'CANCELLED'] as const;
export const ITEM_CONDITIONS = ['GOOD', 'DAMAGED', 'MISSING'] as const;
export const ROLL_STATUSES = ['PRESENT', 'ABSENT', 'ON_OUTPASS', 'ON_LEAVE'] as const;
export const OUTPASS_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'OUT', 'RETURNED', 'LATE_RETURN', 'CANCELLED'] as const;
export const HOME_GOING_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'DEPARTED', 'RETURNED', 'CANCELLED'] as const;
export const MAINTENANCE_CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'FURNITURE', 'CLEANING', 'INTERNET', 'OTHER'] as const;
export const MAINTENANCE_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const MEALS = ['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'] as const;
export const MESS_BILLING = ['FIXED', 'PER_MEAL'] as const;

/** Which students a hostel type takes (student gender codes as stored on the student). */
export const hostelTakes = (hostelType: string, gender: string) =>
  hostelType === 'BOYS' ? gender === 'MALE' : hostelType === 'GIRLS' ? gender === 'FEMALE' : false;

const isoDate = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v), 'Enter an amount like 1500 or 1500.50');
const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');

// ───────────── M7.1 Hostels, rooms & beds ─────────────

export const hostelSchema = z.object({
  campusId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  hostelType: z.enum(HOSTEL_TYPES),
  wardenEmployeeId: z.string().uuid().optional().nullable(),
  /** Caution deposit taken once at allotment (0 = none). */
  depositAmount: money.default('0'),
});
export type HostelInput = z.infer<typeof hostelSchema>;
export const updateHostelSchema = hostelSchema.omit({ campusId: true, hostelType: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateHostelInput = z.infer<typeof updateHostelSchema>;

export const roomSchema = z.object({
  block: optText(30),
  floor: optText(10),
  roomNo: z.string().trim().min(1).max(10),
  roomType: z.enum(ROOM_TYPES),
  capacity: z.coerce.number().int().min(1).max(40),
  isAc: z.boolean().default(false),
  /** Yearly room fee. */
  feeAmount: money.refine((v) => toPaise(v) >= 0, 'Enter the fee'),
});
export type RoomInput = z.infer<typeof roomSchema>;
export const updateRoomSchema = roomSchema.partial().extend({ status: z.enum(ROOM_STATUSES).optional() });
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;

/** Adds several rooms at once: numbers from…to on one floor, all alike. */
export const bulkRoomsSchema = z.object({
  block: optText(30),
  floor: optText(10),
  prefix: z.string().trim().max(5).default(''),
  from: z.coerce.number().int().min(1).max(9999),
  to: z.coerce.number().int().min(1).max(9999),
  roomType: z.enum(ROOM_TYPES),
  capacity: z.coerce.number().int().min(1).max(40),
  isAc: z.boolean().default(false),
  feeAmount: money,
}).refine((v) => v.to >= v.from && v.to - v.from < 100, { message: 'Up to 100 rooms at a time', path: ['to'] });
export type BulkRoomsInput = z.infer<typeof bulkRoomsSchema>;

export const inventorySchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid().optional(),
    itemName: z.string().trim().min(2).max(100),
    quantity: z.coerce.number().int().min(1).max(100),
    unitCost: money,
  })).max(40),
}).refine((v) => new Set(v.items.map((i) => i.itemName.toLowerCase())).size === v.items.length, { message: 'An item is listed twice', path: ['items'] });
export type InventoryInput = z.infer<typeof inventorySchema>;

export const bedStatusSchema = z.object({ status: z.enum(['VACANT', 'BLOCKED']), reason: optText(200) });

// ───────────── M7.2 Allotment, fees & deposit ─────────────

const itemChecks = z.array(z.object({ inventoryItemId: z.string().uuid(), condition: z.enum(ITEM_CONDITIONS), remarks: optText(200) })).max(60);

export const allotSchema = z.object({
  studentId: z.string().uuid(),
  bedId: z.string().uuid(),
  checkInDate: isoDate,
  /** Bill the room fee for the months left, and the hostel's caution deposit once. */
  bill: z.boolean().default(true),
});
export type AllotInput = z.infer<typeof allotSchema>;

export const checkInSchema = z.object({ items: itemChecks });
export type CheckInInput = z.infer<typeof checkInSchema>;

export const vacateSchema = z.object({
  checkOutDate: isoDate,
  /** Condition of each room item at check-out; damaged or missing items become a damage charge (needs approval). */
  items: itemChecks,
  reason: optText(300),
});
export type VacateInput = z.infer<typeof vacateSchema>;

export const roomChangeSchema = z.object({ bedId: z.string().uuid(), date: isoDate, reason: z.string().trim().min(3).max(300) });
export type RoomChangeInput = z.infer<typeof roomChangeSchema>;

// ───────────── M7.3 Daily hostel life ─────────────

export const rollCallQuerySchema = z.object({ hostelId: z.string().uuid(), date: isoDate });
export const saveRollCallSchema = z.object({
  hostelId: z.string().uuid(),
  date: isoDate,
  records: z.array(z.object({ studentId: z.string().uuid(), status: z.enum(ROLL_STATUSES), remarks: optText(200) })).min(1).max(1000)
    .refine((r) => new Set(r.map((x) => x.studentId)).size === r.length, 'A student appears twice'),
});
export type SaveRollCallInput = z.infer<typeof saveRollCallSchema>;

export const outpassSchema = z.object({
  studentId: z.string().uuid(),
  outTime: z.string().datetime({ offset: true }),
  expectedReturn: z.string().datetime({ offset: true }),
  destination: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(3).max(300),
}).refine((v) => Date.parse(v.expectedReturn) > Date.parse(v.outTime), { message: 'The return is before the time out', path: ['expectedReturn'] })
  .refine((v) => Date.parse(v.expectedReturn) - Date.parse(v.outTime) <= 24 * 3_600_000, { message: 'An outpass is for one day at most — use home-going for longer', path: ['expectedReturn'] });
export type OutpassInput = z.infer<typeof outpassSchema>;
export const decisionSchema = z.object({ approve: z.boolean(), remarks: optText(300) });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const homeGoingSchema = z.object({
  studentId: z.string().uuid(),
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().min(3).max(300),
  /** A guardian on record who will collect the student… */
  pickupGuardianId: z.string().uuid().optional().nullable(),
  /** …or someone else (needs the warden's explicit OK). */
  pickupPersonName: optText(150),
  pickupPersonPhone: phone.optional().nullable(),
}).refine((v) => v.toDate >= v.fromDate, { message: 'The return day is before the leaving day', path: ['toDate'] })
  .refine((v) => !!v.pickupGuardianId || (!!v.pickupPersonName && !!v.pickupPersonPhone), { message: 'Choose the guardian who will collect, or enter the person’s name and mobile', path: ['pickupGuardianId'] });
export type HomeGoingInput = z.infer<typeof homeGoingSchema>;

export const visitorSchema = z.object({
  hostelId: z.string().uuid(),
  studentId: z.string().uuid(),
  visitorName: z.string().trim().min(2).max(150),
  relation: z.string().trim().min(2).max(30),
  phone: phone,
});
export type VisitorInput = z.infer<typeof visitorSchema>;

export const maintenanceSchema = z.object({
  hostelId: z.string().uuid(),
  roomId: z.string().uuid().optional().nullable(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  description: z.string().trim().min(5).max(500),
  priority: z.enum(PRIORITIES).default('NORMAL'),
});
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;
export const updateMaintenanceSchema = z.object({
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  assignedToEmployeeId: z.string().uuid().optional().nullable(),
  remarks: optText(300),
});
export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;

// ───────────── M7.4 Mess ─────────────

export const messPlanSchema = z.object({
  campusId: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  mealsIncluded: z.array(z.enum(MEALS)).min(1).max(4).refine((m) => new Set(m).size === m.length, 'A meal is listed twice'),
  billingType: z.enum(MESS_BILLING),
  /** Per month (FIXED) or per meal (PER_MEAL). */
  amount: money,
});
export type MessPlanInput = z.infer<typeof messPlanSchema>;
export const updateMessPlanSchema = messPlanSchema.omit({ campusId: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

export const saveMenuSchema = z.object({
  campusId: z.string().uuid(),
  effectiveFrom: isoDate,
  /** dayOfWeek: 1 = Monday … 7 = Sunday. */
  items: z.array(z.object({ dayOfWeek: z.number().int().min(1).max(7), meal: z.enum(MEALS), items: z.string().trim().min(2).max(500) })).min(1).max(28)
    .refine((v) => new Set(v.map((x) => `${x.dayOfWeek}-${x.meal}`)).size === v.length, 'A meal is listed twice for a day'),
});
export type SaveMenuInput = z.infer<typeof saveMenuSchema>;

export const messSubscribeSchema = z.object({
  studentId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  messPlanId: z.string().uuid(),
  fromDate: isoDate,
  /** FIXED plans: bill the monthly amount for the months left in the year. */
  bill: z.boolean().default(true),
}).refine((v) => !!v.studentId !== !!v.employeeId, { message: 'Choose a student or a staff member', path: ['studentId'] });
export type MessSubscribeInput = z.infer<typeof messSubscribeSchema>;
export const endSubscriptionSchema = z.object({ toDate: isoDate });

/** Whole months from the start month to the year's last month (inclusive). */
export function monthsLeft(yearStart: string, yearEnd: string, from: string): number {
  const months = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
  const start = from < yearStart ? yearStart : from;
  return Math.max(0, Math.min(months(yearStart, yearEnd), months(start, yearEnd)));
}
