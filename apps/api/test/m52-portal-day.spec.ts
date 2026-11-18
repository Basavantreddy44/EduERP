/**
 * AC45 the child's day-to-day (M5.2): attendance and fees equal the office's screens; a receipt opens
 * only for the parent's own child; online payment uses the same payment-link flow; leave goes through
 * the usual rules and approvals; modules off the plan are closed to parents too.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, isWeeklyOff } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, auth, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let parent: Session;
let sec: string;
const ids: Record<string, string> = {};
const pay: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const PARENT = `day.parent.${tag}@test.local`;
/** The last n school days before today (Sundays skipped). */
const schoolDays = (n: number) => { const out: string[] = []; for (let d = shift(today, -1); out.length < n; d = shift(d, -1)) if (!isWeeklyOff(d, 'SUN')) out.unshift(d); return out; };
const D = schoolDays(3);
const nextSchoolDay = (() => { let d = shift(today, 1); while (isWeeklyOff(d, 'SUN')) d = shift(d, 1); return d; })();

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'DayA');
  const campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = shift(today, -150);
  const end = shift(today, 200);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${end.slice(2, 4)}`, startDate: start, endDate: end, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  sec = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 })).body[0].id;
  const head = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  const st = await post('/fees/structures', {
    campusId: campus, academicYearId: year, programLevelId: sbs.levels[0].id, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: shift(today, -20) }, { instalmentNo: 2, name: 'Term 2', dueDate: shift(today, 30) }],
    items: [{ feeHeadId: head, instalmentNo: 1, amount: '10000' }, { feeHeadId: head, instalmentNo: 2, amount: '5000' }],
  });
  await post(`/fees/structures/${st.body.id}/activate`, {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala']]) {
    const r: Record<string, string> = { admissionNo: `DD/${n}`, firstName: f, lastName: 'Test', dob: '2016-01-01', gender: 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: `${f} Father`, parentPhone: `98755000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const n of [1, 2]) await post('/fees/billing/runs', { academicYearId: year, instalmentNo: n });
  pay.Asha = (await post('/fees/payments', { studentId: ids.Asha, amount: '4000', mode: 'BANK_TRANSFER', referenceNo: 'NEFT-A', payerName: 'Parent' })).body.id;
  pay.Bala = (await post('/fees/payments', { studentId: ids.Bala, amount: '2000', mode: 'UPI', referenceNo: 'UPI-B', payerName: 'Parent' })).body.id;
  const marks: Record<string, string>[] = [{}, { Asha: 'ABSENT' }, { Asha: 'HALF_DAY' }];
  for (const [i, d] of D.entries()) {
    expect((await post('/attendance/sheet', { sectionId: sec, date: d, submit: true, records: ['Asha', 'Bala'].map((n) => ({ studentId: ids[n], status: marks[i][n] ?? 'PRESENT' })) })).status).toBe(200);
  }
  ids.SL = (await post('/leave/types', { name: 'Sick leave', code: 'SL', appliesTo: 'STUDENT', daysPerYear: 10 })).body.id;
  ids.CL = (await post('/leave/types', { name: 'Casual leave', code: 'CL', appliesTo: 'EMPLOYEE', daysPerYear: 12 })).body.id;
  const g = (await get(`/students/${ids.Asha}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  expect((await post(`/students/${ids.Asha}/portal/guardians/${g}`, { email: PARENT })).status).toBe(200);
  await setPassword(PARENT, 'Parent@Test123');
  const s = await login(app, PARENT, 'Parent@Test123');
  parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
}, 180_000);
afterAll(() => app?.close());

describe('AC45 attendance', () => {
  it('each month equals the office attendance report; marks per day; another child is refused', async () => {
    for (const month of [...new Set(D.map((d) => d.slice(0, 7)))]) {
      const r = (await get(`/portal/children/${ids.Asha}/attendance?month=${month}`, parent)).body;
      const to = month === today.slice(0, 7) ? today : r.days.at(-1).date;
      const office = (await get(`/attendance/reports/students?from=${month}-01&to=${to}`)).body.items.find((i: { id: string }) => i.id === ids.Asha);
      expect(r.totals).toMatchObject({ marked: office.marked, attended: office.attended, pct: office.pct, absent: office.absent, halfDay: office.halfDay });
      for (const [i, d] of D.entries()) if (d.startsWith(month)) expect(r.days.find((x: { date: string }) => x.date === d).mark).toBe(['P', 'A', 'H'][i]);
      expect(r.days.filter((x: { kind: string }) => x.kind === 'off').every((x: { date: string }) => isWeeklyOff(x.date, 'SUN'))).toBe(true);
      expect(r.minPercent).toBe(75);
    }
    expect((await get(`/portal/children/${ids.Bala}/attendance?month=${today.slice(0, 7)}`, parent)).status).toBe(404);
  });
});

describe('AC45 fees', () => {
  it('totals equal the office fee account; office-only parts are not sent', async () => {
    const p = (await get(`/portal/children/${ids.Asha}/fees`, parent)).body;
    const o = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(p.totals).toEqual(o.totals);
    expect(p.totals).toMatchObject({ net: '15000.00', paid: '4000.00', balance: '11000.00', overdue: '6000.00' });
    expect(p.receipts.map((r: { id: string }) => r.id)).toEqual([pay.Asha]);
    expect(p.invoices).toHaveLength(2);
    expect(p.onlinePayment).toBe(true);
    expect(Object.keys(p)).not.toContain('canCollect');
  });

  it('a receipt opens only for the parent’s own child', async () => {
    const r = await get(`/portal/children/${ids.Asha}/receipts/${pay.Asha}`, parent);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: pay.Asha, amount: '4000', balanceAfter: '11000.00' });
    expect(r.body.cashierName).toBeUndefined();
    expect((await get(`/portal/children/${ids.Asha}/receipts/${pay.Bala}`, parent)).status).toBe(404);
    expect((await get(`/portal/children/${ids.Bala}/receipts/${pay.Bala}`, parent)).status).toBe(404);
    expect((await get(`/fees/payments/${pay.Asha}`, parent)).status).toBe(403);
  });

  it('pay online: a short payment link for everything due, on the usual secure page', async () => {
    const r = await post(`/portal/children/${ids.Asha}/pay`, {}, parent);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ amount: '11000' });
    expect(r.body.url).toMatch(/\/pay\/[\w-]{20,}$/);
    const links = (await get(`/fees/students/${ids.Asha}/pay-links`)).body;
    expect(links[0]).toMatchObject({ amount: '11000', status: 'ACTIVE', sentTo: null });
    expect((await post(`/portal/children/${ids.Bala}/pay`, {}, parent)).status).toBe(404);
  });
});

describe('AC45 leave', () => {
  let leaveId: string;
  it('a parent applies for the child: student leave types only, the usual rules, the office sees it', async () => {
    const before = (await get(`/portal/children/${ids.Asha}/leave`, parent)).body;
    expect(before.types.map((t: { code: string; left: number }) => `${t.code}:${t.left}`)).toEqual(['SL:10']);
    expect((await post(`/portal/children/${ids.Asha}/leave`, { leaveTypeId: ids.CL, fromDate: nextSchoolDay, toDate: nextSchoolDay, reason: 'Fever' }, parent)).body.type).toBe('leave-type-invalid');
    const r = await post(`/portal/children/${ids.Asha}/leave`, { leaveTypeId: ids.SL, fromDate: nextSchoolDay, toDate: nextSchoolDay, reason: 'Doctor visit' }, parent);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'APPROVED', studentId: ids.Asha, days: 1 });
    leaveId = r.body.id;
    expect((await post(`/portal/children/${ids.Asha}/leave`, { leaveTypeId: ids.SL, fromDate: nextSchoolDay, toDate: nextSchoolDay, reason: 'Again' }, parent)).body.type).toBe('leave-overlap');
    const office = (await get(`/leave/requests?studentId=${ids.Asha}`)).body.items;
    expect(office[0]).toMatchObject({ id: leaveId, appliedBy: expect.any(String), appliedByName: 'Asha Father' });
    const after = (await get(`/portal/children/${ids.Asha}/leave`, parent)).body;
    expect(after.types[0]).toMatchObject({ taken: 1, left: 9 });
    expect(after.requests[0]).toMatchObject({ id: leaveId, status: 'APPROVED', canCancel: true, appliedByMe: true });
    expect((await post(`/portal/children/${ids.Bala}/leave`, { leaveTypeId: ids.SL, fromDate: nextSchoolDay, toDate: nextSchoolDay, reason: 'Not mine' }, parent)).status).toBe(404);
    expect((await post('/leave/requests', { applicantType: 'STUDENT', studentId: ids.Bala, leaveTypeId: ids.SL, fromDate: nextSchoolDay, toDate: nextSchoolDay, reason: 'Staff route' }, parent)).status).toBe(404); // the staff form finds no student a parent may act for
  });

  it('the parent can withdraw leave they applied for before it starts', async () => {
    expect((await post(`/portal/children/${ids.Asha}/leave/${leaveId}/cancel`, {}, parent)).body.status).toBe('CANCELLED');
    expect((await get(`/portal/children/${ids.Asha}/leave`, parent)).body.types[0]).toMatchObject({ taken: 0, left: 10 });
  });
});

describe('AC45 plan', () => {
  it('a module off the plan is closed to parents as well', async () => {
    const db = ownerDb();
    try {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: false } });
      expect((await get(`/portal/children/${ids.Asha}/fees`, parent)).body.type).toBe('module-not-enabled');
      expect((await get(`/portal/children/${ids.Asha}/attendance?month=${today.slice(0, 7)}`, parent)).status).toBe(200);
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });
});
