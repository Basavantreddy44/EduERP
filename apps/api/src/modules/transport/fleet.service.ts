import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CrewInput, DOC_ALERT_DAYS, PERMISSIONS, PermissionCode, UpdateCrewInput, UpdateVehicleInput, VEHICLE_DOC_TYPES, VehicleDocInput, VehicleInput,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';

const READ = PERMISSIONS.TRANSPORT_READ;
const MANAGE = PERMISSIONS.TRANSPORT_MANAGE;
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const daysUntil = (d: string, from = todayIST()) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const DOC_LABEL: Record<string, string> = { RC: 'Registration (RC)', INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PERMIT: 'Permit', PUC: 'Pollution (PUC)', TAX: 'Road tax' };
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/** Where a document or licence stands today. */
export type ExpiryState = 'OK' | 'DUE_SOON' | 'EXPIRED' | 'MISSING';
export const expiryState = (validTo: string | null): ExpiryState => (!validTo ? 'MISSING' : daysUntil(validTo) < 0 ? 'EXPIRED' : daysUntil(validTo) <= DOC_ALERT_DAYS[0] ? 'DUE_SOON' : 'OK');

/**
 * Transport fleet (M6.1): vehicles with their documents (the newest per type is the one in force),
 * and the crew — drivers, attendants and conductors, always current staff members. A daily pass
 * alerts the transport team 30, 15 and 7 days before a document or driving licence expires.
 */
@Injectable()
export class TransportFleetService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  scope(auth: AuthContext, code: PermissionCode = READ): CampusScope {
    return scopeFor(auth, code) ?? { all: false, campusIds: [] };
  }
  private inScope(s: CampusScope) {
    return s.all ? {} : { campusId: { in: s.campusIds } };
  }

  // ───────────── Vehicles ─────────────

  /** Vehicles with the document in force per type, seats used and the routes they run. */
  vehicles(auth: AuthContext, campusId?: string) {
    const s = this.scope(auth);
    if (campusId && !canAccessCampus(s, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.vehicle.findMany({
        where: { ...(campusId ? { campusId } : this.inScope(s)) },
        orderBy: [{ status: 'asc' }, { vehicleNo: 'asc' }],
        include: { documents: { orderBy: [{ validTo: 'desc' }, { createdAt: 'desc' }] }, routes: { where: { status: 'ACTIVE' }, select: { id: true, routeNo: true, name: true } } },
      });
      const seats = await this.seatsUsed(tx, rows.map((v) => v.id));
      return rows.map(({ documents, ...v }) => {
        const current = VEHICLE_DOC_TYPES.map((t) => {
          const d = documents.find((x) => x.docType === t);
          return { docType: t, id: d?.id ?? null, docNo: d?.docNo ?? null, validTo: iso(d?.validTo ?? null), state: expiryState(iso(d?.validTo ?? null)), daysLeft: d ? daysUntil(iso(d.validTo)!) : null };
        });
        return { ...v, seatsUsed: seats.get(v.id) ?? 0, documents: current, attention: current.filter((d) => d.state === 'EXPIRED' || d.state === 'DUE_SOON').length };
      });
    });
  }

  /** Seats used on each vehicle: students on its busiest route (each route is checked against the seats). */
  async seatsUsed(tx: Tx, vehicleIds: string[]) {
    if (!vehicleIds.length) return new Map<string, number>();
    const rows = await tx.$queryRaw<{ vehicle_id: string; n: number }[]>`
      SELECT vehicle_id, max(n)::int AS n FROM (
        SELECT r.vehicle_id, r.id, count(DISTINCT st.student_id) AS n
          FROM student_transport st JOIN route_stops s ON s.id = st.route_stop_id JOIN transport_routes r ON r.id = s.route_id
         WHERE st.status = 'ACTIVE' AND r.vehicle_id = ANY(${vehicleIds}::uuid[])
         GROUP BY r.vehicle_id, r.id) x
       GROUP BY vehicle_id`;
    return new Map(rows.map((r) => [r.vehicle_id, r.n]));
  }

  async vehicle(id: string, auth: AuthContext) {
    const s = this.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.vehicle.findUnique({ where: { id }, include: { documents: { orderBy: [{ docType: 'asc' }, { validTo: 'desc' }] }, routes: { select: { id: true, routeNo: true, name: true, status: true } } } });
      if (!v || !canAccessCampus(s, v.campusId)) throw NotFound('Vehicle');
      const seats = await this.seatsUsed(tx, [v.id]);
      return { ...v, seatsUsed: seats.get(v.id) ?? 0, documents: v.documents.map((d) => ({ ...d, validFrom: iso(d.validFrom), validTo: iso(d.validTo), state: expiryState(iso(d.validTo)) })) };
    });
  }

  createVehicle(input: VehicleInput, auth: AuthContext, client: ClientInfo) {
    if (!canAccessCampus(this.scope(auth, MANAGE), input.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      if (await tx.vehicle.findUnique({ where: { tenantId_vehicleNo: { tenantId: auth.tenantId!, vehicleNo: input.vehicleNo } }, select: { id: true } })) {
        throw Conflict('vehicle-no-taken', `Vehicle ${input.vehicleNo} is already added`);
      }
      const v = await tx.vehicle.create({ data: { ...input, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: v.campusId, action: 'CREATE', entityType: 'VEHICLE', entityId: v.id, newValues: input }, client);
      return v;
    });
  }

  updateVehicle(id: string, input: UpdateVehicleInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.vehicle.findUnique({ where: { id } });
      if (!v || !canAccessCampus(this.scope(auth, MANAGE), v.campusId)) throw NotFound('Vehicle');
      if (input.vehicleNo && input.vehicleNo !== v.vehicleNo && (await tx.vehicle.findUnique({ where: { tenantId_vehicleNo: { tenantId: auth.tenantId!, vehicleNo: input.vehicleNo } }, select: { id: true } }))) {
        throw Conflict('vehicle-no-taken', `Vehicle ${input.vehicleNo} is already added`);
      }
      if (input.seatingCapacity !== undefined) {
        const used = (await this.seatsUsed(tx, [id])).get(id) ?? 0;
        if (input.seatingCapacity < used) throw unprocessable('seats-below-students', `${used} students already travel on this vehicle — the seats cannot be fewer`, 'seatingCapacity');
      }
      const after = await tx.vehicle.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: v.campusId, action: 'UPDATE', entityType: 'VEHICLE', entityId: id, oldValues: v, newValues: input }, client);
      return after;
    });
  }

  addDocument(vehicleId: string, input: VehicleDocInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const v = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, campusId: true, vehicleNo: true } });
      if (!v || !canAccessCampus(this.scope(auth, MANAGE), v.campusId)) throw NotFound('Vehicle');
      if (input.fileId && !(await tx.fileObject.findUnique({ where: { id: input.fileId }, select: { id: true } }))) throw NotFound('File');
      const d = await tx.vehicleDocument.create({
        data: { tenantId: auth.tenantId!, vehicleId, docType: input.docType, docNo: input.docNo, validFrom: input.validFrom ? day(input.validFrom) : null, validTo: day(input.validTo), fileId: input.fileId ?? null, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: v.campusId, action: 'CREATE', entityType: 'VEHICLE_DOCUMENT', entityId: d.id, newValues: { vehicleNo: v.vehicleNo, ...input } }, client);
      return { ...d, validFrom: iso(d.validFrom), validTo: iso(d.validTo), state: expiryState(iso(d.validTo)) };
    });
  }

  // ───────────── Crew ─────────────

  crew(auth: AuthContext, campusId?: string) {
    const s = this.scope(auth);
    if (campusId && !canAccessCampus(s, campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; employeeId: string; role: string; licenseNo: string | null; licenseExpiry: Date | null; badgeNo: string | null; status: string; firstName: string; lastName: string | null; employeeCode: string; phone: string | null; campusId: string; staffStatus: string }[]>`
        SELECT c.id, c.employee_id AS "employeeId", c.role, c.license_no AS "licenseNo", c.license_expiry AS "licenseExpiry", c.badge_no AS "badgeNo", c.status,
               e.first_name AS "firstName", e.last_name AS "lastName", e.employee_code AS "employeeCode", e.phone, e.campus_id AS "campusId", e.status AS "staffStatus"
          FROM transport_crew c JOIN employees e ON e.id = c.employee_id
         WHERE (${campusId ?? null}::uuid IS NULL OR e.campus_id = ${campusId ?? null}::uuid)
           AND (${s.all} OR e.campus_id = ANY(${s.all ? [] : s.campusIds}::uuid[]))
         ORDER BY c.status, c.role, e.first_name`;
      const routes = await tx.transportRoute.findMany({ where: { status: 'ACTIVE', OR: [{ driverId: { in: rows.map((r) => r.id) } }, { attendantId: { in: rows.map((r) => r.id) } }] }, select: { routeNo: true, driverId: true, attendantId: true } });
      return rows.map((r) => {
        const expiry = iso(r.licenseExpiry);
        return {
          ...r, licenseExpiry: expiry, name: `${r.firstName} ${r.lastName ?? ''}`.trim(),
          licenseState: r.role === 'DRIVER' ? expiryState(expiry) : null,
          routes: routes.filter((x) => x.driverId === r.id || x.attendantId === r.id).map((x) => x.routeNo),
        };
      });
    });
  }

  addCrew(input: CrewInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const e = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, campusId: true, status: true, firstName: true, lastName: true } });
      if (!e || !canAccessCampus(this.scope(auth, MANAGE), e.campusId)) throw NotFound('Staff member');
      if (!['ACTIVE', 'ON_LEAVE'].includes(e.status)) throw Conflict('staff-left', 'This staff member has left');
      if (await tx.transportCrew.findUnique({ where: { tenantId_employeeId: { tenantId: auth.tenantId!, employeeId: e.id } }, select: { id: true } })) {
        throw Conflict('already-crew', `${e.firstName} is already in the transport crew`);
      }
      const c = await tx.transportCrew.create({
        data: { tenantId: auth.tenantId!, employeeId: e.id, role: input.role, licenseNo: input.licenseNo ?? null, licenseExpiry: input.licenseExpiry ? day(input.licenseExpiry) : null, badgeNo: input.badgeNo ?? null, createdBy: auth.userId },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'CREATE', entityType: 'TRANSPORT_CREW', entityId: c.id, newValues: input }, client);
      return c;
    });
  }

  updateCrew(id: string, input: UpdateCrewInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.transportCrew.findUnique({ where: { id } });
      const e = c && (await tx.employee.findUnique({ where: { id: c.employeeId }, select: { campusId: true } }));
      if (!c || !e || !canAccessCampus(this.scope(auth, MANAGE), e.campusId)) throw NotFound('Crew member');
      const role = input.role ?? c.role;
      const licenseNo = input.licenseNo === undefined ? c.licenseNo : input.licenseNo;
      const licenseExpiry = input.licenseExpiry === undefined ? iso(c.licenseExpiry) : input.licenseExpiry;
      if (role === 'DRIVER' && (!licenseNo || !licenseExpiry)) throw unprocessable('licence-required', 'A driver needs a licence number and expiry date', 'licenseNo');
      if (input.status === 'INACTIVE' && (await tx.transportRoute.count({ where: { status: 'ACTIVE', OR: [{ driverId: id }, { attendantId: id }] } }))) {
        throw Conflict('crew-on-route', 'This person is on an active route — change the route first');
      }
      const after = await tx.transportCrew.update({
        where: { id },
        data: {
          role, licenseNo, licenseExpiry: licenseExpiry ? day(licenseExpiry) : null, badgeNo: input.badgeNo === undefined ? c.badgeNo : input.badgeNo,
          status: input.status ?? c.status, updatedBy: auth.userId,
          // A renewed licence is alerted again from scratch.
          ...(licenseExpiry !== iso(c.licenseExpiry) ? { alertedDays: null } : {}),
        },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: e.campusId, action: 'UPDATE', entityType: 'TRANSPORT_CREW', entityId: id, oldValues: c, newValues: input }, client);
      return after;
    });
  }

  // ───────────── Expiry alerts ─────────────

  /** Documents in force and driving licences that expire within 30 days or have expired. */
  expiring(auth: AuthContext) {
    const s = this.scope(auth);
    return this.db.run(this.ctx(auth), async (tx) => {
      const docs = await this.currentDocs(tx);
      const lic = await this.licences(tx);
      const within = (validTo: string) => daysUntil(validTo) <= DOC_ALERT_DAYS[0];
      return [
        ...docs.filter((d) => canAccessCampus(s, d.campusId) && within(d.validTo)).map((d) => ({ kind: 'DOCUMENT' as const, id: d.id, vehicleId: d.vehicleId, what: DOC_LABEL[d.docType] ?? d.docType, docType: d.docType, whose: d.vehicleNo, validTo: d.validTo, daysLeft: daysUntil(d.validTo) })),
        ...lic.filter((l) => canAccessCampus(s, l.campusId) && within(l.validTo)).map((l) => ({ kind: 'LICENCE' as const, id: l.id, vehicleId: null, what: 'Driving licence', docType: 'LICENCE', whose: l.name, validTo: l.validTo, daysLeft: daysUntil(l.validTo) })),
      ].sort((a, b) => a.daysLeft - b.daysLeft);
    });
  }

  /** The newest document per vehicle and type, for active vehicles. */
  private async currentDocs(tx: Tx) {
    const rows = await tx.$queryRaw<{ id: string; vehicleId: string; docType: string; validTo: Date; alertedDays: number | null; campusId: string; vehicleNo: string }[]>`
      SELECT DISTINCT ON (d.vehicle_id, d.doc_type) d.id, d.vehicle_id AS "vehicleId", d.doc_type AS "docType", d.valid_to AS "validTo", d.alerted_days AS "alertedDays", v.campus_id AS "campusId", v.vehicle_no AS "vehicleNo"
        FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
       WHERE v.status <> 'INACTIVE'
       ORDER BY d.vehicle_id, d.doc_type, d.valid_to DESC, d.created_at DESC`;
    return rows.map((r) => ({ ...r, validTo: iso(r.validTo)! }));
  }

  private async licences(tx: Tx) {
    const rows = await tx.$queryRaw<{ id: string; validTo: Date; alertedDays: number | null; campusId: string; name: string }[]>`
      SELECT c.id, c.license_expiry AS "validTo", c.alerted_days AS "alertedDays", e.campus_id AS "campusId", trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS name
        FROM transport_crew c JOIN employees e ON e.id = c.employee_id
       WHERE c.status = 'ACTIVE' AND c.role = 'DRIVER' AND c.license_expiry IS NOT NULL`;
    return rows.map((r) => ({ ...r, validTo: iso(r.validTo)! }));
  }

  /** People who manage transport for a campus (institution-wide or that campus). */
  private async managers(tx: Tx, campusId: string) {
    const rows = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT ur.user_id FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
        JOIN user_tenants ut ON ut.user_id = ur.user_id AND ut.status = 'ACTIVE'
       WHERE p.code = ${MANAGE} AND (ur.campus_id IS NULL OR ur.campus_id = ${campusId}::uuid)`;
    return rows.map((r) => r.user_id);
  }

  /**
   * One pass for one institution: each document in force and each driver's licence is alerted once
   * at 30, once at 15 and once at 7 days before expiry (a late start sends only the nearest one).
   */
  async alert(tenantId: string, today = todayIST()) {
    return this.db.run({ tenantId, userId: null }, async (tx) => {
      const threshold = (validTo: string) => {
        const left = daysUntil(validTo, today);
        if (left < 0) return null;
        return [...DOC_ALERT_DAYS].reverse().find((t) => left <= t) ?? null;
      };
      let sent = 0;
      const send = async (campusId: string, what: string, whose: string, validTo: string, entityType: string, entityId: string) => {
        const users = await this.managers(tx, campusId);
        await this.notifications.notify(tx, { tenantId, userIds: users, eventCode: 'TRANSPORT_EXPIRY', vars: { what, whose, validTo, days: daysUntil(validTo, today) }, entityType, entityId });
        sent += 1;
      };
      for (const d of await this.currentDocs(tx)) {
        const t = threshold(d.validTo);
        if (t === null || (d.alertedDays !== null && d.alertedDays <= t)) continue;
        await send(d.campusId, DOC_LABEL[d.docType] ?? d.docType, d.vehicleNo, d.validTo, 'VEHICLE_DOCUMENT', d.id);
        await tx.vehicleDocument.update({ where: { id: d.id }, data: { alertedDays: t } });
      }
      for (const l of await this.licences(tx)) {
        const t = threshold(l.validTo);
        if (t === null || (l.alertedDays !== null && l.alertedDays <= t)) continue;
        await send(l.campusId, 'Driving licence', l.name, l.validTo, 'TRANSPORT_CREW', l.id);
        await tx.transportCrew.update({ where: { id: l.id }, data: { alertedDays: t } });
      }
      return sent;
    });
  }

  /** Every institution (worker, daily). */
  async alertAll() {
    const tenants = await this.db.run({ isPlatform: true }, (tx) => tx.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] } }, select: { id: true } }));
    let total = 0;
    for (const t of tenants) {
      const on = await this.db.run({ tenantId: t.id, userId: null }, (tx) => tx.tenantModule.findFirst({ where: { moduleCode: 'TRANSPORT', isEnabled: true }, select: { id: true } }));
      if (on) total += await this.alert(t.id);
    }
    return total;
  }
}

