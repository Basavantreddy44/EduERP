/**
 * AC75–AC78 HR (Phase 14): staff profile (PAN / bank encrypted, Aadhaar last 4 only, own profile only,
 * designations carried over / kept in step); shifts (late / half day from check-in); leave balances
 * (adjustments count, paid leave beyond the balance refused, approvals at once use the balance once,
 * cancelled leave gives it back, carry-forward up to the limit and only once); exits (no-dues by
 * section owners, close only when all cleared and on / after the last day, login removed); isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let hr: Session;
let priya: Session;
let ravi: { session: Session; userId: string };
let accts: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The first Monday at least n days ahead (whole working weeks, whatever day the suite runs). */
const monday = (n: number) => { let d = shift(today, n); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = shift(d, 1); return d; };
/** The most recent past Monday–Friday. */
const pastWorkday = () => { let d = shift(today, -1); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = shift(d, -1); return d; };

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'HrA');
  B = await createTenant(app, platform, 'HrB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  const ys = `${shift(today, -150).slice(0, 4)}-${shift(today, -150).slice(5, 7)}-01`;
  const ye = new Date(Date.parse(`${ys}T00:00:00Z`)); ye.setUTCMonth(ye.getUTCMonth() + 12); ye.setUTCDate(0);
  ids.year = (await post('/academic-years', { name: `${ys.slice(0, 4)}-${ye.toISOString().slice(2, 4)}`, startDate: ys, endDate: ye.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const pe = new Date(Date.parse(`${ys}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const ps = `${Number(ys.slice(0, 4)) - 1}${ys.slice(4)}`;
  ids.prevYear = (await post('/academic-years', { name: `${ps.slice(0, 4)}-${ys.slice(2, 4)}`, startDate: ps, endDate: pe })).body.id;
  for (const [k, first, campus] of [['priya', 'Priya', main], ['ravi', 'Ravi', main], ['sunil', 'Sunil', north]] as const) {
    ids[k] = (await post('/staff', { campusId: campus, firstName: first, gender: k === 'priya' ? 'FEMALE' : 'MALE', employeeType: 'TEACHING', designation: 'Assistant Teacher', joiningDate: shift(today, -500) })).body.id;
  }
  await createRole(A.tenantId, 'HR_MAIN', [PERMISSIONS.HR_PROFILE_READ, PERMISSIONS.HR_PROFILE_MANAGE, PERMISSIONS.HR_SETUP, PERMISSIONS.HR_EXIT, PERMISSIONS.LEAVE_STAFF, PERMISSIONS.LEAVE_READ, PERMISSIONS.STAFF_ATT_MARK]);
  await createRole(A.tenantId, 'HR_STAFF', [PERMISSIONS.LEAVE_SELF, PERMISSIONS.LEAVE_READ]);
  await createRole(A.tenantId, 'HR_ACCTS', [PERMISSIONS.ACC_READ, PERMISSIONS.ACC_ENTRY]);
  hr = (await addMember(app, A.session, { label: 'HrMain', roleCode: 'HR_MAIN', campusId: main })).session;
  const p = await addMember(app, A.session, { label: 'PriyaHr', roleCode: 'HR_STAFF' });
  priya = p.session;
  await post(`/staff/${ids.priya}/user`, { userId: p.userId });
  ravi = await addMember(app, A.session, { label: 'RaviHr', roleCode: 'HR_STAFF' });
  await post(`/staff/${ids.ravi}/user`, { userId: ravi.userId });
  accts = (await addMember(app, A.session, { label: 'AcctsHr', roleCode: 'HR_ACCTS' })).session;
}, 180_000);
afterAll(() => app?.close());

describe('AC75 staff profile', () => {
  it('designations: free-text titles become designations; renaming keeps the staff list in step', async () => {
    const d = await post('/hr/designations', { code: 'TGT', name: 'Trained Graduate Teacher', category: 'TEACHING' }, hr);
    expect(d.status).toBe(201);
    ids.tgt = d.body.id;
    expect((await post('/hr/designations', { code: 'tgt', name: 'Other', category: 'TEACHING' }, hr)).status).toBe(409);
    expect((await put(`/hr/staff/${ids.priya}`, { designationId: ids.tgt }, hr)).status).toBe(200);
    await put(`/hr/designations/${ids.tgt}`, { code: 'TGT', name: 'Graduate Teacher (TGT)', category: 'TEACHING' }, hr);
    expect((await get(`/staff/${ids.priya}`)).body.designation).toBe('Graduate Teacher (TGT)');
    expect((await get('/hr/designations', hr)).body.find((x: { id: string }) => x.id === ids.tgt)).toMatchObject({ staff: 1 });
  });

  it('PAN and bank number are encrypted, shown as the last 4, kept on edit; Aadhaar only the last 4', async () => {
    expect((await put(`/hr/staff/${ids.priya}`, { aadhaarLast4: '123456789012' }, hr)).status).toBe(422);
    const r = await put(`/hr/staff/${ids.priya}`, { designationId: ids.tgt, pan: 'abcpk1234q', aadhaarLast4: '9012', uanNo: '100200300400', bankName: 'Canara Bank', bankAccountNo: '0412 2010 0045 6789', ifsc: 'cnrb0000412', bloodGroup: 'O+', emergencyContactName: 'Kiran', emergencyContactPhone: '9845011122' }, hr);
    expect(r.status).toBe(200);
    const v = (await get(`/hr/staff/${ids.priya}`, hr)).body;
    expect(v.details).toMatchObject({ pan: '••••234Q', bankAccount: '••••6789', aadhaar: 'XXXX XXXX 9012', ifsc: 'CNRB0000412', bloodGroup: 'O+' });
    expect(JSON.stringify(v)).not.toContain('ABCPK1234Q');
    const db = ownerDb();
    const row = await db.employeeDetail.findFirstOrThrow({ where: { employeeId: ids.priya } });
    expect(row.panEnc).toMatch(/^v1:/);
    expect(row.bankAccountEnc).not.toContain('6789');
    const logs = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'EMPLOYEE_PROFILE' } });
    expect(JSON.stringify(logs)).not.toContain('ABCPK1234Q');
    await db.$disconnect();
    // Edit without re-typing: kept.
    await put(`/hr/staff/${ids.priya}`, { designationId: ids.tgt, bloodGroup: 'A+' }, hr);
    expect((await get(`/hr/staff/${ids.priya}`, hr)).body.details).toMatchObject({ pan: '••••234Q', bankAccount: '••••6789', bloodGroup: 'A+' });
    expect((await post(`/hr/staff/${ids.priya}/reveal`, { field: 'pan' }, hr)).status).toBe(403);
    expect((await post(`/hr/staff/${ids.priya}/reveal`, { field: 'pan' })).body).toEqual({ value: 'ABCPK1234Q' });
  });

  it('staff see only their own profile; HR only their campuses', async () => {
    expect((await get(`/hr/staff/${ids.priya}`, priya)).body.isSelf).toBe(true);
    expect((await get(`/hr/staff/${ids.ravi}`, priya)).status).toBe(404);
    expect((await put(`/hr/staff/${ids.priya}`, { bloodGroup: 'B+' }, priya)).status).toBe(403);
    expect((await get('/hr/me', priya)).body).toEqual({ employeeId: ids.priya });
    expect((await get(`/hr/staff/${ids.sunil}`, hr)).status).toBe(404); // North campus
    expect((await post(`/hr/staff/${ids.priya}/qualifications`, { qualification: 'B.Ed', institution: 'Bangalore University', yearOfPassing: 2012, percentage: 71.5 }, hr)).status).toBe(201);
    expect((await post(`/hr/staff/${ids.priya}/experiences`, { organisation: 'Sri Vidya School', designation: 'Teacher', fromDate: '2012-06-01', toDate: '2016-03-31' }, hr)).status).toBe(201);
    const v = (await get(`/hr/staff/${ids.priya}`, priya)).body;
    expect(v.qualifications).toEqual([expect.objectContaining({ qualification: 'B.Ed', percentage: 71.5 })]);
    expect(v.experiences).toHaveLength(1);
  });
});

describe('AC76 shifts & staff attendance', () => {
  it('late and half day follow the shift times', async () => {
    expect((await post('/hr/shifts', { campusId: main, name: 'Morning', startTime: '08:30', endTime: '15:30', lateAfterMinutes: 10, halfDayAfterMinutes: 120 }, hr)).status).toBe(201);
    ids.morning = (await get('/hr/shifts', hr)).body.find((s: { name: string }) => s.name === 'Morning').id;
    expect((await post('/hr/shifts', { campusId: north, name: 'North', startTime: '09:00', endTime: '16:00', lateAfterMinutes: 10, halfDayAfterMinutes: 120 }, hr)).status).toBe(404);
    expect((await post('/hr/shifts/assign', { shiftId: ids.morning, employeeIds: [ids.priya, ids.ravi] }, hr)).body).toEqual({ assigned: 2 });
    const d = pastWorkday();
    const s = await post('/staff-attendance', { campusId: main, date: d, records: [{ employeeId: ids.priya, status: 'PRESENT', checkIn: '08:35' }, { employeeId: ids.ravi, status: 'PRESENT', checkIn: '10:45' }] }, hr);
    expect(s.status).toBeLessThan(300);
    const db = ownerDb();
    const rows = await db.staffAttendance.findMany({ where: { tenantId: A.tenantId, attendanceDate: new Date(`${d}T00:00:00Z`) }, select: { employeeId: true, status: true, lateMinutes: true } });
    await db.$disconnect();
    expect(rows.find((r) => r.employeeId === ids.priya)).toMatchObject({ status: 'PRESENT', lateMinutes: 0 });
    expect(rows.find((r) => r.employeeId === ids.ravi)).toMatchObject({ status: 'HALF_DAY', lateMinutes: 135 });
  });
});

describe('AC77 leave balances', () => {
  it('adjustments count; paid leave beyond the balance is refused; unpaid leave is allowed', async () => {
    ids.cl = (await post('/leave/types', { name: 'Casual leave', code: 'CL', appliesTo: 'EMPLOYEE', daysPerYear: 2 })).body.id;
    ids.lop = (await post('/leave/types', { name: 'Loss of pay', code: 'LOP', appliesTo: 'EMPLOYEE', isPaid: false })).body.id;
    expect((await post('/hr/leave-balances/adjust', { employeeId: ids.priya, leaveTypeId: ids.cl, academicYearId: ids.year, kind: 'OPENING', days: 1.5, reason: 'Balance from the old register' }, hr)).status).toBe(201);
    expect((await post('/hr/leave-balances/adjust', { employeeId: ids.priya, leaveTypeId: ids.cl, academicYearId: ids.year, kind: 'ENCASHMENT', days: 5, reason: 'Wrong sign' }, hr)).status).toBe(422);
    const bal = (await get(`/hr/leave-balances?yearId=${ids.year}&employeeId=${ids.priya}`, hr)).body.rows[0].balances.find((b: { code: string }) => b.code === 'CL');
    expect(bal).toMatchObject({ allowance: 2, adjustments: 1.5, left: 3.5 });
    expect((await get('/leave/balance?applicantType=EMPLOYEE', priya)).body.types.find((t: { code: string }) => t.code === 'CL')).toMatchObject({ allowed: 3.5, left: 3.5 });
    const d1 = monday(14);
    const four = await post('/leave/requests', { applicantType: 'EMPLOYEE', leaveTypeId: ids.cl, reason: 'Family function', fromDate: d1, toDate: shift(d1, 3) }, priya);
    expect(four.body.type).toBe('leave-balance');
    const ok = await post('/leave/requests', { applicantType: 'EMPLOYEE', leaveTypeId: ids.cl, reason: 'Family function', fromDate: d1, toDate: d1 }, priya);
    expect(ok.body.status).toBe('APPROVED');
    ids.leave1 = ok.body.id;
    expect((await post('/leave/requests', { applicantType: 'EMPLOYEE', leaveTypeId: ids.lop, reason: 'Personal', fromDate: monday(21), toDate: monday(21) }, priya)).body.status).toBe('APPROVED');
    expect((await get(`/hr/leave-balances?yearId=${ids.year}&employeeId=${ids.priya}`, priya)).body.rows[0].balances.find((b: { code: string }) => b.code === 'CL')).toMatchObject({ approved: 1, left: 2.5 });
  });

  it('two applications at once use the balance once; a cancelled leave gives it back', async () => {
    // Ravi has 2 days; two 2-day applications at the same moment — only one fits.
    const a = monday(28); const b = monday(35);
    const both = await Promise.all([[a, shift(a, 1)], [b, shift(b, 1)]].map(([f, t]) => post('/leave/requests', { applicantType: 'EMPLOYEE', leaveTypeId: ids.cl, reason: 'Trip', fromDate: f, toDate: t }, ravi.session)));
    const okOne = both.filter((r) => r.status === 201);
    expect(okOne).toHaveLength(1);
    expect(both.find((r) => r.status !== 201)!.body.type).toBe('leave-balance');
    expect((await post(`/leave/requests/${okOne[0].body.id}/cancel`, {}, ravi.session)).body.status).toBe('CANCELLED');
    expect((await get(`/hr/leave-balances?yearId=${ids.year}&employeeId=${ids.ravi}`, hr)).body.rows[0].balances.find((x: { code: string }) => x.code === 'CL')).toMatchObject({ left: 2 });
  });

  it('carry-forward up to the limit, only once', async () => {
    expect((await put(`/hr/leave-types/${ids.cl}/carry-limit`, { carryForwardMax: 1 }, A.session)).body.carryForwardMax).toBe(1);
    // Last year: Ravi had the full 2 days unused → 1 carried (limit); Priya too.
    const r = await post('/hr/leave-balances/carry-forward', { fromYearId: ids.prevYear, toYearId: ids.year }, A.session);
    expect(r.body.added).toBeGreaterThanOrEqual(2);
    expect((await post('/hr/leave-balances/carry-forward', { fromYearId: ids.prevYear, toYearId: ids.year }, A.session)).body.added).toBe(0);
    const ra = (await get(`/hr/leave-balances?yearId=${ids.year}&employeeId=${ids.ravi}`, hr)).body.rows[0].balances.find((x: { code: string }) => x.code === 'CL');
    expect(ra).toMatchObject({ adjustments: 1, left: 3 });
    expect((await post('/hr/leave-balances/carry-forward', { fromYearId: ids.prevYear, toYearId: ids.year }, hr)).status).toBe(404); // campus HR cannot run the institution-wide year end
  });
});

describe('AC78 exits', () => {
  it('only after every section is cleared by its owner, on or after the last day; then the login is removed', async () => {
    expect((await post('/hr/exits', { employeeId: ids.ravi, exitType: 'RESIGNATION', resignationDate: shift(today, -30), lastWorkingDate: shift(today, -31), reason: 'Moving to Mysuru' }, hr)).status).toBe(422);
    const x = await post('/hr/exits', { employeeId: ids.ravi, exitType: 'RESIGNATION', resignationDate: shift(today, -30), lastWorkingDate: shift(today, 3), reason: 'Moving to Mysuru', handoverToId: ids.priya, sections: ['ACCOUNTS', 'ADMIN'] }, hr);
    expect(x.status).toBe(201);
    ids.exit = x.body.id;
    expect((await post('/hr/exits', { employeeId: ids.ravi, exitType: 'RESIGNATION', resignationDate: today, lastWorkingDate: today, reason: 'Again' }, hr)).status).toBe(409);
    expect((await post(`/hr/exits/${ids.exit}/clear/ADMIN`, {}, accts)).status).toBe(403);
    expect((await get('/hr/exits', accts)).body.map((e: { myPending: string[] }) => e.myPending)).toEqual([['ACCOUNTS']]);
    expect((await post(`/hr/exits/${ids.exit}/clear/ACCOUNTS`, { dueAmount: 0, remarks: 'Salary advance recovered' }, accts)).body.status).toBe('CLEARED');
    expect((await post(`/hr/exits/${ids.exit}/clear/ACCOUNTS`, {}, accts)).status).toBe(409);
    expect((await post(`/hr/exits/${ids.exit}/close`, { settlementAmount: 18500 }, hr)).body.type).toBe('dues-pending');
    expect((await post(`/hr/exits/${ids.exit}/clear/ADMIN`, { dueAmount: 0 }, A.session)).status).toBe(200);
    expect((await post(`/hr/exits/${ids.exit}/close`, { settlementAmount: 18500 }, hr)).body.type).toBe('before-last-day');
    // Bring the last day to today and close.
    const db = ownerDb();
    await db.employeeExit.update({ where: { id: ids.exit }, data: { lastWorkingDate: new Date(`${today}T00:00:00Z`) } });
    await db.$disconnect();
    const c = await post(`/hr/exits/${ids.exit}/close`, { settlementAmount: 18500 }, hr);
    expect(c.body).toMatchObject({ status: 'CLOSED', loginRemoved: true });
    expect((await get(`/staff/${ids.ravi}`)).body.status).toBe('RESIGNED');
    expect((await get('/hr/me', ravi.session)).status).toBeGreaterThanOrEqual(401); // access to the institution is gone
    expect((await get(`/hr/exits/${ids.exit}`, hr)).body).toMatchObject({ status: 'CLOSED', settlementAmount: '18500.00', canClose: false });
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get(`/hr/staff/${ids.priya}`, B.session)).status).toBe(404);
    expect((await get('/hr/designations', B.session)).body.find((d: { id: string }) => d.id === ids.tgt)).toBeUndefined();
    expect((await get('/hr/shifts', B.session)).body).toEqual([]);
    expect((await get('/hr/exits', B.session)).body).toEqual([]);
    expect((await get(`/hr/exits/${ids.exit}`, B.session)).status).toBe(404);
    expect((await post('/hr/shifts/assign', { shiftId: ids.morning, employeeIds: [ids.priya] }, B.session)).status).toBe(404);
  });
});
