/**
 * AC36 staff (M3.1): employee codes unique per institution (given or numbered automatically, skipping
 * codes typed in by hand); campus scope; the department must fit the campus; one active staff member
 * per mobile; leaving needs the last working day; a login links to one staff record only; import /
 * export round-trip; no hard delete; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let sci: string;
let northDept: string;
let northClerk: Awaited<ReturnType<typeof addMember>>;
let viewer: Session;
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const patch = (path: string, body: unknown, s: Session = A.session) => http().patch(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const person = (o: Record<string, unknown> = {}) => ({ campusId: main, firstName: 'Priya', lastName: 'Sharma', gender: 'FEMALE', employeeType: 'TEACHING', joiningDate: '2019-06-01', ...o });

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'StaffA');
  B = await createTenant(app, platform, 'StaffB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North Campus', campusType: 'SCHOOL' })).body.id;
  sci = (await post('/departments', { name: 'Science', code: 'SCI', deptType: 'ACADEMIC' })).body.id;
  northDept = (await post('/departments', { name: 'North Office', code: 'NOFF', deptType: 'ADMIN', campusId: north })).body.id;
  await createRole(A.tenantId, 'STAFF_CLERK', [PERMISSIONS.HR_STAFF_READ, PERMISSIONS.HR_STAFF_MANAGE]);
  northClerk = await addMember(app, A.session, { label: 'NorthClerk', roleCode: 'STAFF_CLERK', campusId: north });
  await createRole(A.tenantId, 'STAFF_VIEW', [PERMISSIONS.HR_STAFF_READ]);
  viewer = (await addMember(app, A.session, { label: 'Viewer', roleCode: 'STAFF_VIEW' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('AC36 staff records', () => {
  it('numbers staff automatically and skips codes already typed in by hand', async () => {
    const manual = await post('/staff', person({ employeeCode: 'emp-0002', firstName: 'Manual', phone: '9845000001' }));
    expect(manual.status).toBe(201);
    expect(manual.body.employeeCode).toBe('EMP-0002');
    const a = await post('/staff', person({ departmentId: sci, designation: 'Assistant Teacher', phone: '9845000002', email: 'Priya@School.in', dob: '1988-07-21' }));
    const b = await post('/staff', person({ firstName: 'Ravi', lastName: 'Kumar', gender: 'MALE', employeeType: 'NON_TEACHING' }));
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.employeeCode, b.body.employeeCode]).toEqual(['EMP-0001', 'EMP-0003']);
    expect(a.body).toMatchObject({ email: 'priya@school.in', department: { name: 'Science' }, campus: { code: 'MAIN' }, status: 'ACTIVE', joiningDate: '2019-06-01' });
    const dup = await post('/staff', person({ employeeCode: 'EMP-0001', firstName: 'Copy' }));
    expect(dup.status).toBe(409);
    expect(dup.body.type).toBe('employee-code-taken');
  });

  it('checks mobile, department and dates', async () => {
    const phone = await post('/staff', person({ firstName: 'Twin', phone: '9845000002' }));
    expect(phone.status).toBe(409);
    expect(phone.body.type).toBe('staff-phone-taken');
    expect((await post('/staff', person({ departmentId: northDept }))).body.type).toBe('department-other-campus');
    expect((await post('/staff', person({ dob: '2020-01-01' }))).status).toBe(422);
    expect((await post('/staff', person({ gender: 'X' }))).status).toBe(422);
  });

  it('search, filters, sort and paging', async () => {
    const names = async (qs: string) => (await get(`/staff?${qs}`)).body.items.map((e: { firstName: string }) => e.firstName);
    expect(await names('sort=code')).toEqual(['Priya', 'Manual', 'Ravi']);
    expect(await names('q=ravi kumar')).toEqual(['Ravi']);
    expect(await names('q=98450 00002')).toEqual(['Priya']);
    expect(await names('q=EMP-0002')).toEqual(['Manual']);
    expect(await names('employeeType=NON_TEACHING')).toEqual(['Ravi']);
    expect(await names(`departmentId=${sci}`)).toEqual(['Priya']);
    const p = (await get('/staff?sort=name&pageSize=2&page=2')).body;
    expect(p).toMatchObject({ total: 3, page: 2 });
  });

  it('edits; leaving needs the last working day; coming back frees nothing twice', async () => {
    const ravi = (await get('/staff?q=ravi')).body.items[0];
    const e = await patch(`/staff/${ravi.id}`, { designation: 'Office Assistant', phone: '9845000003', departmentId: null });
    expect(e.status).toBe(200);
    expect(e.body).toMatchObject({ designation: 'Office Assistant', phone: '9845000003', department: null });
    expect((await post(`/staff/${ravi.id}/status`, { status: 'RESIGNED', reason: 'Moved city' })).body.type).toBe('left-on-required');
    expect((await post(`/staff/${ravi.id}/status`, { status: 'RESIGNED', leftOn: '2010-01-01', reason: 'Moved city' })).body.type).toBe('left-before-joining');
    const left = await post(`/staff/${ravi.id}/status`, { status: 'RESIGNED', leftOn: today, reason: 'Moved city' });
    expect(left.status).toBe(201);
    expect(left.body).toMatchObject({ status: 'RESIGNED', leftOn: today });
    // His mobile is free again for a new person while he is away.
    expect((await post('/staff', person({ firstName: 'Newcomer', phone: '9845000003' }))).status).toBe(201);
    // Re-joining with the same mobile now clashes with the newcomer.
    expect((await post(`/staff/${ravi.id}/status`, { status: 'ACTIVE', reason: 'Re-joined' })).body.type).toBe('staff-phone-taken');
    const db = appDb();
    await expect(db.$executeRawUnsafe(`DELETE FROM employees WHERE id = '${ravi.id}'`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });

  it('a login links to one staff record only', async () => {
    const [priya, manual] = ['Priya', 'Manual'].map(async (n) => (await get(`/staff?q=${n}`)).body.items[0].id);
    const p = await priya;
    const m = await manual;
    const users = (await get(`/staff/${p}/linkable-users`)).body;
    expect(users.map((u: { id: string }) => u.id)).toContain(northClerk.userId);
    expect((await post(`/staff/${p}/user`, { userId: northClerk.userId })).body.user).toMatchObject({ fullName: 'NorthClerk User' });
    const again = await post(`/staff/${m}/user`, { userId: northClerk.userId });
    expect(again.status).toBe(409);
    expect(again.body.type).toBe('user-already-linked');
    expect((await get(`/staff/${m}/linkable-users`)).body.map((u: { id: string }) => u.id)).not.toContain(northClerk.userId);
    expect((await post(`/staff/${p}/user`, { userId: null })).body.userId).toBeNull();
    await createRole(B.tenantId, 'B_ROLE', []);
    const bUser = await addMember(app, B.session, { label: 'Bperson', roleCode: 'B_ROLE' });
    const outsider = await post(`/staff/${m}/user`, { userId: bUser.userId });
    expect(outsider.status).toBe(422);
  });
});

describe('AC36 scope, permissions and isolation', () => {
  it('a campus-limited clerk sees and adds only their campus', async () => {
    const s = northClerk.session;
    expect((await post('/staff', person(), s)).status).toBe(404); // MAIN is not theirs
    const n = await post('/staff', person({ campusId: north, firstName: 'Nalini', departmentId: northDept }), s);
    expect(n.status).toBe(201);
    expect((await get('/staff', s)).body.items.map((e: { firstName: string }) => e.firstName)).toEqual(['Nalini']);
    const priya = (await get('/staff?q=priya')).body.items[0].id;
    expect((await get(`/staff/${priya}`, s)).status).toBe(404);
    expect((await patch(`/staff/${priya}`, { designation: 'X' }, s)).status).toBe(404);
  });

  it('read-only staff cannot change; another institution sees nothing', async () => {
    const priya = (await get('/staff?q=priya')).body.items[0].id;
    expect((await get(`/staff/${priya}`, viewer)).body.canManage).toBe(false);
    expect((await patch(`/staff/${priya}`, { designation: 'X' }, viewer)).status).toBe(403);
    expect((await get(`/staff/${priya}`, B.session)).status).toBe(404);
    expect((await get('/staff', B.session)).body.total).toBe(0);
  });
});

describe('AC36 import / export', () => {
  const sheet = async (rows: Record<string, string>[]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(IMPORT_TYPES.STAFF.columns.map((c) => c.header));
    for (const r of rows) ws.addRow(IMPORT_TYPES.STAFF.columns.map((c) => r[c.key] ?? ''));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  it('checks every row, imports the valid file, and exports what it imported', async () => {
    const bad = await http().post(`${API}/imports/STAFF`).set(auth(A.session)).attach('file', await sheet([
      { firstName: 'Anil', gender: 'Male', campusCode: 'MAIN', employeeType: 'Teaching', joiningDate: '01-06-2020', employeeCode: 'EMP-0001' },
      { firstName: 'Bina', gender: 'F', campusCode: 'MAIN', employeeType: 'Driver', joiningDate: '2020-06-01', departmentCode: 'NOFF' },
      { firstName: 'Chetan', gender: 'Male', campusCode: 'XX', employeeType: 'Teaching', joiningDate: 'soon', phone: '9845000002' },
    ]), 's.xlsx');
    const errs = (await get(`/imports/jobs/${bad.body.id}/rows?status=INVALID`)).body.items.map((r: { errors: string[] }) => r.errors.join(' | '));
    expect(errs[0]).toMatch(/EMP-0001 is already used/);
    expect(errs[1]).toMatch(/Staff type/);
    expect(errs[1]).toMatch(/NOFF/);
    expect(errs[2]).toMatch(/Campus code/);
    expect(errs[2]).toMatch(/Joining date/);
    expect(errs[2]).toMatch(/already used by another staff member/);

    const good = await http().post(`${API}/imports/STAFF`).set(auth(A.session)).attach('file', await sheet([
      { firstName: 'Anil', lastName: 'Rao', gender: 'Male', campusCode: 'MAIN', departmentCode: 'SCI', designation: 'PGT Physics', employeeType: 'Teaching', joiningDate: '01-06-2020', phone: '98450 11111' },
      { employeeCode: 'DRV-01', firstName: 'Basava', gender: 'Male', campusCode: 'NORTH', departmentCode: 'NOFF', employeeType: 'Contract', joiningDate: '2023-04-10' },
    ]), 's.xlsx');
    expect((await post(`/imports/jobs/${good.body.id}/commit`, {})).status).toBeLessThan(300);
    const anil = (await get('/staff?q=anil')).body.items[0];
    expect(anil).toMatchObject({ employeeCode: 'EMP-0006', phone: '9845011111', designation: 'PGT Physics', joiningDate: '2020-06-01', department: { code: 'SCI' } });

    const exp = await http().get(`${API}/exports/STAFF?format=csv`).set(auth(A.session));
    expect(exp.status).toBe(200);
    const lines = exp.text.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Employee code,First name,Last name,Gender');
    expect(lines.find((l) => l.startsWith('DRV-01'))).toContain('Basava,,Male,,,,NORTH,NOFF,,Contract,2023-04-10,ACTIVE');
    expect(lines).toHaveLength(1 + 7);
  });
});
