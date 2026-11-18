/**
 * AC39 leave & staff attendance (M3.4): leave types with yearly limits; staff apply for themselves
 * (login linked to a staff record), the office applies for students; working days only; overlapping
 * leave refused; the limit is never exceeded (waiting requests count); approval through the engine
 * (approved at once without a rule); withdraw; approved leave shows as LEAVE on later sheets; staff
 * attendance: one record per person per day, only staff working that day, no future dates.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, isWeeklyOff, leaveDays } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campus: string;
let sec: string;
let teacher: Awaited<ReturnType<typeof addMember>>;
let unlinked: Session;
let approver: Session;
let approverRole: string;
const ids: Record<string, string> = {};
const types: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nextDow = (dow: number, from = today) => { let d = shift(from, 1); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== dow) d = shift(d, 1); return d; };
const workday = (n: number) => { let d = today; let k = -1; for (;;) { if (!isWeeklyOff(d, 'SUN')) k += 1; if (k === n) return d; d = shift(d, -1); } };

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'LeaveA');
  B = await createTenant(app, platform, 'LeaveB');
  campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  sec = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 })).body[0].id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala']]) {
    const r: Record<string, string> = { admissionNo: `L/${n}`, firstName: f, lastName: 'Test', dob: '2018-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: 'Parent', parentPhone: `98711000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;

  await createRole(A.tenantId, 'TEACHER', [PERMISSIONS.LEAVE_SELF, PERMISSIONS.ATT_READ, PERMISSIONS.ATT_MARK]);
  teacher = await addMember(app, A.session, { label: 'Teacher', roleCode: 'TEACHER' });
  unlinked = (await addMember(app, A.session, { label: 'Unlinked', roleCode: 'TEACHER' })).session;
  approverRole = await createRole(A.tenantId, 'LEAVE_APPROVER', [PERMISSIONS.LEAVE_READ]);
  approver = (await addMember(app, A.session, { label: 'Approver', roleCode: 'LEAVE_APPROVER' })).session;
  for (const [f, j] of [['Priya', '2019-06-01'], ['Ravi', '2020-06-01'], ['Gone', '2015-06-01']]) {
    ids[f] = (await post('/staff', { campusId: campus, firstName: f, gender: 'FEMALE', employeeType: 'TEACHING', joiningDate: j })).body.id;
  }
  await post(`/staff/${ids.Priya}/user`, { userId: teacher.userId });
  await post(`/staff/${ids.Gone}/status`, { status: 'RESIGNED', leftOn: shift(workday(2), -1) < '2015-06-02' ? '2015-06-02' : shift(workday(2), -1), reason: 'Moved city' });
}, 180_000);
afterAll(() => app?.close());

describe('working days', () => {
  it('skip weekly holidays and listed holidays; half day is 0.5', () => {
    // 2026-11-14 Sat, 15 Sun, 16 Mon
    expect(leaveDays('2026-11-14', '2026-11-16', false, 'SUN', new Set())).toBe(2);
    expect(leaveDays('2026-11-14', '2026-11-16', false, 'SUN_2ND_4TH_SAT', new Set())).toBe(1);
    expect(leaveDays('2026-11-16', '2026-11-20', false, 'SUN', new Set(['2026-11-18']))).toBe(4);
    expect(leaveDays('2026-11-16', '2026-11-16', true, 'SUN', new Set())).toBe(0.5);
  });
});

describe('AC39 leave types', () => {
  it('are set up by the office; codes are unique per kind', async () => {
    const cl = await post('/leave/types', { name: 'Casual leave', code: 'cl', appliesTo: 'EMPLOYEE', daysPerYear: 2 });
    expect(cl.status).toBe(201);
    expect(cl.body).toMatchObject({ code: 'CL', daysPerYear: 2, isPaid: true });
    types.CL = cl.body.id;
    types.LOP = (await post('/leave/types', { name: 'Loss of pay', code: 'LOP', appliesTo: 'EMPLOYEE', isPaid: false })).body.id;
    types.SICK = (await post('/leave/types', { name: 'Sick leave', code: 'SL', appliesTo: 'STUDENT' })).body.id;
    expect((await post('/leave/types', { name: 'Again', code: 'CL', appliesTo: 'EMPLOYEE' })).body.type).toBe('leave-code-taken');
    expect((await post('/leave/types', { name: 'Student CL', code: 'CL', appliesTo: 'STUDENT' })).status).toBe(201); // other kind
    expect((await post('/leave/types', { name: 'X', code: 'XX', appliesTo: 'EMPLOYEE' }, teacher.session)).status).toBe(403);
  });
});

describe('AC39 staff leave', () => {
  const sat = nextDow(6);
  const mon = shift(sat, 2);
  const apply = (b: Record<string, unknown>, s: Session = teacher.session) => post('/leave/requests', { applicantType: 'EMPLOYEE', leaveTypeId: types.CL, reason: 'Family function', ...b }, s);

  it('a teacher applies for herself: working days only; approved at once when there is no rule', async () => {
    const r = await apply({ fromDate: sat, toDate: mon });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'APPROVED', days: 2, employeeId: ids.Priya, approvalRequestId: null });
    const bal = (await get('/leave/balance?applicantType=EMPLOYEE', teacher.session)).body;
    expect(bal.types.find((t: { code: string }) => t.code === 'CL')).toMatchObject({ allowed: 2, taken: 2, waiting: 0, left: 0 });
  });

  it('refuses overlaps, days over the limit, holiday-only leave, and logins without a staff record', async () => {
    expect((await apply({ fromDate: mon, toDate: shift(mon, 1) })).body.type).toBe('leave-overlap');
    const b = await apply({ fromDate: shift(mon, 2), toDate: shift(mon, 2), halfDay: true });
    expect(b.body.type).toBe('leave-balance');
    expect(b.body.detail).toMatch(/Only 0 day/);
    expect((await apply({ leaveTypeId: types.LOP, fromDate: nextDow(0, mon), toDate: nextDow(0, mon) })).body.type).toBe('no-working-days'); // the Sunday after: no other leave
    expect((await apply({ fromDate: shift(mon, 3), toDate: shift(mon, 3) }, unlinked)).body.type).toBe('no-staff-record');
    expect((await apply({ leaveTypeId: types.SICK, fromDate: shift(mon, 3), toDate: shift(mon, 3) })).body.type).toBe('leave-type-invalid');
    expect((await apply({ employeeId: ids.Ravi, leaveTypeId: types.LOP, fromDate: shift(mon, 3), toDate: shift(mon, 3) })).status).toBe(404); // a teacher cannot apply for others
  });

  it('withdrawing future approved leave gives the days back', async () => {
    const mine = (await get('/leave/requests?mine=true', teacher.session)).body.items;
    expect(mine).toHaveLength(1);
    expect(mine[0].canCancel).toBe(true);
    expect((await post(`/leave/requests/${mine[0].id}/cancel`, {}, teacher.session)).body.status).toBe('CANCELLED');
    expect((await get('/leave/balance?applicantType=EMPLOYEE', teacher.session)).body.types.find((t: { code: string }) => t.code === 'CL').left).toBe(2);
  });

  it('with a rule it waits; waiting days count against the limit; the applicant can withdraw; approver decides', async () => {
    expect((await post('/approvals/rules', { entityType: 'LEAVE', levelNo: 1, approverRoleId: approverRole })).status).toBe(201);
    const r = await apply({ fromDate: mon, toDate: mon });
    expect(r.body).toMatchObject({ status: 'PENDING', days: 1, approvalRequestId: expect.any(String) });
    const r2 = await apply({ fromDate: shift(mon, 1), toDate: shift(mon, 1) });
    expect(r2.body.status).toBe('PENDING');
    expect((await apply({ fromDate: shift(mon, 2), toDate: shift(mon, 2) })).body.type).toBe('leave-balance'); // 2 waiting = limit
    expect((await post(`/leave/requests/${r2.body.id}/cancel`, {}, teacher.session)).body.status).toBe('CANCELLED');
    const inbox = (await get('/approvals/inbox', approver)).body;
    const req = (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === r.body.id);
    expect(req.summary).toMatch(/Priya \(EMP-0001\) · Casual leave · .* · 1 day/);
    await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, approver);
    const list = (await get('/leave/requests?applicantType=EMPLOYEE&status=APPROVED')).body.items;
    expect(list[0]).toMatchObject({ id: r.body.id, status: 'APPROVED', decidedByName: 'Approver User' });
  });
});

describe('AC39 student leave and sheets', () => {
  it('the office applies for a student; once approved, the class sheet shows LEAVE', async () => {
    const d = workday(0);
    const r = await post('/leave/requests', { applicantType: 'STUDENT', studentId: ids.Asha, leaveTypeId: types.SICK, fromDate: d, toDate: d, reason: 'Fever, doctor advised rest' });
    expect(r.body.status).toBe('PENDING');
    let s = (await get(`/attendance/sheet?sectionId=${sec}&date=${d}`)).body;
    expect(s.students.find((x: { id: string }) => x.id === ids.Asha).status).toBeNull(); // still waiting
    const inbox = (await get('/approvals/inbox', approver)).body;
    const req = (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === r.body.id);
    await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, approver);
    s = (await get(`/attendance/sheet?sectionId=${sec}&date=${d}`)).body;
    expect(s.students.find((x: { id: string }) => x.id === ids.Asha)).toMatchObject({ status: 'LEAVE', onLeave: { typeName: 'Sick leave' } });
    expect(s.students.find((x: { id: string }) => x.id === ids.Bala).status).toBeNull();
    // Leave that has started cannot be withdrawn.
    expect((await post(`/leave/requests/${r.body.id}/cancel`, {})).body.type).toBe('leave-started');
  });

  it('teachers without the student permission cannot apply for students; other institutions see nothing', async () => {
    expect((await post('/leave/requests', { applicantType: 'STUDENT', studentId: ids.Bala, leaveTypeId: types.SICK, fromDate: today, toDate: today, reason: 'Unwell' }, teacher.session)).status).toBe(404);
    expect((await get('/leave/requests?mine=true', teacher.session)).body.items.every((x: { employeeId: string }) => x.employeeId === ids.Priya)).toBe(true);
    expect((await get('/leave/requests', B.session)).body.total).toBe(0);
  });
});

describe('AC39 staff attendance', () => {
  it('lists staff working that day, with leave shown; one record per person per day; edits are kept', async () => {
    const d = workday(0);
    const s = (await get(`/staff-attendance?campusId=${campus}&date=${d}`)).body;
    expect(s.staff.map((x: { firstName: string }) => x.firstName).sort()).toEqual(['Priya', 'Ravi']); // Gone left before
    const first = await post('/staff-attendance', { campusId: campus, date: d, records: [
      { employeeId: ids.Priya, status: 'PRESENT', checkIn: '08:50', checkOut: '16:10' },
      { employeeId: ids.Ravi, status: 'ABSENT' },
    ] });
    expect(first.body).toMatchObject({ total: 2, counts: { PRESENT: 1, ABSENT: 1 }, changed: 0 });
    const again = await post('/staff-attendance', { campusId: campus, date: d, records: [
      { employeeId: ids.Priya, status: 'PRESENT', checkIn: '08:50', checkOut: '16:10' },
      { employeeId: ids.Ravi, status: 'ON_DUTY', remarks: 'Exam duty at the district office' },
    ] });
    expect(again.body.changed).toBe(1);
    const after = (await get(`/staff-attendance?campusId=${campus}&date=${d}`)).body;
    expect(after.saved).toBe(true);
    expect(after.staff.find((x: { id: string }) => x.id === ids.Ravi)).toMatchObject({ status: 'ON_DUTY', remarks: 'Exam duty at the district office' });
    expect(after.staff.find((x: { id: string }) => x.id === ids.Priya)).toMatchObject({ checkIn: '08:50', checkOut: '16:10' });
  });

  it('approved staff leave shows on the staff sheet; refuses future dates, strangers and times out of order', async () => {
    const mon = shift(nextDow(6), 2);
    expect((await get(`/staff-attendance?campusId=${campus}&date=${mon}`)).body.staff.find((x: { id: string }) => x.id === ids.Priya).onLeave).toMatchObject({ typeName: 'Casual leave' });
    expect((await post('/staff-attendance', { campusId: campus, date: shift(today, 1), records: [{ employeeId: ids.Ravi, status: 'PRESENT' }] })).body.type).toBe('date-in-future');
    expect((await post('/staff-attendance', { campusId: campus, date: workday(0), records: [{ employeeId: ids.Gone, status: 'PRESENT' }] })).body.type).toBe('not-on-roster');
    expect((await post('/staff-attendance', { campusId: campus, date: workday(0), records: [{ employeeId: ids.Ravi, status: 'PRESENT', checkIn: '10:00', checkOut: '09:00' }] })).status).toBe(422);
    expect((await post('/staff-attendance', { campusId: campus, date: workday(0), records: [{ employeeId: ids.Ravi, status: 'ABSENT', checkIn: '09:00' }] })).status).toBe(422);
    expect((await get(`/staff-attendance?campusId=${campus}&date=${workday(0)}`, teacher.session)).status).toBe(403);
  });
});
