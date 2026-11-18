import { z } from 'zod';
import { toPaise } from './fees';

/** Transport (Phase 6). Basic for v1: no GPS — live location shows "Coming soon". */

export const VEHICLE_TYPES = ['BUS', 'MINI_BUS', 'VAN', 'CAR'] as const;
export const VEHICLE_OWNERSHIP = ['OWN', 'HIRED'] as const;
export const VEHICLE_STATUSES = ['ACTIVE', 'UNDER_REPAIR', 'INACTIVE'] as const;
export const VEHICLE_DOC_TYPES = ['RC', 'INSURANCE', 'FITNESS', 'PERMIT', 'PUC', 'TAX'] as const;
export const CREW_ROLES = ['DRIVER', 'ATTENDANT', 'CONDUCTOR'] as const;
export const ROUTE_SHIFTS = ['MORNING', 'EVENING', 'BOTH'] as const;
export const PICKUP_DROP = ['BOTH', 'PICKUP', 'DROP'] as const;
/** Days before a document's expiry when the transport team is alerted. */
export const DOC_ALERT_DAYS = [30, 15, 7] as const;

const isoDate = z.string().date();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v), 'Enter an amount like 1500 or 1500.50');

/** Vehicle numbers are kept in one form: capitals, no spaces or dashes (KA01AB1234). */
export const normaliseVehicleNo = (v: string) => v.toUpperCase().replace(/[\s-]/g, '');

// ───────────── M6.1 Vehicles, documents & crew ─────────────

export const vehicleSchema = z.object({
  campusId: z.string().uuid(),
  vehicleNo: z.string().trim().min(4).max(20).transform(normaliseVehicleNo).refine((v) => /^[A-Z0-9]{4,15}$/.test(v), 'Letters and numbers only, e.g. KA01AB1234'),
  vehicleType: z.enum(VEHICLE_TYPES),
  makeModel: optText(100),
  seatingCapacity: z.coerce.number().int().min(1).max(120),
  ownership: z.enum(VEHICLE_OWNERSHIP),
  ownerName: optText(150),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;
export const updateVehicleSchema = vehicleSchema.omit({ campusId: true }).partial().extend({ status: z.enum(VEHICLE_STATUSES).optional() });
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleDocSchema = z
  .object({
    docType: z.enum(VEHICLE_DOC_TYPES),
    docNo: z.string().trim().min(2).max(50),
    validFrom: isoDate.optional().nullable(),
    validTo: isoDate,
    fileId: z.string().uuid().optional().nullable(),
  })
  .refine((v) => !v.validFrom || v.validFrom <= v.validTo, { message: 'The expiry date is before the start date', path: ['validTo'] });
export type VehicleDocInput = z.infer<typeof vehicleDocSchema>;

export const crewSchema = z.object({
  employeeId: z.string().uuid(),
  role: z.enum(CREW_ROLES),
  licenseNo: optText(30),
  licenseExpiry: isoDate.optional().nullable(),
  badgeNo: optText(30),
}).refine((v) => v.role !== 'DRIVER' || (!!v.licenseNo && !!v.licenseExpiry), { message: 'A driver needs a licence number and expiry date', path: ['licenseNo'] });
export type CrewInput = z.infer<typeof crewSchema>;
export const updateCrewSchema = z.object({
  role: z.enum(CREW_ROLES).optional(),
  licenseNo: optText(30),
  licenseExpiry: isoDate.optional().nullable(),
  badgeNo: optText(30),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateCrewInput = z.infer<typeof updateCrewSchema>;

// ───────────── M6.2 Routes & stops ─────────────

export const stopSchema = z.object({
  /** Existing stop (kept, so students stay on it); omit for a new stop. */
  id: z.string().uuid().optional(),
  stopName: z.string().trim().min(2).max(100),
  pickupTime: time.optional().nullable(),
  dropTime: time.optional().nullable(),
  distanceKm: z.coerce.number().min(0).max(500).optional().nullable(),
  /** Yearly transport fee for this stop. */
  feeAmount: money.refine((v) => toPaise(v) >= 0, 'Enter the fee'),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
});
export type StopInput = z.infer<typeof stopSchema>;

export const routeSchema = z.object({
  campusId: z.string().uuid(),
  routeNo: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(100),
  vehicleId: z.string().uuid().optional().nullable(),
  driverId: z.string().uuid().optional().nullable(),
  attendantId: z.string().uuid().optional().nullable(),
  shift: z.enum(ROUTE_SHIFTS),
});
export type RouteInput = z.infer<typeof routeSchema>;
export const updateRouteSchema = routeSchema.omit({ campusId: true }).partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

/** The whole stop list in order (pickup order). Stops left out are retired if no student uses them. */
export const saveStopsSchema = z.object({ stops: z.array(stopSchema).min(1).max(80) })
  .refine((v) => new Set(v.stops.map((s) => s.stopName.toLowerCase())).size === v.stops.length, { message: 'Two stops have the same name', path: ['stops'] });
export type SaveStopsInput = z.infer<typeof saveStopsSchema>;

// ───────────── M6.3 Students on buses ─────────────

export const assignTransportSchema = z.object({
  studentId: z.string().uuid(),
  routeStopId: z.string().uuid(),
  pickupDrop: z.enum(PICKUP_DROP).default('BOTH'),
  startDate: isoDate,
  /** Put the transport fee on the student's bills (prorated by the months left in the year). */
  bill: z.boolean().default(true),
});
export type AssignTransportInput = z.infer<typeof assignTransportSchema>;

export const stopTransportSchema = z.object({
  endDate: isoDate,
  reason: z.string().trim().min(3).max(300),
});
export type StopTransportInput = z.infer<typeof stopTransportSchema>;

/**
 * Transport fee for a part year: the stop's yearly fee × whole months from the start month to the
 * last month of the academic year ÷ months in the year, rounded to the rupee. Starting in the
 * first month bills the full fee.
 */
export function proratedTransportFee(yearlyPaise: number, yearStart: string, yearEnd: string, startDate: string): number {
  const months = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7))) + 1;
  const total = months(yearStart, yearEnd);
  const from = startDate < yearStart ? yearStart : startDate;
  const left = Math.max(0, Math.min(total, months(from, yearEnd)));
  return Math.round((yearlyPaise * left) / total / 100) * 100;
}
