/**
 * AC47–AC49 transport (Phase 6): vehicles and crew, expiry alerts once per threshold, routes and
 * stops, students on buses — never more than the seats (also when two people assign at once), one
 * active stop per student per year, the bus fee billed for the months left, the parent sees only
 * their own child's bus; permissions and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, proratedTransportFee } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';
import { TransportFleetService } from '../src/modules/transport/fleet.service';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let yearStart: string;
let yearEnd: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const patch = (path: string, body: unknown, s: Session = A.session) => http().patch(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'BusA');
  B = await createTenant(app, platform, 'BusB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  yearStart = `${shift(-120).slice(0, 7)}-01`;
  const endMonth = new Date(Date.parse(`${yearStart}T00:00:00Z`)); endMonth.setUTCMonth(endMonth.getUTCMonth() + 12); endMonth.setUTCDate(0);
  yearEnd = endMonth.toISOString().slice(0, 10);
  const year = (await post('/academic-years', { name: `${yearStart.slice(0, 4)}-${yearEnd.slice(2, 4)}`, startDate: yearStart, endDate: yearEnd, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 });
  ids.head = (await post('/fees/heads', { name: 'Bus fee', code: 'BUS', feeType: 'TRANSPORT' })).body.id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala'], ['3', 'Chitra'], ['4', 'Dev']]) {
    const r: Record<string, string> = { admissionNo: `T/${n}`, firstName: f, lastName: 'Test', dob: '2016-01-01', gender: 'Girl', admissionDate: yearStart, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: `${f} Father`, parentPhone: `98766000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const [f, c] of [['Raju', main], ['Sunil', main], ['Meena', main], ['Kiran', north]]) {
    ids[f] = (await post('/staff', { campusId: c, firstName: f, gender: 'MALE', employeeType: 'NON_TEACHING', joiningDate: shift(-400) })).body.id;
  }
}, 180_000);
afterAll(() => app?.close());

describe('AC47 vehicles, documents and crew', () => {
  it('vehicle numbers are kept in one form and unique per institution', async () => {
    const v = await post('/transport/vehicles', { campusId: main, vehicleNo: 'ka-01 ab 1234', vehicleType: 'BUS', seatingCapacity: 3, ownership: 'OWN' });
    expect(v.status).toBe(201);
    expect(v.body.vehicleNo).toBe('KA01AB1234');
    ids.bus = v.body.id;
    expect((await post('/transport/vehicles', { campusId: north, vehicleNo: 'KA01AB1234', vehicleType: 'VAN', seatingCapacity: 8, ownership: 'HIRED' })).body.type).toBe('vehicle-no-taken');
    ids.van = (await post('/transport/vehicles', { campusId: north, vehicleNo: 'KA05VN0001', vehicleType: 'VAN', seatingCapacity: 8, ownership: 'HIRED', ownerName: 'Sri Travels' })).body.id;
  });

  it('documents: the newest per type is in force; missing / due soon / expired shown', async () => {
    expect((await post(`/transport/vehicles/${ids.bus}/documents`, { docType: 'INSURANCE', docNo: 'INS-1', validFrom: shift(-370), validTo: shift(-5) })).status).toBe(201);
    let v = (await get('/transport/vehicles')).body.find((x: { id: string }) => x.id === ids.bus);
    expect(v.documents.find((d: { docType: string }) => d.docType === 'INSURANCE')).toMatchObject({ state: 'EXPIRED', docNo: 'INS-1' });
    expect((await post(`/transport/vehicles/${ids.bus}/documents`, { docType: 'INSURANCE', docNo: 'INS-2', validFrom: shift(-5), validTo: shift(360) })).status).toBe(201);
    expect((await post(`/transport/vehicles/${ids.bus}/documents`, { docType: 'FITNESS', docNo: 'FC-9', validTo: shift(20) })).status).toBe(201);
    expect((await post(`/transport/vehicles/${ids.bus}/documents`, { docType: 'PUC', docNo: 'P', validFrom: shift(5), validTo: shift(1) })).status).toBe(422);
    v = (await get('/transport/vehicles')).body.find((x: { id: string }) => x.id === ids.bus);
    const state = Object.fromEntries(v.documents.map((d: { docType: string; state: string }) => [d.docType, d.state]));
    expect(state).toMatchObject({ INSURANCE: 'OK', FITNESS: 'DUE_SOON', RC: 'MISSING', PERMIT: 'MISSING' });
    expect(v.attention).toBe(1);
  });

  it('crew are current staff; a driver needs a licence; one crew record per person', async () => {
    expect((await post('/transport/crew', { employeeId: ids.Raju, role: 'DRIVER' })).status).toBe(422);
    const d = await post('/transport/crew', { employeeId: ids.Raju, role: 'DRIVER', licenseNo: 'KA0120190001234', licenseExpiry: shift(10), badgeNo: 'B-7' });
    expect(d.status).toBe(201);
    ids.driver = d.body.id;
    expect((await post('/transport/crew', { employeeId: ids.Raju, role: 'ATTENDANT' })).body.type).toBe('already-crew');
    ids.attendant = (await post('/transport/crew', { employeeId: ids.Meena, role: 'ATTENDANT' })).body.id;
    ids.northDriver = (await post('/transport/crew', { employeeId: ids.Kiran, role: 'DRIVER', licenseNo: 'KA05X', licenseExpiry: shift(900) })).body.id;
    const crew = (await get('/transport/crew')).body;
    expect(crew.find((c: { id: string }) => c.id === ids.driver)).toMatchObject({ name: 'Raju', role: 'DRIVER', licenseState: 'DUE_SOON' });
  });

  it('expiry alerts: once per threshold to the transport managers; a renewal starts again', async () => {
    const fleet = app.get(TransportFleetService);
    const mgr = await addMember(app, A.session, { label: 'Transport', roleCode: 'INSTITUTION_ADMIN' });
    const count = async () => (await get('/notifications?limit=50', mgr.session)).body.items.filter((n: { eventCode: string }) => n.eventCode === 'TRANSPORT_EXPIRY').length;
    expect(await fleet.alert(A.tenantId)).toBe(2); // fitness in 20 days (≤ 30), licence in 10 days (≤ 15)
    expect(await count()).toBe(2);
    expect(await fleet.alert(A.tenantId)).toBe(0); // nothing new the same day
    expect(await fleet.alert(A.tenantId, shift(14))).toBe(1); // fitness now within 7 days; licence within 15 sent already
    expect(await fleet.alert(A.tenantId, shift(4))).toBe(1); // licence now within 7 days
    expect(await count()).toBe(4);
    expect((await patch(`/transport/crew/${ids.driver}`, { licenseExpiry: shift(800) })).status).toBe(200);
    expect(await fleet.alert(A.tenantId)).toBe(0);
    const exp = (await get('/transport/expiring')).body;
    expect(exp.map((e: { what: string; whose: string }) => `${e.what}:${e.whose}`)).toEqual(['Fitness certificate:KA01AB1234']);
  });
});

describe('AC48 routes and stops', () => {
  it('vehicle and crew of the route\'s campus only; stops kept in order', async () => {
    expect((await post('/transport/routes', { campusId: main, routeNo: 'R1', name: 'Rajajinagar', vehicleId: ids.van, shift: 'BOTH' })).body.type).toBe('vehicle-other-campus');
    expect((await post('/transport/routes', { campusId: main, routeNo: 'R1', name: 'Rajajinagar', vehicleId: ids.bus, driverId: ids.northDriver, shift: 'BOTH' })).body.type).toBe('crew-invalid');
    expect((await post('/transport/routes', { campusId: main, routeNo: 'R1', name: 'Rajajinagar', vehicleId: ids.bus, driverId: ids.attendant, shift: 'BOTH' })).body.type).toBe('crew-invalid');
    const r = await post('/transport/routes', { campusId: main, routeNo: 'R1', name: 'Rajajinagar', vehicleId: ids.bus, driverId: ids.driver, attendantId: ids.attendant, shift: 'BOTH' });
    expect(r.status).toBe(201);
    ids.route = r.body.id;
    expect((await post('/transport/routes', { campusId: main, routeNo: 'R1', name: 'Again', shift: 'BOTH' })).body.type).toBe('route-no-taken');
    const stops = await put(`/transport/routes/${ids.route}/stops`, { stops: [
      { stopName: 'Navrang', pickupTime: '07:10', dropTime: '15:40', distanceKm: 6.5, feeAmount: '12000' },
      { stopName: 'Mahalakshmi Layout', pickupTime: '07:25', dropTime: '15:25', distanceKm: 4, feeAmount: '9000' },
    ] });
    expect(stops.status).toBe(200);
    expect(stops.body.map((s: { stopName: string; sequence: number; feeAmount: string }) => `${s.sequence}:${s.stopName}:${s.feeAmount}`)).toEqual(['1:Navrang:12000.00', '2:Mahalakshmi Layout:9000.00']);
    ids.stop1 = stops.body[0].id;
    ids.stop2 = stops.body[1].id;
    expect((await put(`/transport/routes/${ids.route}/stops`, { stops: [{ stopName: 'A', feeAmount: '1' }, { stopName: 'a', feeAmount: '1' }] })).status).toBe(422);
    const list = (await get('/transport/routes')).body;
    expect(list[0]).toMatchObject({ routeNo: 'R1', stopCount: 2, firstStop: 'Navrang', startsAt: '07:10', seatsUsed: 0, driver: { name: 'Raju' }, attendant: { name: 'Meena' } });
  });
});

describe('AC49 students on buses', () => {
  it('bills the stop fee for the months left; one active stop per student per year', async () => {
    const start = today;
    const r = await post('/transport/assignments', { studentId: ids.Asha, routeStopId: ids.stop1, startDate: start });
    expect(r.status).toBe(201);
    const expected = proratedTransportFee(1_200_000, yearStart, yearEnd, start);
    expect(r.body.billed).toBe((expected / 100).toFixed(2));
    ids.assignAsha = r.body.id;
    const acct = (await get(`/fees/students/${ids.Asha}`)).body;
    const inv = acct.invoices.find((i: { id: string }) => i.id === r.body.invoiceId);
    expect(inv).toMatchObject({ status: 'UNPAID' });
    expect(inv.description).toMatch(/^Bus fee .* Route R1, Navrang/);
    expect(acct.totals.balance).toBe((expected / 100).toFixed(2));
    expect((await get('/fees/dues?pageSize=50')).body.items.find((d: { studentId: string }) => d.studentId === ids.Asha).balance).toBe((expected / 100).toFixed(2));
    expect((await post('/transport/assignments', { studentId: ids.Asha, routeStopId: ids.stop2, startDate: start })).body.type).toBe('already-on-bus');
    // Starting in the first month bills the whole year.
    expect(proratedTransportFee(1_200_000, '2026-06-01', '2027-03-31', '2026-06-01')).toBe(1_200_000);
    expect(proratedTransportFee(1_200_000, '2026-06-01', '2027-03-31', '2026-11-17')).toBe(600_000); // 5 of 10 months
  });

  it('never more students than seats — also when two people assign at the same moment', async () => {
    expect((await post('/transport/assignments', { studentId: ids.Bala, routeStopId: ids.stop2, startDate: today, bill: false })).status).toBe(201);
    const [x, y] = await Promise.all([
      post('/transport/assignments', { studentId: ids.Chitra, routeStopId: ids.stop1, startDate: today, bill: false }),
      post('/transport/assignments', { studentId: ids.Dev, routeStopId: ids.stop2, startDate: today, bill: false }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect([x.body.type, y.body.type]).toContain('bus-full');
    const route = (await get(`/transport/routes/${ids.route}`)).body;
    expect(route.seatsUsed).toBe(3);
    expect(route.stops.map((s: { students: number }) => s.students).reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect((await patch(`/transport/vehicles/${ids.bus}`, { seatingCapacity: 2 })).body.type).toBe('seats-below-students');
  });

  it('taking a student off frees the seat; the driver list is stop by stop', async () => {
    const riders = (await get(`/transport/routes/${ids.route}/riders`)).body.riders;
    expect(riders).toHaveLength(3);
    const seq = riders.map((r: { sequence: number }) => r.sequence);
    expect(seq).toEqual([...seq].sort((p: number, q: number) => p - q)); // pickup order
    expect(riders[0]).toMatchObject({ guardianName: expect.stringContaining('Father'), className: expect.stringContaining('– A') });
    expect((await post(`/transport/assignments/${ids.assignAsha}/stop`, { endDate: shift(-1000), reason: 'Moved house' })).body.type).toBe('end-before-start');
    expect((await post(`/transport/assignments/${ids.assignAsha}/stop`, { endDate: today, reason: 'Moved house' })).body).toMatchObject({ status: 'STOPPED', endDate: today });
    expect((await get(`/transport/routes/${ids.route}`)).body.seatsUsed).toBe(2);
    const hist = (await get(`/transport/students/${ids.Asha}`)).body;
    expect(hist[0]).toMatchObject({ status: 'STOPPED', routeNo: 'R1', stopName: 'Navrang', driverName: 'Raju', vehicleNo: 'KA01AB1234' });
    expect((await put(`/transport/routes/${ids.route}/stops`, { stops: [{ id: ids.stop1, stopName: 'Navrang', feeAmount: '12000' }] })).body.type).toBe('stop-in-use');
  });

  it('the parent sees only their own child\'s bus', async () => {
    const PARENT = `bus.parent.${tag}@test.local`;
    const g = (await get(`/students/${ids.Bala}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
    await post(`/students/${ids.Bala}/portal/guardians/${g}`, { email: PARENT });
    await setPassword(PARENT, 'Parent@Test123');
    const s = await login(app, PARENT, 'Parent@Test123');
    const parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
    const bus = (await get(`/portal/children/${ids.Bala}/transport`, parent)).body;
    expect(bus).toMatchObject({ current: { routeNo: 'R1', stopName: 'Mahalakshmi Layout', pickupTime: '07:25', dropTime: '15:25', vehicleNo: 'KA01AB1234', driverName: 'Raju' }, liveTracking: false });
    expect((await get(`/portal/children/${ids.Asha}/transport`, parent)).status).toBe(404);
    expect((await get(`/transport/routes/${ids.route}/riders`, parent)).status).toBe(403);
  });
});

describe('AC47–49 permissions and isolation', () => {
  it('a viewer can read but not change; another institution sees nothing', async () => {
    await createRole(A.tenantId, 'BUS_VIEW', [PERMISSIONS.TRANSPORT_READ]);
    const v = (await addMember(app, A.session, { label: 'BusView', roleCode: 'BUS_VIEW' })).session;
    expect((await get('/transport/routes', v)).status).toBe(200);
    expect((await post('/transport/vehicles', { campusId: main, vehicleNo: 'KA01ZZ9999', vehicleType: 'CAR', seatingCapacity: 4, ownership: 'OWN' }, v)).status).toBe(403);
    expect((await post('/transport/assignments', { studentId: ids.Dev, routeStopId: ids.stop2, startDate: today }, v)).status).toBe(403);
    expect((await get('/transport/vehicles', B.session)).body).toEqual([]);
    expect((await get(`/transport/routes/${ids.route}`, B.session)).status).toBe(404);
    expect((await post(`/transport/vehicles/${ids.bus}/documents`, { docType: 'RC', docNo: 'RC-1', validTo: shift(100) }, B.session)).status).toBe(404);
  });

  it('the module off the plan closes transport', async () => {
    const db = ownerDb();
    try {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'TRANSPORT' }, data: { isEnabled: false } });
      expect((await get('/transport/routes')).body.type).toBe('module-not-enabled');
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'TRANSPORT' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });
});
