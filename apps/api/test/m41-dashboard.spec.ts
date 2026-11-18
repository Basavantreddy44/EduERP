/**
 * AC41 dashboard figures (M4.1): every number equals the report behind it for the same campus and
 * day (attendance day view, staff sheet, collection report, dues list, admissions lists); blocks
 * follow permissions, campus scope and the modules on the plan; tenant isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, isWeeklyOff } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let year: string;
let level: string;
const sec: Record<string, string> = {};
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Attendance can be taken today (the default weekly holiday is Sunday). */
const open = !isWeeklyOff(today, 'SUN');
const onSchoolDay = open ? it : it.skip;

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'DashA');
  B = await createTenant(app, platform, 'DashB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  const start = shift(-150);
  const end = shift(200);
  year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${end.slice(2, 4)}`, startDate: start, endDate: end, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  level = sbs.levels[0].id;
  const made = (await post('/sections', { academicYearId: year, programLevelId: level, names: ['A', 'B'], capacity: 40 })).body;
  for (const s of made) sec[s.name] = s.id;

  // Fees: one term already overdue, one due later.
  const head = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  const st = await post('/fees/structures', {
    campusId: main, academicYearId: year, programLevelId: level, name: 'Class 1 fees',
    instalments: [{ instalmentNo: 1, name: 'Term 1', dueDate: shift(-20) }, { instalmentNo: 2, name: 'Term 2', dueDate: shift(30) }],
    items: [{ feeHeadId: head, instalmentNo: 1, amount: '10000' }, { feeHeadId: head, instalmentNo: 2, amount: '5000' }],
  });
  expect((await post(`/fees/structures/${st.body.id}/activate`, {})).body.status).toBe('ACTIVE');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, s] of [['1', 'Asha', 'A'], ['2', 'Bala', 'A'], ['3', 'Chitra', 'A'], ['4', 'Dev', 'A'], ['5', 'Esha', 'B']]) {
    const r: Record<string, string> = { admissionNo: `DB/${n}`, firstName: f, lastName: 'Test', dob: '2019-01-01', gender: 'Girl', admissionDate: shift(-150), campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: s, fatherName: 'Parent', parentPhone: `98733000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const n of [1, 2]) await post('/fees/billing/runs', { academicYearId: year, instalmentNo: n });
  // Bala pays everything (UPI), Chitra pays Term 1 (bank transfer); Asha, Dev and Esha owe both terms.
  expect((await post('/fees/payments', { studentId: ids.Bala, amount: '15000', mode: 'UPI', referenceNo: 'U-1', payerName: 'Parent' })).status).toBe(201);
  expect((await post('/fees/payments', { studentId: ids.Chitra, amount: '10000', mode: 'BANK_TRANSFER', referenceNo: 'NEFT-1', payerName: 'Parent' })).status).toBe(201);

  // Staff: Priya and Ravi at Main, Gopal at North; Sita at Main on approved leave today.
  for (const [f, c] of [['Priya', main], ['Ravi', main], ['Sita', main], ['Gopal', north]]) {
    ids[f] = (await post('/staff', { campusId: c, firstName: f, gender: 'FEMALE', employeeType: 'TEACHING', joiningDate: shift(-400) })).body.id;
  }
  if (open) {
    const cl = (await post('/leave/types', { name: 'Casual leave', code: 'CL', appliesTo: 'EMPLOYEE', daysPerYear: 12 })).body.id;
    expect((await post('/leave/requests', { applicantType: 'EMPLOYEE', employeeId: ids.Sita, leaveTypeId: cl, fromDate: today, toDate: today, reason: 'Family function' })).body.status).toBe('APPROVED');
    // Section A submitted (Bala absent, Dev on leave); section B not taken.
    const marks: Record<string, string> = { Bala: 'ABSENT', Dev: 'LEAVE', Chitra: 'LATE' };
    expect((await post('/attendance/sheet', { sectionId: sec.A, date: today, submit: true, records: ['Asha', 'Bala', 'Chitra', 'Dev'].map((n) => ({ studentId: ids[n], status: marks[n] ?? 'PRESENT' })) })).status).toBe(200);
    expect((await post('/staff-attendance', { campusId: main, date: today, records: [{ employeeId: ids.Priya, status: 'PRESENT' }] })).status).toBe(200);
  }

  // Admissions: two open enquiries (one due today, one overdue), one lost; one application.
  const enq = (name: string, follow: string | null) =>
    post('/admissions/enquiries', { campusId: main, academicYearId: year, programLevelId: level, studentName: name, parentName: 'Parent', phone: '9876500011', source: 'WALK_IN', nextFollowUp: follow });
  expect((await enq('Kiran', today)).status).toBe(201);
  expect((await enq('Latha', shift(-3))).status).toBe(201);
  const lost = (await enq('Mohan', null)).body.id;
  expect((await post(`/admissions/enquiries/${lost}/followups`, { mode: 'CALL', remarks: 'Chose another school', status: 'LOST' })).status).toBe(201);
  expect((await post('/admissions/applications', { campusId: main, academicYearId: year, programLevelId: level, firstName: 'Nila', dob: '2019-05-01', gender: 'FEMALE', fatherName: 'Parent', parentPhone: '9876500012' })).status).toBe(201);
}, 180_000);
afterAll(() => app?.close());

describe('AC41 figures equal the reports', () => {
  onSchoolDay('student attendance: the day view, campus by campus', async () => {
    const d = (await get('/dashboard/summary')).body;
    const day = (await get(`/attendance/day?date=${today}&campusId=${main}`)).body;
    expect(d.attendance).toMatchObject({ ...day.totals, presentPct: 50 }); // Asha + Chitra (late) of 4 marked
    expect(d.attendance).toMatchObject({ sections: 2, submitted: 1, notTaken: 1, students: 5, present: 2, absent: 1, leave: 1 });
    expect(d.attendance.open).toEqual([expect.objectContaining({ sectionId: sec.B, sectionName: 'B', students: 1, status: null })]);
    expect(d.closed).toEqual({});
  });

  onSchoolDay('staff: marked, approved leave before the office saves, not marked', async () => {
    const d = (await get('/dashboard/summary')).body;
    expect(d.staff).toMatchObject({ staff: 4, present: 1, absent: 0, onLeave: 1, notMarked: 2 });
    expect(d.staff.notMarkedCampuses.sort()).toEqual([main, north].sort());
    const m = (await get(`/dashboard/summary?campusId=${main}`)).body;
    expect(m.staff).toMatchObject({ staff: 3, present: 1, onLeave: 1, notMarked: 1, notMarkedCampuses: [main] });
  });

  it('fees: the collection report and the dues list', async () => {
    const d = (await get('/dashboard/summary')).body.fees;
    const from = `${today.slice(0, 8)}01`;
    const col = (await get(`/fees/reports/collection?from=${from}&to=${today}`)).body;
    const dues = (await get('/fees/dues?pageSize=1')).body.totals;
    const overdue = (await get('/fees/dues?pageSize=1&minDaysOverdue=1')).body.totals;
    expect(d.today).toEqual({ amount: '25000.00', receipts: 2 });
    expect(d.month).toMatchObject({ from, to: today, amount: col.total, receipts: col.receipts });
    expect(d.month.byMode).toEqual([{ key: 'UPI', amount: '15000.00', count: 1 }, { key: 'BANK_TRANSFER', amount: '10000.00', count: 1 }]);
    expect(d.outstanding).toEqual({ students: dues.students, balance: dues.balance, overdue: dues.overdue, overdueStudents: overdue.students });
    expect(d.outstanding).toEqual({ students: 4, balance: '50000.00', overdue: '30000.00', overdueStudents: 3 }); // Chitra owes only Term 2 (not yet due)
  });

  it('admissions: the enquiry and application lists', async () => {
    const d = (await get('/dashboard/summary')).body.admissions;
    const enq = (await get('/admissions/enquiries')).body.summary;
    const apps = (await get(`/admissions/applications?academicYearId=${year}`)).body.summary;
    expect(d.enquiries).toMatchObject({ open: 2, dueToday: 1, overdue: 1, byStatus: enq.byStatus });
    expect(d.enquiries.dueToday + d.enquiries.overdue).toBe(enq.dueOrOverdue);
    expect(d.applications).toMatchObject({ pending: 1, enrolled: 0 });
    for (const [k, v] of Object.entries(apps.byStatus)) expect(d.applications.byStatus[k]).toBe(v);
  });
});

describe('AC41 who sees what', () => {
  it('blocks follow permissions; approvals for everyone', async () => {
    await createRole(A.tenantId, 'DASH_FEES', [PERMISSIONS.FEE_READ]);
    const acc = (await addMember(app, A.session, { label: 'Accounts', roleCode: 'DASH_FEES' })).session;
    const d = (await get('/dashboard/summary', acc)).body;
    expect(Object.keys(d).sort()).toEqual(['approvals', 'campusId', 'campuses', 'closed', 'date', 'fees']);
    expect(d.fees.outstanding.students).toBe(4);
    await createRole(A.tenantId, 'DASH_NONE', []);
    const none = (await get('/dashboard/summary', (await addMember(app, A.session, { label: 'Plain', roleCode: 'DASH_NONE' })).session)).body;
    expect(none).toMatchObject({ campuses: [], approvals: { waiting: 0, items: [] } });
    expect(none.fees ?? none.attendance ?? none.staff ?? none.admissions).toBeUndefined();
  });

  it('campus scope: a North-only user sees North figures and cannot ask for Main', async () => {
    await createRole(A.tenantId, 'DASH_NORTH', [PERMISSIONS.FEE_READ, PERMISSIONS.STAFF_ATT_MARK, PERMISSIONS.ATT_READ]);
    const n = (await addMember(app, A.session, { label: 'North', roleCode: 'DASH_NORTH', campusId: north })).session;
    const d = (await get('/dashboard/summary', n)).body;
    expect(d.campuses.map((c: { id: string }) => c.id)).toEqual([north]);
    expect(d.fees.outstanding).toMatchObject({ students: 0, balance: '0.00' });
    expect(d.fees.today).toEqual({ amount: '0.00', receipts: 0 });
    if (open) expect(d.staff).toMatchObject({ staff: 1, notMarked: 1 });
    expect((await get(`/dashboard/summary?campusId=${main}`, n)).status).toBe(404);
  });

  it('a module off the plan drops its block', async () => {
    const db = ownerDb();
    try {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: false } });
      const d = (await get('/dashboard/summary')).body;
      expect(d.fees).toBeUndefined();
      expect(d.admissions).toBeDefined();
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'FEES' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });

  it('isolation: another institution sees none of it', async () => {
    expect((await get('/dashboard/summary', B.session)).body).toMatchObject({ campuses: [] });
    const own = (await post('/campuses', { code: 'MAIN', name: 'Other School', campusType: 'SCHOOL' }, B.session)).body.id;
    const d = (await get('/dashboard/summary', B.session)).body;
    expect(d.campuses.map((c: { id: string }) => c.id)).toEqual([own]);
    expect(d.fees).toMatchObject({ today: { receipts: 0 }, outstanding: { students: 0 } });
    expect(d.admissions.enquiries).toMatchObject({ open: 0, dueToday: 0 });
    expect((await get(`/dashboard/summary?campusId=${main}`, B.session)).status).toBe(404);
  });
});

describe('AC43 trends', () => {
  it('collection: every day of the last 30 equals the collection report', async () => {
    const t = (await get('/dashboard/trends')).body;
    expect(t.collection).toHaveLength(30);
    expect(t.collection[29]).toEqual({ date: today, amount: '25000.00', receipts: 2 });
    const r = (await get(`/fees/reports/collection?from=${t.from}&to=${t.to}`)).body;
    for (const d of t.collection) {
      const x = r.byDay.find((y: { key: string }) => y.key === d.date);
      expect([d.amount, d.receipts]).toEqual(x ? [x.amount, x.count] : ['0.00', 0]);
    }
  });

  it('attendance: open days only (Sundays and holidays left out); each day equals the student % report', async () => {
    const hol = [-1, -2, -3, -4].map(shift).find((d) => !isWeeklyOff(d, 'SUN'))!;
    expect((await post('/holidays', { holidayDate: hol, name: 'Test holiday', holidayType: 'INSTITUTION' })).status).toBe(201);
    const t = (await get('/dashboard/trends')).body;
    const dates = t.attendance.map((d: { date: string }) => d.date);
    expect(dates).not.toContain(hol);
    expect(dates.some((d: string) => isWeeklyOff(d, 'SUN'))).toBe(false);
    expect(dates.length).toBeGreaterThanOrEqual(20);
    for (const d of t.attendance) {
      const r = (await get(`/attendance/reports/students?from=${d.date}&to=${d.date}`)).body.summary;
      expect(d.pct).toBe(d.marked ? r.pct : null);
    }
    if (open) expect(t.attendance.at(-1)).toEqual({ date: today, attended: 2, marked: 4, pct: 50 });
  });

  it('follows permissions and campus scope', async () => {
    await createRole(A.tenantId, 'TREND_FEES', [PERMISSIONS.FEE_READ]);
    const acc = (await addMember(app, A.session, { label: 'TrendFees', roleCode: 'TREND_FEES' })).session;
    const t = (await get('/dashboard/trends', acc)).body;
    expect(t.collection).toHaveLength(30);
    expect(t.attendance).toBeUndefined();
    const n = (await get(`/dashboard/trends?campusId=${north}`)).body;
    expect(n.collection.every((d: { receipts: number }) => d.receipts === 0)).toBe(true);
    expect(n.attendance.every((d: { marked: number }) => d.marked === 0)).toBe(true);
    expect((await get(`/dashboard/trends?campusId=${main}`, B.session)).status).toBe(404);
  });
});
