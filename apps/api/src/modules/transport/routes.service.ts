import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS, RouteInput, SaveStopsInput, UpdateRouteInput, fromPaise, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { TransportFleetService } from './fleet.service';

const MANAGE = PERMISSIONS.TRANSPORT_MANAGE;
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Students currently on each route (pickup or drop). */
export async function studentsOnRoutes(tx: Tx, routeIds: string[]) {
  if (!routeIds.length) return new Map<string, number>();
  const rows = await tx.$queryRaw<{ route_id: string; n: number }[]>`
    SELECT s.route_id, count(DISTINCT st.student_id)::int AS n
      FROM student_transport st JOIN route_stops s ON s.id = st.route_stop_id
     WHERE st.status = 'ACTIVE' AND s.route_id = ANY(${routeIds}::uuid[])
     GROUP BY s.route_id`;
  return new Map(rows.map((r) => [r.route_id, r.n]));
}

/**
 * Routes and stops (M6.2). A route runs on one vehicle with a driver (and an attendant) of its own
 * campus; stops are kept in pickup order with times, distance and the stop's yearly fee. Seats used
 * on a route = students currently assigned to its stops.
 */
@Injectable()
export class TransportRoutesService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly fleet: TransportFleetService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  routes(auth: AuthContext, campusId?: string) {
    const s = this.fleet.scope(auth);
    if (campusId && !canAccessCampus(s, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.transportRoute.findMany({
        where: campusId ? { campusId } : s.all ? {} : { campusId: { in: s.campusIds } },
        orderBy: [{ status: 'asc' }, { routeNo: 'asc' }],
        include: {
          vehicle: { select: { id: true, vehicleNo: true, seatingCapacity: true, status: true } },
          stops: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { stopName: true, pickupTime: true } },
        },
      });
      const crewIds = [...new Set(rows.flatMap((r) => [r.driverId, r.attendantId]).filter((x): x is string => !!x))];
      const crew = await this.crewNames(tx, crewIds);
      const used = await studentsOnRoutes(tx, rows.map((r) => r.id));
      return rows.map(({ stops, ...r }) => ({
        ...r,
        driver: r.driverId ? crew.get(r.driverId) ?? null : null,
        attendant: r.attendantId ? crew.get(r.attendantId) ?? null : null,
        stopCount: stops.length,
        firstStop: stops[0]?.stopName ?? null, lastStop: stops.at(-1)?.stopName ?? null, startsAt: stops[0]?.pickupTime ?? null,
        seatsUsed: used.get(r.id) ?? 0,
      }));
    });
  }

  private async crewNames(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, { id: string; name: string; phone: string | null; role: string }>();
    const rows = await tx.$queryRaw<{ id: string; name: string; phone: string | null; role: string }[]>`
      SELECT c.id, trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS name, e.phone, c.role
        FROM transport_crew c JOIN employees e ON e.id = c.employee_id WHERE c.id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r]));
  }

  async route(id: string, auth: AuthContext) {
    const s = this.fleet.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.transportRoute.findUnique({
        where: { id },
        include: { vehicle: { select: { id: true, vehicleNo: true, seatingCapacity: true, status: true, vehicleType: true } }, stops: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' } } },
      });
      if (!r || !canAccessCampus(s, r.campusId)) throw NotFound('Route');
      const crew = await this.crewNames(tx, [r.driverId, r.attendantId].filter((x): x is string => !!x));
      const perStop = await tx.studentTransport.groupBy({ by: ['routeStopId'], where: { status: 'ACTIVE', routeStopId: { in: r.stops.map((x) => x.id) } }, _count: true });
      const used = await studentsOnRoutes(tx, [r.id]);
      return {
        ...r,
        driver: r.driverId ? crew.get(r.driverId) ?? null : null,
        attendant: r.attendantId ? crew.get(r.attendantId) ?? null : null,
        seatsUsed: used.get(r.id) ?? 0,
        stops: r.stops.map((x) => ({
          ...x, distanceKm: num(x.distanceKm), latitude: num(x.latitude), longitude: num(x.longitude), feeAmount: fromPaise(toPaise(String(x.feeAmount))),
          students: perStop.find((p) => p.routeStopId === x.id)?._count ?? 0,
        })),
      };
    });
  }

  /** Vehicle and crew must belong to the route's campus and be in service. */
  private async checkParts(tx: Tx, campusId: string, p: { vehicleId?: string | null; driverId?: string | null; attendantId?: string | null }, routeId?: string) {
    if (p.vehicleId) {
      const v = await tx.vehicle.findUnique({ where: { id: p.vehicleId }, select: { campusId: true, status: true, seatingCapacity: true, vehicleNo: true } });
      if (!v || v.campusId !== campusId) throw unprocessable('vehicle-other-campus', 'Choose a vehicle of this campus', 'vehicleId');
      if (v.status === 'INACTIVE') throw unprocessable('vehicle-inactive', `${v.vehicleNo} is out of service`, 'vehicleId');
      if (routeId) {
        const used = (await studentsOnRoutes(tx, [routeId])).get(routeId) ?? 0;
        if (used > v.seatingCapacity) throw unprocessable('vehicle-too-small', `${used} students travel on this route — ${v.vehicleNo} has only ${v.seatingCapacity} seats`, 'vehicleId');
      }
    }
    for (const [field, id, roles] of [['driverId', p.driverId, ['DRIVER']], ['attendantId', p.attendantId, ['ATTENDANT', 'CONDUCTOR']]] as const) {
      if (!id) continue;
      const rows = await tx.$queryRaw<{ role: string; status: string; campus_id: string }[]>`
        SELECT c.role, c.status, e.campus_id FROM transport_crew c JOIN employees e ON e.id = c.employee_id WHERE c.id = ${id}::uuid`;
      const c = rows[0];
      if (!c || c.campus_id !== campusId || c.status !== 'ACTIVE' || !(roles as readonly string[]).includes(c.role)) {
        throw unprocessable('crew-invalid', field === 'driverId' ? 'Choose a driver of this campus' : 'Choose an attendant or conductor of this campus', field);
      }
    }
  }

  createRoute(input: RouteInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.fleet.scope(auth, MANAGE), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.transportRoute.findUnique({ where: { tenantId_campusId_routeNo: { tenantId: auth.tenantId!, campusId: input.campusId, routeNo: input.routeNo } }, select: { id: true } })) {
        throw Conflict('route-no-taken', `Route ${input.routeNo} already exists on this campus`);
      }
      await this.checkParts(tx, input.campusId, input);
      const r = await tx.transportRoute.create({ data: { ...input, vehicleId: input.vehicleId ?? null, driverId: input.driverId ?? null, attendantId: input.attendantId ?? null, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'CREATE', entityType: 'TRANSPORT_ROUTE', entityId: r.id, newValues: input }, client);
      return r;
    });
  }

  updateRoute(id: string, input: UpdateRouteInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.transportRoute.findUnique({ where: { id } });
      if (!r || !canAccessCampus(this.fleet.scope(auth, MANAGE), r.campusId)) throw NotFound('Route');
      if (input.routeNo && input.routeNo !== r.routeNo && (await tx.transportRoute.findUnique({ where: { tenantId_campusId_routeNo: { tenantId: auth.tenantId!, campusId: r.campusId, routeNo: input.routeNo } }, select: { id: true } }))) {
        throw Conflict('route-no-taken', `Route ${input.routeNo} already exists on this campus`);
      }
      await this.checkParts(tx, r.campusId, { vehicleId: input.vehicleId, driverId: input.driverId, attendantId: input.attendantId }, id);
      if (input.status === 'INACTIVE' && ((await studentsOnRoutes(tx, [id])).get(id) ?? 0) > 0) throw Conflict('route-in-use', 'Students still travel on this route — move them first');
      const after = await tx.transportRoute.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'TRANSPORT_ROUTE', entityId: id, oldValues: r, newValues: input }, client);
      return after;
    });
  }

  /** Replaces the stop list (pickup order). Stops are matched by id; one left out is retired if no student uses it. */
  async saveStops(routeId: string, input: SaveStopsInput, auth: AuthContext, client: ClientInfo) {
    await this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.transportRoute.findUnique({ where: { id: routeId }, select: { id: true, campusId: true, routeNo: true } });
      if (!r || !canAccessCampus(this.fleet.scope(auth, MANAGE), r.campusId)) throw NotFound('Route');
      const before = await tx.routeStop.findMany({ where: { routeId, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } });
      const keep = new Set(input.stops.map((s) => s.id).filter(Boolean));
      for (const s of input.stops) if (s.id && !before.some((b) => b.id === s.id)) throw NotFound('Stop');
      for (const b of before) {
        if (keep.has(b.id)) continue;
        if (await tx.studentTransport.count({ where: { routeStopId: b.id, status: 'ACTIVE' } })) throw Conflict('stop-in-use', `Students board at ${b.stopName} — move them before removing the stop`);
        await tx.routeStop.update({ where: { id: b.id }, data: { status: 'INACTIVE' } });
      }
      for (const [i, s] of input.stops.entries()) {
        const data = {
          stopName: s.stopName, sequence: i + 1, pickupTime: s.pickupTime ?? null, dropTime: s.dropTime ?? null, distanceKm: s.distanceKm ?? null,
          feeAmount: s.feeAmount, latitude: s.latitude ?? null, longitude: s.longitude ?? null,
        };
        if (s.id) await tx.routeStop.update({ where: { id: s.id }, data });
        else await tx.routeStop.create({ data: { ...data, tenantId: auth.tenantId!, routeId } });
      }
      await this.audit.log(tx, {
        tenantId: auth.tenantId!, userId: auth.userId, campusId: r.campusId, action: 'UPDATE', entityType: 'ROUTE_STOPS', entityId: routeId,
        oldValues: before.map((b) => `${b.stopName} ${b.pickupTime ?? ''} ₹${b.feeAmount}`), newValues: input.stops.map((s) => `${s.stopName} ${s.pickupTime ?? ''} ₹${s.feeAmount}`),
      }, client);
    });
    return (await this.route(routeId, auth)).stops;
  }
}
