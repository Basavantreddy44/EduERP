/**
 * AC50–AC53 hostel & mess (Phase 7): rooms and beds, allotment (gender rule, one bed per student and
 * one student per bed — also at the same moment), fees and deposit, check-in / check-out with
 * damages through approval, roll-call alerts once, outpasses needing parent + warden, home-going
 * pickup check, the parent app, mess plans, bills and meal counts; permissions and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, monthsLeft } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let yearStart: string;
let yearEnd: string;
let parent: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const patch = (path: string, body: unknown, s: Session = A.session) => http().patch(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const PARENT = `hostel.parent.${tag}@test.local`;
const fullItems = (room: { inventory: { id: string }[] }, over: Record<string, string> = {}) => room.inventory.map((i) => ({ inventoryItemId: i.id, condition: over[i.id] ?? 'GOOD' }));

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'HosA');
  B = await createTenant(app, platform, 'HosB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  yearStart = `${shift(-120).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${yearStart}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  yearEnd = e.toISOString().slice(0, 10);
  const year = (await post('/academic-years', { name: `${yearStart.slice(0, 4)}-${yearEnd.slice(2, 4)}`, startDate: yearStart, endDate: yearEnd, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 });
  for (const [name, code, feeType] of [['Hostel fee', 'HOSTEL', 'HOSTEL'], ['Caution deposit', 'DEP', 'DEPOSIT'], ['Mess fee', 'MESS', 'MESS']]) await post('/fees/heads', { name, code, feeType });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, g, email] of [['1', 'Asha', 'Girl', ''], ['2', 'Bala', 'Boy', ''], ['3', 'Chitra', 'Girl', `chitra.home.${tag}@test.local`], ['4', 'Esha', 'Girl', ''], ['5', 'Farah', 'Girl', '']]) {
    const r: Record<string, string> = { admissionNo: `H/${n}`, firstName: f, lastName: 'Test', dob: '2012-01-01', gender: g, admissionDate: yearStart, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: `${f} Father`, parentPhone: `98777000${n}0`, parentEmail: email, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  ids.warden = (await post('/staff', { campusId: main, firstName: 'Lalitha', gender: 'FEMALE', employeeType: 'NON_TEACHING', designation: 'Warden', joiningDate: shift(-500) })).body.id;
  ids.cook = (await post('/staff', { campusId: main, firstName: 'Mahesh', gender: 'MALE', employeeType: 'NON_TEACHING', joiningDate: shift(-500) })).body.id;
  // Asha's father gets a parent login.
  const g = (await get(`/students/${ids.Asha}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  ids.ashaGuardian = g;
  await post(`/students/${ids.Asha}/portal/guardians/${g}`, { email: PARENT });
  await setPassword(PARENT, 'Parent@Test123');
  const s = await login(app, PARENT, 'Parent@Test123');
  parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
}, 180_000);
afterAll(() => app?.close());

describe('AC50 hostels, rooms and beds', () => {
  it('rooms come with as many beds as their capacity; counts follow', async () => {
    const h = await post('/hostel/hostels', { campusId: main, name: 'Kaveri Girls Hostel', hostelType: 'GIRLS', wardenEmployeeId: ids.warden, depositAmount: '5000' });
    expect(h.status).toBe(201);
    ids.hostel = h.body.id;
    expect((await post('/hostel/hostels', { campusId: main, name: 'Kaveri Girls Hostel', hostelType: 'GIRLS' })).body.type).toBe('hostel-name-taken');
    expect((await post(`/hostel/hostels/${ids.hostel}/rooms`, { roomNo: 'G101', floor: 'G', roomType: 'DOUBLE', capacity: 2, feeAmount: '60000' })).status).toBe(201);
    expect((await post(`/hostel/hostels/${ids.hostel}/rooms/bulk`, { floor: '1', prefix: 'F', from: 101, to: 103, roomType: 'TRIPLE', capacity: 3, feeAmount: '48000' })).body).toMatchObject({ created: 3, rooms: ['F101', 'F102', 'F103'] });
    expect((await post(`/hostel/hostels/${ids.hostel}/rooms`, { roomNo: 'F101', roomType: 'SINGLE', capacity: 1, feeAmount: '1' })).body.type).toBe('room-no-taken');
    const list = (await get('/hostel/hostels')).body.find((x: { id: string }) => x.id === ids.hostel);
    expect(list).toMatchObject({ rooms: 4, beds: 11, vacant: 11, occupied: 0, warden: { name: 'Lalitha' }, depositAmount: '5000.00' });
    const rooms = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms;
    const g101 = rooms.find((r: { roomNo: string }) => r.roomNo === 'G101');
    expect(g101.beds.map((b: { bedNo: string }) => b.bedNo)).toEqual(['A', 'B']);
    ids.g101 = g101.id;
    ids.f101 = rooms.find((r: { roomNo: string }) => r.roomNo === 'F101').id;
  });

  it('capacity up adds beds, down retires empty ones (never deleted); inventory list', async () => {
    expect((await patch(`/hostel/rooms/${ids.g101}`, { capacity: 3 })).status).toBe(200);
    let r = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms.find((x: { id: string }) => x.id === ids.g101);
    expect(r.beds.map((b: { bedNo: string }) => b.bedNo)).toEqual(['A', 'B', 'C']);
    expect((await patch(`/hostel/rooms/${ids.g101}`, { capacity: 2 })).status).toBe(200);
    r = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms.find((x: { id: string }) => x.id === ids.g101);
    expect(r.beds.map((b: { bedNo: string }) => b.bedNo)).toEqual(['A', 'B']);
    const db = ownerDb();
    try { expect(await db.hostelBed.count({ where: { roomId: ids.g101 } })).toBe(3); } finally { await db.$disconnect(); }
    const inv = await put(`/hostel/rooms/${ids.g101}/inventory`, { items: [{ itemName: 'Cot', quantity: 1, unitCost: '3000' }, { itemName: 'Mattress', quantity: 1, unitCost: '1500' }, { itemName: 'Study table', quantity: 1, unitCost: '2000' }] });
    expect(inv.body.map((i: { itemName: string }) => i.itemName)).toEqual(['Cot', 'Mattress', 'Study table']);
    ids.bedA = r.beds[0].id;
    ids.bedB = r.beds[1].id;
    await put(`/hostel/rooms/${ids.f101}/inventory`, { items: [{ itemName: 'Cot', quantity: 1, unitCost: '3000' }] });
  });
});

describe('AC51 allotment, fees and deposit', () => {
  it('gender rule; bills the room fee for the months left and the deposit once', async () => {
    expect((await post('/hostel/allotments', { studentId: ids.Bala, bedId: ids.bedA, checkInDate: today })).body.type).toBe('hostel-gender');
    const r = await post('/hostel/allotments', { studentId: ids.Asha, bedId: ids.bedA, checkInDate: today });
    expect(r.status).toBe(201);
    const months = monthsLeft(yearStart, yearEnd, today);
    const room = Math.round((6_000_000 * months) / 12 / 100) * 100;
    expect(r.body).toMatchObject({ status: 'RESERVED', billed: { room: (room / 100).toFixed(2), deposit: '5000.00' } });
    ids.allotAsha = r.body.id;
    const acct = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(acct.totals.balance).toBe(((room + 500_000) / 100).toFixed(2));
    expect(acct.invoices.map((i: { description: string }) => i.description).sort()).toEqual([expect.stringMatching(/^Hostel caution deposit/), expect.stringMatching(/^Hostel fee .* room G101/)].sort());
    expect((await post('/hostel/allotments', { studentId: ids.Asha, bedId: ids.bedB, checkInDate: today })).body.type).toBe('already-allotted');
  });

  it('one student per bed — also when two people allot the same bed at once', async () => {
    const [x, y] = await Promise.all([
      post('/hostel/allotments', { studentId: ids.Chitra, bedId: ids.bedB, checkInDate: today, bill: false }),
      post('/hostel/allotments', { studentId: ids.Esha, bedId: ids.bedB, checkInDate: today, bill: false }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect([x.body.type, y.body.type]).toContain('bed-taken');
    const winner = x.status === 201 ? 'Chitra' : 'Esha';
    ids.allotB = (x.status === 201 ? x : y).body.id;
    ids.bWinner = winner;
    const list = (await get('/hostel/hostels')).body.find((h: { id: string }) => h.id === ids.hostel);
    expect(list).toMatchObject({ reserved: 2, vacant: 9 });
  });

  it('check-in needs every room item; vacate frees the bed; damage reaches the bills only after approval', async () => {
    const room = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms.find((x: { id: string }) => x.id === ids.g101);
    expect((await post(`/hostel/allotments/${ids.allotAsha}/check-in`, { items: fullItems(room).slice(0, 2) })).body.type).toBe('items-unchecked');
    expect((await post(`/hostel/allotments/${ids.allotAsha}/check-in`, { items: fullItems(room) })).body.status).toBe('CHECKED_IN');
    expect((await post(`/hostel/allotments/${ids.allotB}/check-in`, { items: fullItems(room) })).body.status).toBe('CHECKED_IN');
    // Asha pays the deposit.
    const dep = (await get(`/fees/students/${ids.Asha}`)).body.invoices.find((i: { description: string }) => i.description.startsWith('Hostel caution deposit'));
    expect((await post('/fees/payments', { studentId: ids.Asha, amount: '5000', mode: 'BANK_TRANSFER', referenceNo: 'DEP-1', payerName: 'Parent', invoiceIds: [dep.id] })).status).toBe(201);
    // With an approval rule, the damage waits.
    const role = await createRole(A.tenantId, 'HOSTEL_HEAD', [PERMISSIONS.HOSTEL_READ]);
    const head = await addMember(app, A.session, { label: 'HostelHead', roleCode: 'HOSTEL_HEAD' });
    expect((await post('/approvals/rules', { entityType: 'HOSTEL_DAMAGE', levelNo: 1, approverRoleId: role })).status).toBe(201);
    const table = room.inventory.find((i: { itemName: string }) => i.itemName === 'Study table').id;
    const v = await post(`/hostel/allotments/${ids.allotAsha}/vacate`, { checkOutDate: today, items: fullItems(room, { [table]: 'MISSING' }), reason: 'Moving out' });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'VACATED', damage: { amount: '2000.00', status: 'PENDING' }, deposit: { paid: '5000.00', damagesPending: '2000.00', refundable: '3000.00' } });
    expect((await get(`/fees/students/${ids.Asha}`)).body.invoices.some((i: { description: string }) => i.description.startsWith('Hostel damage'))).toBe(false);
    const req = (await get('/approvals/inbox', head.session)).body.find((x: { entityType: string }) => x.entityType === 'HOSTEL_DAMAGE');
    expect(req.summary).toMatch(/Study table \(missing\)/);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, head.session)).status).toBeLessThan(300);
    expect((await get(`/fees/students/${ids.Asha}`)).body.invoices.find((i: { description: string }) => i.description.startsWith('Hostel damage'))).toMatchObject({ status: 'UNPAID' });
    expect((await get(`/hostel/students/${ids.Asha}`)).body.deposit).toMatchObject({ damagesCharged: '2000.00', damagesPending: '0.00', refundable: '3000.00' });
    expect((await get('/hostel/hostels')).body.find((h: { id: string }) => h.id === ids.hostel)).toMatchObject({ occupied: 1, vacant: 10 });
  });

  it('room change keeps history; the deposit is not billed twice', async () => {
    const f101 = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms.find((x: { id: string }) => x.id === ids.f101);
    const ch = await post(`/hostel/allotments/${ids.allotB}/change-room`, { bedId: f101.beds[0].id, date: today, reason: 'Asked for a quieter floor' });
    expect(ch.status).toBe(200);
    const hist = (await get(`/hostel/students/${ids[ids.bWinner]}`)).body.stays;
    expect(hist.map((s: { roomNo: string; status: string }) => `${s.roomNo}:${s.status}`)).toEqual(['F101:CHECKED_IN', 'G101:VACATED']);
    // Asha comes back to another bed: room fee again, deposit not again.
    const again = await post('/hostel/allotments', { studentId: ids.Asha, bedId: ids.bedA, checkInDate: today });
    expect(again.body.billed.deposit).toBeUndefined();
    ids.allotAsha2 = again.body.id;
    const room = (await get(`/hostel/hostels/${ids.hostel}/rooms`)).body.rooms.find((x: { id: string }) => x.id === ids.g101);
    await post(`/hostel/allotments/${ids.allotAsha2}/check-in`, { items: fullItems(room) });
  });
});

describe('AC52 daily hostel life', () => {
  it('roll-call: residents only; parents of absent students alerted once', async () => {
    const sheet = (await get(`/hostel/hostels/${ids.hostel}/roll-call?date=${today}`)).body;
    expect(sheet.students.map((s: { name: string }) => s.name.split(' ')[0]).sort()).toEqual(['Asha', ids.bWinner].sort());
    expect((await post('/hostel/roll-call', { hostelId: ids.hostel, date: today, records: [{ studentId: ids.Bala, status: 'PRESENT' }] })).body.type).toBe('not-resident');
    const first = await post('/hostel/roll-call', { hostelId: ids.hostel, date: today, records: [{ studentId: ids.Asha, status: 'ABSENT' }, { studentId: ids[ids.bWinner], status: 'PRESENT' }] });
    expect(first.body).toEqual({ saved: 2, alerted: 1 });
    expect((await post('/hostel/roll-call', { hostelId: ids.hostel, date: today, records: [{ studentId: ids.Asha, status: 'ABSENT' }] })).body).toEqual({ saved: 1, alerted: 0 });
    const n = (await get('/notifications?limit=20', parent)).body.items.filter((x: { eventCode: string }) => x.eventCode === 'HOSTEL_ABSENT');
    expect(n).toHaveLength(1);
    expect((await get(`/hostel/hostels/${ids.hostel}/roll-call?date=${shift(1)}`)).status).toBe(422);
  });

  it('outpass: out only after both parent and warden approve; late return flagged', async () => {
    const outTime = new Date(Date.now() + 3_600_000).toISOString();
    const back = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const o = await post('/hostel/outpasses', { studentId: ids.Asha, outTime, expectedReturn: back, destination: 'Malleshwaram market', reason: 'Buy stationery' });
    expect(o.status).toBe(201);
    expect(o.body.parentHasLogin).toBe(true);
    expect((await get('/notifications?limit=20', parent)).body.items.some((x: { eventCode: string }) => x.eventCode === 'HOSTEL_OUTPASS')).toBe(true);
    expect((await post(`/hostel/outpasses/${o.body.id}/out`, {})).body.type).toBe('outpass-not-approved');
    expect((await post(`/hostel/outpasses/${o.body.id}/decide`, { approve: true })).body).toMatchObject({ wardenApproval: 'APPROVED', status: 'REQUESTED' });
    expect((await post(`/hostel/outpasses/${o.body.id}/out`, {})).body.detail).toMatch(/parent has not approved/);
    const p = await post(`/portal/children/${ids.Asha}/outpasses/${o.body.id}/decide`, { approve: true }, parent);
    expect(p.body).toMatchObject({ parentApproval: 'APPROVED', status: 'APPROVED' });
    expect((await post(`/hostel/outpasses/${o.body.id}/out`, {})).body.status).toBe('OUT');
    expect((await post(`/hostel/outpasses/${o.body.id}/back`, {})).body.status).toBe('RETURNED');
    // Parent answer taken by phone (no login): remarks required.
    const o2 = await post('/hostel/outpasses', { studentId: ids[ids.bWinner], outTime, expectedReturn: back, destination: 'Clinic', reason: 'Dental check-up' });
    expect(o2.body.parentHasLogin).toBe(false);
    expect((await post(`/hostel/outpasses/${o2.body.id}/decide`, { approve: true, parentByPhone: true })).body.type).toBe('remarks-required');
    expect((await post(`/hostel/outpasses/${o2.body.id}/decide`, { approve: true, parentByPhone: true, remarks: 'Mother on phone, 10:05' })).body.parentApproval).toBe('APPROVED');
    expect((await post(`/hostel/outpasses/${o2.body.id}/decide`, { approve: false, remarks: 'Clinic visit arranged by school instead' })).body.status).toBe('REJECTED');
    // The database itself refuses an "out" without both approvals.
    const db = ownerDb();
    try { await expect(db.hostelOutpass.update({ where: { id: o2.body.id }, data: { status: 'OUT' } })).rejects.toThrow(/hostel_outpass_both_chk/); } finally { await db.$disconnect(); }
  });

  it('home-going: a pickup person not on record needs the warden\'s explicit OK', async () => {
    const h = await post('/hostel/home-going', { studentId: ids.Asha, fromDate: shift(2), toDate: shift(4), reason: 'Family function', pickupPersonName: 'Ramesh (uncle)', pickupPersonPhone: '9811122233' });
    expect(h.status).toBe(201);
    expect((await post(`/hostel/home-going/${h.body.id}/decide`, { approve: true })).body.type).toBe('unlisted-pickup');
    expect((await post(`/hostel/home-going/${h.body.id}/decide`, { approve: true, confirmUnlistedPickup: true, remarks: 'Father confirmed by phone' })).body.status).toBe('APPROVED');
    expect((await post(`/hostel/home-going/${h.body.id}/depart`, {})).body.status).toBe('DEPARTED');
    expect((await post(`/hostel/home-going/${h.body.id}/return`, {})).body.status).toBe('RETURNED');
    const g = await post('/hostel/home-going', { studentId: ids.Asha, fromDate: shift(6), toDate: shift(7), reason: 'Weekend', pickupGuardianId: ids.ashaGuardian });
    expect((await post(`/hostel/home-going/${g.body.id}/decide`, { approve: true })).body.status).toBe('APPROVED');
    expect((await post('/hostel/home-going', { studentId: ids.Asha, fromDate: shift(7), toDate: shift(8), reason: 'Overlap', pickupGuardianId: ids.ashaGuardian })).body.type).toBe('home-going-overlap');
  });

  it('visitors (guardian recognised by phone) and maintenance requests', async () => {
    const v = await post('/hostel/visitors', { hostelId: ids.hostel, studentId: ids.Asha, visitorName: 'Asha Father', relation: 'Father', phone: '9877700010' });
    expect(v.body).toMatchObject({ isAuthorisedGuardian: true });
    expect((await post(`/hostel/visitors/${v.body.id}/out`, {})).body.outTime).toBeTruthy();
    const m = await post('/hostel/maintenance', { hostelId: ids.hostel, roomId: ids.g101, category: 'ELECTRICAL', description: 'Fan not working in G101', priority: 'HIGH' });
    expect(m.status).toBe(201);
    expect((await patch(`/hostel/maintenance/${m.body.id}`, { assignedToEmployeeId: ids.cook })).body.status).toBe('ASSIGNED');
    expect((await patch(`/hostel/maintenance/${m.body.id}`, { status: 'RESOLVED', remarks: 'Capacitor replaced' })).body.resolvedAt).toBeTruthy();
  });

  it('the parent sees only their own child\'s hostel', async () => {
    const h = (await get(`/portal/children/${ids.Asha}/hostel`, parent)).body;
    expect(h).toMatchObject({ stay: { hostel: 'Kaveri Girls Hostel', roomNo: 'G101', bedNo: 'A', warden: { name: 'Lalitha' } }, smsAlerts: false });
    expect(h.nights[0]).toMatchObject({ date: today, status: 'ABSENT' });
    expect(h.outpasses[0]).toMatchObject({ status: 'RETURNED', parentApproval: 'APPROVED' });
    expect((await get(`/portal/children/${ids.Chitra}/hostel`, parent)).status).toBe(404);
    expect((await get(`/hostel/hostels/${ids.hostel}/residents`, parent)).status).toBe(403);
  });
});

describe('AC53 mess', () => {
  it('plans, one running plan per person, bills for the months left, menu and meal counts', async () => {
    const p = await post('/hostel/mess/plans', { campusId: main, name: 'Veg full board', mealsIncluded: ['DINNER', 'BREAKFAST', 'LUNCH'], billingType: 'FIXED', amount: '3500' });
    expect(p.body.mealsIncluded).toEqual(['BREAKFAST', 'LUNCH', 'DINNER']);
    ids.plan = p.body.id;
    const lunch = (await post('/hostel/mess/plans', { campusId: main, name: 'Lunch only', mealsIncluded: ['LUNCH'], billingType: 'PER_MEAL', amount: '60' })).body.id;
    const s = await post('/hostel/mess/subscriptions', { studentId: ids.Asha, messPlanId: ids.plan, fromDate: today });
    expect(s.body.billed).toBe(((350_000 * monthsLeft(yearStart, yearEnd, today)) / 100).toFixed(2));
    expect((await post('/hostel/mess/subscriptions', { studentId: ids.Asha, messPlanId: lunch, fromDate: today })).body.type).toBe('already-subscribed');
    expect((await post('/hostel/mess/subscriptions', { employeeId: ids.cook, messPlanId: lunch, fromDate: today })).body.billed).toBeNull();
    const dow = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    expect((await put('/hostel/mess/menu', { campusId: main, effectiveFrom: shift(-1), items: [{ dayOfWeek: dow, meal: 'LUNCH', items: 'Rice, sambar, palya, curd' }, { dayOfWeek: dow, meal: 'BREAKFAST', items: 'Idli, chutney' }] })).status).toBe(200);
    const c = (await get(`/hostel/mess/counts?campusId=${main}&date=${today}`)).body;
    expect(c.meals.map((m: { meal: string; students: number; staff: number }) => `${m.meal}:${m.students}+${m.staff}`)).toEqual(['BREAKFAST:1+0', 'LUNCH:1+1', 'SNACKS:0+0', 'DINNER:1+0']);
    expect(c.meals.find((m: { meal: string }) => m.meal === 'LUNCH').menu).toBe('Rice, sambar, palya, curd');
    expect((await get(`/portal/children/${ids.Asha}/hostel`, parent)).body.mess).toMatchObject({ plan: 'Veg full board', today: [{ meal: 'BREAKFAST', items: 'Idli, chutney' }, { meal: 'LUNCH', items: 'Rice, sambar, palya, curd' }] });
    const sub = s.body.id;
    expect((await post(`/hostel/mess/subscriptions/${sub}/end`, { toDate: shift(-1000) })).body.type).toBe('end-before-start');
    expect((await post(`/hostel/mess/subscriptions/${sub}/end`, { toDate: today })).body.status).toBe('ENDED');
  });
});

describe('AC50–53 permissions and isolation', () => {
  it('a hostel viewer cannot allot; another institution sees nothing; module off closes it', async () => {
    await createRole(A.tenantId, 'HOS_VIEW', [PERMISSIONS.HOSTEL_READ]);
    const v = (await addMember(app, A.session, { label: 'HosView', roleCode: 'HOS_VIEW' })).session;
    expect((await get(`/hostel/hostels/${ids.hostel}/rooms`, v)).status).toBe(200);
    expect((await post('/hostel/allotments', { studentId: ids.Farah, bedId: ids.bedB, checkInDate: today }, v)).status).toBe(403);
    expect((await post('/hostel/roll-call', { hostelId: ids.hostel, date: today, records: [{ studentId: ids.Asha, status: 'PRESENT' }] }, v)).status).toBe(403);
    expect((await get('/hostel/hostels', B.session)).body).toEqual([]);
    expect((await get(`/hostel/hostels/${ids.hostel}/rooms`, B.session)).status).toBe(404);
    const db = ownerDb();
    try {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'HOSTEL' }, data: { isEnabled: false } });
      expect((await get('/hostel/hostels')).body.type).toBe('module-not-enabled');
      expect((await get(`/portal/children/${ids.Asha}/hostel`, parent)).body.type).toBe('module-not-enabled');
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'HOSTEL' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });
});
