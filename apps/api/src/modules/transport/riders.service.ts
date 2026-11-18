import { HttpStatus, Injectable } from '@nestjs/common';
import { AssignTransportInput, PERMISSIONS, StopTransportInput, formatINR, fromPaise, proratedTransportFee, toPaise } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { FeeBillingService } from '../fees/billing.service';
import { TransportFleetService } from './fleet.service';
import { studentsOnRoutes } from './routes.service';

const ASSIGN = PERMISSIONS.TRANSPORT_ASSIGN;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const pretty = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Students on buses (M6.3). A student boards at one stop per academic year; a route never carries
 * more students than its vehicle has seats (checked under a lock, so two people assigning at once
 * cannot over-fill it). The stop's yearly fee is billed for the months left in the year, in the same
 * transaction, through the fee module's own billing — so it shows in the fee account and dues.
 */
@Injectable()
export class TransportRidersService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly fleet: TransportFleetService,
    private readonly billing: FeeBillingService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  assign(input: AssignTransportInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, tenantId: true, campusId: true, firstName: true, lastName: true, admissionNo: true, status: true } });
      if (!s || !canAccessCampus(this.fleet.scope(auth, ASSIGN), s.campusId)) throw NotFound('Student');
      if (s.status !== 'ACTIVE') throw Conflict('student-not-active', 'Only a current student can be put on a bus');
      const stop = await tx.routeStop.findUnique({ where: { id: input.routeStopId }, include: { route: { include: { vehicle: { select: { seatingCapacity: true, vehicleNo: true, status: true } } } } } });
      if (!stop || stop.status !== 'ACTIVE' || stop.route.status !== 'ACTIVE') throw NotFound('Stop');
      if (stop.route.campusId !== s.campusId) throw unprocessable('route-other-campus', 'Choose a route of the student’s campus', 'routeStopId');
      if (!stop.route.vehicle || stop.route.vehicle.status !== 'ACTIVE') throw Conflict('route-no-vehicle', `Route ${stop.route.routeNo} has no vehicle in service`);
      const year = await tx.academicYear.findFirst({ where: { startDate: { lte: day(input.startDate) }, endDate: { gte: day(input.startDate) } }, select: { id: true, name: true, startDate: true, endDate: true, isCurrent: true, status: true } });
      if (!year || year.status === 'CLOSED') throw unprocessable('date-outside-year', 'The start date is not in an open academic year', 'startDate');
      if (input.bill && !year.isCurrent) throw unprocessable('bill-current-year', 'Transport is billed in the current academic year only', 'startDate');

      // One seat at a time per route: lock the route row, then count.
      await tx.$queryRaw`SELECT id FROM transport_routes WHERE id = ${stop.routeId}::uuid FOR UPDATE`;
      if (await tx.studentTransport.findFirst({ where: { studentId: s.id, academicYearId: year.id, status: 'ACTIVE' }, select: { id: true } })) {
        throw Conflict('already-on-bus', `${s.firstName} already has a bus stop for ${year.name} — change the stop instead`);
      }
      const used = (await studentsOnRoutes(tx, [stop.routeId])).get(stop.routeId) ?? 0;
      if (used >= stop.route.vehicle.seatingCapacity) throw Conflict('bus-full', `Route ${stop.route.routeNo} is full (${used} of ${stop.route.vehicle.seatingCapacity} seats on ${stop.route.vehicle.vehicleNo})`);

      let invoiceId: string | null = null;
      let billed: string | null = null;
      if (input.bill) {
        const head = await tx.feeHead.findFirst({ where: { feeType: 'TRANSPORT', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (!head) throw Conflict('no-transport-fee-head', 'Add a fee head of type Transport in Fees → Setup first, or untick "Add the bus fee to the bills"');
        const amount = proratedTransportFee(toPaise(String(stop.feeAmount)), iso(year.startDate)!, iso(year.endDate)!, input.startDate);
        if (amount > 0) {
          const inv = await this.billing.chargeInTx(tx, s, {
            feeHeadId: head.id, amount: fromPaise(amount), dueDate: input.startDate < todayIST() ? todayIST() : input.startDate,
            description: `Bus fee ${year.name} · Route ${stop.route.routeNo}, ${stop.stopName} (from ${pretty(input.startDate)})`,
          }, auth.userId);
          invoiceId = inv.id;
          billed = fromPaise(amount);
        }
      }
      const a = await tx.studentTransport.create({
        data: { tenantId: auth.tenantId!, studentId: s.id, academicYearId: year.id, routeStopId: stop.id, pickupDrop: input.pickupDrop, startDate: day(input.startDate), invoiceId, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'STUDENT_TRANSPORT', entityId: a.id, newValues: { student: s.admissionNo, route: stop.route.routeNo, stop: stop.stopName, startDate: input.startDate, billed } }, client);
      return { ...a, startDate: iso(a.startDate), billed, invoiceId };
    });
  }

  /** Takes a student off the bus from a date (the bill stays; a refund or concession is the office's call). */
  stop(id: string, input: StopTransportInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const a = await tx.studentTransport.findUnique({ where: { id } });
      const s = a && (await tx.student.findUnique({ where: { id: a.studentId }, select: { campusId: true, admissionNo: true } }));
      if (!a || !s || !canAccessCampus(this.fleet.scope(auth, ASSIGN), s.campusId)) throw NotFound('Bus assignment');
      if (a.status !== 'ACTIVE') throw Conflict('already-stopped', 'This student is already off the bus');
      if (input.endDate < iso(a.startDate)!) throw unprocessable('end-before-start', 'The last day is before the first day on the bus', 'endDate');
      const after = await tx.studentTransport.update({ where: { id }, data: { status: 'STOPPED', endDate: day(input.endDate), stopReason: input.reason, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'STATUS_CHANGE', entityType: 'STUDENT_TRANSPORT', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'STOPPED', endDate: input.endDate, reason: input.reason } }, client);
      return { ...after, startDate: iso(after.startDate), endDate: iso(after.endDate) };
    });
  }

  /** Every student on a route, stop by stop in pickup order — the driver's list. */
  async riders(routeId: string, auth: AuthContext) {
    const sc = this.fleet.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const r = await tx.transportRoute.findUnique({ where: { id: routeId }, select: { id: true, campusId: true, routeNo: true, name: true } });
      if (!r || !canAccessCampus(sc, r.campusId)) throw NotFound('Route');
      const rows = await tx.$queryRaw<{ id: string; studentId: string; firstName: string; lastName: string | null; admissionNo: string; pickupDrop: string; startDate: Date; stopId: string; stopName: string; sequence: number; pickupTime: string | null; dropTime: string | null; className: string | null; sectionName: string | null; guardianName: string | null; guardianPhone: string | null }[]>`
        SELECT st.id, s.id AS "studentId", s.first_name AS "firstName", s.last_name AS "lastName", s.admission_no AS "admissionNo", st.pickup_drop AS "pickupDrop", st.start_date AS "startDate",
               rs.id AS "stopId", rs.stop_name AS "stopName", rs.sequence, rs.pickup_time AS "pickupTime", rs.drop_time AS "dropTime",
               l.name AS "className", sec.name AS "sectionName", g.name AS "guardianName", g.phone AS "guardianPhone"
          FROM student_transport st
          JOIN route_stops rs ON rs.id = st.route_stop_id
          JOIN students s ON s.id = st.student_id
          LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.academic_year_id = st.academic_year_id AND e.status = 'ACTIVE'
          LEFT JOIN sections sec ON sec.id = e.section_id LEFT JOIN program_levels l ON l.id = sec.program_level_id
          LEFT JOIN LATERAL (SELECT gg.name, gg.phone FROM student_guardians sg JOIN guardians gg ON gg.id = sg.guardian_id WHERE sg.student_id = s.id ORDER BY sg.is_primary DESC LIMIT 1) g ON true
         WHERE rs.route_id = ${routeId}::uuid AND st.status = 'ACTIVE'
         ORDER BY rs.sequence, s.first_name, s.last_name`;
      return { route: r, riders: rows.map((x) => ({ ...x, name: `${x.firstName} ${x.lastName ?? ''}`.trim(), startDate: iso(x.startDate), className: x.className ? `${x.className} – ${x.sectionName}` : null })) };
    });
  }

  /** A student's bus history (newest first) — for the student profile and the parent app. */
  forStudent(tx: Tx, studentId: string) {
    return tx.$queryRaw<{ id: string; status: string; pickupDrop: string; startDate: Date; endDate: Date | null; stopName: string; pickupTime: string | null; dropTime: string | null; routeNo: string; routeName: string; vehicleNo: string | null; driverName: string | null; driverPhone: string | null; yearName: string }[]>`
      SELECT st.id, st.status, st.pickup_drop AS "pickupDrop", st.start_date AS "startDate", st.end_date AS "endDate",
             rs.stop_name AS "stopName", rs.pickup_time AS "pickupTime", rs.drop_time AS "dropTime", r.route_no AS "routeNo", r.name AS "routeName",
             v.vehicle_no AS "vehicleNo", trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS "driverName", e.phone AS "driverPhone", y.name AS "yearName"
        FROM student_transport st
        JOIN route_stops rs ON rs.id = st.route_stop_id JOIN transport_routes r ON r.id = rs.route_id
        JOIN academic_years y ON y.id = st.academic_year_id
        LEFT JOIN vehicles v ON v.id = r.vehicle_id
        LEFT JOIN transport_crew c ON c.id = r.driver_id LEFT JOIN employees e ON e.id = c.employee_id
       WHERE st.student_id = ${studentId}::uuid
       ORDER BY st.created_at DESC`;
  }

  async student(studentId: string, auth: AuthContext) {
    const sc = this.fleet.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await tx.student.findUnique({ where: { id: studentId }, select: { campusId: true } });
      if (!s || !canAccessCampus(sc, s.campusId)) throw NotFound('Student');
      return (await this.forStudent(tx, studentId)).map((x) => ({ ...x, startDate: iso(x.startDate), endDate: iso(x.endDate) }));
    });
  }

  /** Routes with stops and free seats — for the "put on a bus" dialog. */
  async options(auth: AuthContext, campusId: string) {
    if (!canAccessCampus(this.fleet.scope(auth, ASSIGN), campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const routes = await tx.transportRoute.findMany({
        where: { campusId, status: 'ACTIVE', vehicleId: { not: null } },
        orderBy: { routeNo: 'asc' },
        include: { vehicle: { select: { seatingCapacity: true, vehicleNo: true } }, stops: { where: { status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, stopName: true, pickupTime: true, dropTime: true, feeAmount: true } } },
      });
      const used = await studentsOnRoutes(tx, routes.map((r) => r.id));
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { name: true, startDate: true, endDate: true } });
      return {
        year: year ? { name: year.name, startDate: iso(year.startDate), endDate: iso(year.endDate) } : null,
        hasFeeHead: !!(await tx.feeHead.findFirst({ where: { feeType: 'TRANSPORT', status: 'ACTIVE' }, select: { id: true } })),
        routes: routes.map((r) => ({
          id: r.id, routeNo: r.routeNo, name: r.name, vehicleNo: r.vehicle?.vehicleNo ?? null, seats: r.vehicle?.seatingCapacity ?? 0, seatsUsed: used.get(r.id) ?? 0,
          stops: r.stops.map((x) => ({ ...x, feeAmount: fromPaise(toPaise(String(x.feeAmount))), feeLabel: formatINR(toPaise(String(x.feeAmount))) })),
        })),
      };
    });
  }
}
