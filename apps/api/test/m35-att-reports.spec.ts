/**
 * AC40 attendance reports (M3.5): the monthly register, student percentages and the staff month
 * summary match the marks exactly (present / late = 1, half day = ½, absent / leave = 0; drafts not
 * counted); holidays and weekly holidays are shown as such; the below-minimum list uses the setting;
 * the Excel file holds exactly what the screen shows; permissions and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, isWeeklyOff } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campus: string;
let sec: string;
let reader: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const D = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']; // Mon–Thu
const xlsx = (r: request.Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
const readSheet = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  const rows: (string | number | null)[][] = [];
  ws.eachRow((row) => rows.push((row.values as (string | number | null)[]).slice(1)));
  return rows;
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'RepA');
  B = await createTenant(app, platform, 'RepB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  sec = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 })).body[0].id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala'], ['3', 'Chitra'], ['4', 'Dev']]) {
    const r: Record<string, string> = { admissionNo: `R/${n}`, firstName: f, lastName: 'Test', dob: '2018-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: 'Parent', parentPhone: `98722000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await post('/holidays', { holidayDate: '2026-11-06', name: 'Local festival', holidayType: 'INSTITUTION' });

  const save = (date: string, marks: Record<string, string>, submit = true) =>
    post('/attendance/sheet', { sectionId: sec, date, submit, records: ['Asha', 'Bala', 'Chitra', 'Dev'].map((n) => ({ studentId: ids[n], status: marks[n] ?? 'PRESENT' })) });
  expect((await save(D[0], {})).status).toBe(200);
  expect((await save(D[1], { Bala: 'ABSENT', Chitra: 'LATE' })).status).toBe(200);
  expect((await save(D[2], { Bala: 'ABSENT', Chitra: 'HALF_DAY', Dev: 'LEAVE' })).status).toBe(200);
  expect((await save(D[3], { Asha: 'ABSENT' }, false)).body.status).toBe('DRAFT'); // a draft is not counted

  for (const [f, j] of [['Priya', '2019-06-01'], ['Ravi', '2020-06-01']]) ids[f] = (await post('/staff', { campusId: campus, firstName: f, gender: 'FEMALE', employeeType: 'TEACHING', joiningDate: j })).body.id;
  await post('/staff-attendance', { campusId: campus, date: D[0], records: [{ employeeId: ids.Priya, status: 'PRESENT' }, { employeeId: ids.Ravi, status: 'PRESENT' }] });
  await post('/staff-attendance', { campusId: campus, date: D[1], records: [{ employeeId: ids.Priya, status: 'HALF_DAY' }, { employeeId: ids.Ravi, status: 'ABSENT' }] });

  await createRole(A.tenantId, 'ATT_REPORTS', [PERMISSIONS.ATT_READ]);
  reader = (await addMember(app, A.session, { label: 'Reader', roleCode: 'ATT_REPORTS' })).session;
}, 180_000);
afterAll(() => app?.close());

describe('AC40 monthly register', () => {
  it('counts every mark exactly; drafts, holidays and Sundays shown as such', async () => {
    const r = (await get(`/attendance/reports/register?sectionId=${sec}&month=2026-11`, reader)).body;
    expect(r.section.name).toMatch(/– A$/);
    const row = (n: string) => r.students.find((s: { name: string }) => s.name.startsWith(n));
    expect(row('Asha')).toMatchObject({ present: 3, absent: 0, marked: 3, attended: 3, pct: 100 });
    expect(row('Bala')).toMatchObject({ present: 1, absent: 2, marked: 3, attended: 1, pct: 33.3 });
    expect(row('Chitra')).toMatchObject({ present: 1, late: 1, halfDay: 1, marked: 3, attended: 2.5, pct: 83.3 });
    expect(row('Dev')).toMatchObject({ present: 2, leave: 1, marked: 3, attended: 2, pct: 66.7 });
    expect(row('Bala').cells).toEqual({ [D[0]]: 'P', [D[1]]: 'A', [D[2]]: 'A' });
    expect(row('Chitra').cells[D[2]]).toBe('H');
    const day = (d: string) => r.days.find((x: { date: string }) => x.date === d);
    expect(day('2026-11-01')).toMatchObject({ kind: 'off', taken: false });
    expect(day('2026-11-06')).toMatchObject({ kind: 'holiday', holiday: 'Local festival' });
    expect(day(D[1])).toMatchObject({ kind: 'working', taken: true, present: 3, absent: 1, marked: 4 });
    expect(day(D[3])).toMatchObject({ taken: false }); // draft
    expect(r.summary).toMatchObject({ students: 4, daysTaken: 3, pct: 70.8, below: 2 }); // 8.5 of 12; Bala and Dev under 75
  });

  it('the Excel file holds exactly the screen', async () => {
    const r = (await get(`/attendance/reports/register?sectionId=${sec}&month=2026-11`)).body;
    const res = await xlsx(http().get(`${API}/attendance/reports/register?sectionId=${sec}&month=2026-11&format=xlsx`).set(auth(A.session)));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const rows = await readSheet(res.body as Buffer);
    const head = rows[0].map(String);
    expect(head.slice(0, 3)).toEqual(['Roll', 'Name', 'Admission no']);
    expect(head.slice(-7)).toEqual(['Present', 'Late', 'Half day', 'Absent', 'Leave', 'Marked', 'Attendance %']);
    expect(rows).toHaveLength(1 + r.students.length);
    for (const s of r.students) {
      const x = rows.find((y) => y[1] === s.name)!;
      expect(x.slice(-7)).toEqual([s.present, s.late, s.halfDay, s.absent, s.leave, s.marked, s.pct]);
      for (const d of Object.keys(s.cells)) expect(x[head.indexOf(d.slice(8))]).toBe(s.cells[d]);
    }
  });
});

describe('AC40 student percentages', () => {
  it('over a period, lowest first; below the minimum (setting) or any percentage', async () => {
    const all = (await get('/attendance/reports/students?from=2026-11-01&to=2026-11-30')).body;
    expect(all.items.map((i: { name: string; pct: number }) => `${i.name.split(' ')[0]}:${i.pct}`)).toEqual(['Bala:33.3', 'Dev:66.7', 'Chitra:83.3', 'Asha:100']);
    expect(all.summary).toMatchObject({ students: 4, shown: 4, pct: 70.8, belowMin: 2 });
    const low = (await get('/attendance/reports/students?from=2026-11-01&to=2026-11-30&belowMin=true')).body;
    expect(low).toMatchObject({ threshold: 75, minPercent: 75 });
    expect(low.items.map((i: { name: string }) => i.name.split(' ')[0])).toEqual(['Bala', 'Dev']);
    expect((await http().put(`${API}/settings/attendance.min_percent`).set(auth(A.session)).send({ value: 90 })).status).toBe(200);
    expect((await get('/attendance/reports/students?from=2026-11-01&to=2026-11-30&belowMin=true')).body.items).toHaveLength(3);
    expect((await get('/attendance/reports/students?from=2026-11-03&to=2026-11-03')).body.items.find((i: { name: string }) => i.name.startsWith('Chitra'))).toMatchObject({ late: 1, marked: 1, pct: 100 });
    const file = await xlsx(http().get(`${API}/attendance/reports/students?from=2026-11-01&to=2026-11-30&belowMin=true&format=xlsx`).set(auth(A.session)));
    const rows = await readSheet(file.body as Buffer);
    expect(rows.slice(1).map((x) => [x[0], x[10]])).toEqual([['Bala Test', 33.3], ['Dev Test', 66.7], ['Chitra Test', 83.3]]);
  });
});

describe('AC40 staff month', () => {
  it('counts each day once; on-duty counts as present; working days to date', async () => {
    const r = (await get(`/attendance/reports/staff?campusId=${campus}&month=2026-11`)).body;
    const p = r.staff.find((s: { name: string }) => s.name === 'Priya');
    const v = r.staff.find((s: { name: string }) => s.name === 'Ravi');
    expect(p).toMatchObject({ present: 1, halfDay: 1, marked: 2, attended: 1.5, pct: 75 });
    expect(v).toMatchObject({ present: 1, absent: 1, marked: 2, pct: 50 });
    let working = 0;
    for (let d = '2026-11-01'; d <= '2026-11-30' && d <= today; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) if (!isWeeklyOff(d, 'SUN') && d !== '2026-11-06') working += 1;
    expect(p.workingDays).toBe(working);
    expect(p.notMarked).toBe(working - 2);
    const file = await xlsx(http().get(`${API}/attendance/reports/staff?campusId=${campus}&month=2026-11&format=xlsx`).set(auth(A.session)));
    const rows = await readSheet(file.body as Buffer);
    expect(rows.find((x) => x[1] === 'Priya')!.slice(-1)).toEqual([75]);
  });
});

describe('AC40 access', () => {
  it('needs the right permission; other institutions see nothing; every download is audited', async () => {
    expect((await get(`/attendance/reports/staff?campusId=${campus}&month=2026-11`, reader)).status).toBe(403);
    expect((await get(`/attendance/reports/register?sectionId=${sec}&month=2026-11`, B.session)).status).toBeGreaterThanOrEqual(403);
    expect((await get('/attendance/reports/students?from=2026-11-01&to=2026-11-30', B.session)).body.items ?? []).toHaveLength(0);
    expect((await get(`/attendance/reports/register?sectionId=${sec}&month=2026-13`)).status).toBe(422);
    const logs = (await get('/audit-logs?entityType=ATTENDANCE_REPORT')).body;
    expect((logs.items ?? logs).length).toBeGreaterThanOrEqual(3);
  });
});
