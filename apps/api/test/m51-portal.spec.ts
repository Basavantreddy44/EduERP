/**
 * AC44 parent & student logins (M5.1): a parent sees only linked children, a student only themself;
 * staff permissions never come from a portal link; removing a link or the student leaving ends
 * access; a person can be staff and parent; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
const ids: Record<string, string> = {};
const guardian: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const del = (path: string, s: Session = A.session) => http().delete(`${API}${path}`).set(auth(s));
const tag = Date.now().toString(36);
const PARENT = `parent.${tag}@test.local`;
const KID = `kid.${tag}@test.local`;
const PW = 'Parent@Test123';

async function signIn(email: string): Promise<Session> {
  await setPassword(email, PW);
  const s = await login(app, email, PW);
  return s.tenantId ? s : switchTenant(app, s, A.tenantId);
}
const names = (r: request.Response) => r.body.children.map((c: { name: string; relation: string }) => `${c.name.split(' ')[0]}:${c.relation}`);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'PortA');
  B = await createTenant(app, platform, 'PortB');
  await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' });
  const year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: (await get('/campuses')).body[0].id, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, email] of [['1', 'Asha', ''], ['2', 'Bala', `bala.home.${tag}@test.local`], ['3', 'Chitra', ''], ['4', 'Dev', '']]) {
    const r: Record<string, string> = { admissionNo: `P/${n}`, firstName: f, lastName: 'Test', dob: '2015-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: `${f} Father`, parentPhone: `98744000${n}0`, parentEmail: email, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const n of ['Asha', 'Bala', 'Chitra', 'Dev']) guardian[n] = (await get(`/students/${ids[n]}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
}, 180_000);
afterAll(() => app?.close());

describe('AC44 office gives logins', () => {
  it('lists who has a login; an email is needed; the guardian is invited', async () => {
    const before = (await get(`/students/${ids.Asha}/portal`)).body;
    expect(before.map((r: { kind: string; login: string }) => `${r.kind}:${r.login}`)).toEqual(['GUARDIAN:NONE', 'STUDENT:NONE']);
    expect((await post(`/students/${ids.Asha}/portal/guardians/${guardian.Asha}`, {})).body.type).toBe('email-required');
    expect((await post(`/students/${ids.Asha}/portal/guardians/${guardian.Asha}`, { email: PARENT })).status).toBe(200);
    const after = (await get(`/students/${ids.Asha}/portal`)).body;
    expect(after[0]).toMatchObject({ kind: 'GUARDIAN', email: PARENT, login: 'INVITED', relation: 'FATHER' });
    // The email on file is used when none is given.
    expect((await post(`/students/${ids.Bala}/portal/guardians/${guardian.Bala}`, {})).body.email).toBe(`bala.home.${tag}@test.local`);
  });

  it('only staff who can edit students may do it', async () => {
    await createRole(A.tenantId, 'PORT_READER', [PERMISSIONS.STU_STUDENT_READ]);
    const r = (await addMember(app, A.session, { label: 'Reader', roleCode: 'PORT_READER' })).session;
    expect((await get(`/students/${ids.Asha}/portal`, r)).status).toBe(200);
    expect((await post(`/students/${ids.Dev}/portal/guardians/${guardian.Dev}`, { email: `x.${tag}@test.local` }, r)).status).toBe(403);
  });
});

describe('AC44 a parent sees only their children', () => {
  let parent: Session;
  it('one login for two children (siblings at the same school)', async () => {
    parent = await signIn(PARENT);
    expect(names(await get('/portal/me', parent))).toEqual(['Asha:FATHER']);
    expect((await post(`/students/${ids.Chitra}/portal/guardians/${guardian.Chitra}`, { email: PARENT })).status).toBe(200);
    expect(names(await get('/portal/me', parent))).toEqual(['Asha:FATHER', 'Chitra:FATHER']);
    expect((await get(`/students/${ids.Asha}/portal`)).body[0].login).toBe('ACTIVE');
  });

  it('no staff screens: a portal link carries no permission', async () => {
    for (const path of ['/students', `/students/${ids.Asha}`, '/fees/dues', '/attendance/options', `/students/${ids.Asha}/portal`]) {
      expect([path, (await get(path, parent)).status]).toEqual([path, 403]);
    }
    expect((await get('/me/permissions', parent)).body.permissions).toEqual([]);
  });

  it('a student who leaves drops out of the app; removing a link ends access to that child', async () => {
    const db = ownerDb();
    try {
      await db.student.update({ where: { id: ids.Chitra }, data: { status: 'TRANSFERRED' } });
      expect(names(await get('/portal/me', parent))).toEqual(['Asha:FATHER']);
      await db.student.update({ where: { id: ids.Chitra }, data: { status: 'ACTIVE' } });
    } finally { await db.$disconnect(); }
    expect((await del(`/students/${ids.Chitra}/portal/guardians/${guardian.Chitra}`)).body).toEqual({ removed: true, accessEnded: false });
    expect(names(await get('/portal/me', parent))).toEqual(['Asha:FATHER']);
  });

  it('removing the last link ends access to the institution', async () => {
    expect((await del(`/students/${ids.Asha}/portal/guardians/${guardian.Asha}`)).body).toEqual({ removed: true, accessEnded: true });
    expect((await get('/portal/me', parent)).body.type).toBe('membership-inactive');
    expect((await del(`/students/${ids.Asha}/portal/guardians/${guardian.Asha}`)).status).toBe(404); // nothing left to remove
  });
});

describe('AC44 student login', () => {
  it('a student sees only themself; one login per student', async () => {
    expect((await post(`/students/${ids.Dev}/portal/student`, {})).body.type).toBe('email-required');
    expect((await post(`/students/${ids.Dev}/portal/student`, { email: KID })).status).toBe(200);
    expect((await post(`/students/${ids.Bala}/portal/student`, { email: KID })).body.type).toBe('login-in-use');
    const kid = await signIn(KID);
    expect(names(await get('/portal/me', kid))).toEqual(['Dev:SELF']);
    expect((await get('/students', kid)).status).toBe(403);
  });
});

describe('AC44 staff who are also parents', () => {
  it('keeps the staff role; removing the parent link keeps the membership', async () => {
    await createRole(A.tenantId, 'PORT_TEACHER', [PERMISSIONS.ATT_READ]);
    const t = await addMember(app, A.session, { label: 'TeacherParent', roleCode: 'PORT_TEACHER' });
    expect((await post(`/students/${ids.Dev}/portal/guardians/${guardian.Dev}`, { email: t.email })).status).toBe(200);
    expect(names(await get('/portal/me', t.session))).toEqual(['Dev:FATHER']);
    expect((await get('/attendance/options', t.session)).status).toBe(200);
    expect((await del(`/students/${ids.Dev}/portal/guardians/${guardian.Dev}`)).body).toEqual({ removed: true, accessEnded: false });
    expect((await get('/portal/me', t.session)).body).toEqual({ hasPortal: false, children: [] });
    expect((await get('/attendance/options', t.session)).status).toBe(200);
  });
});

describe('AC44 isolation', () => {
  it('another institution cannot see or change these logins', async () => {
    expect((await get(`/students/${ids.Bala}/portal`, B.session)).status).toBe(404);
    expect((await post(`/students/${ids.Bala}/portal/guardians/${guardian.Bala}`, { email: `evil.${tag}@test.local` }, B.session)).status).toBe(404);
    expect((await get('/portal/me', B.session)).body).toEqual({ hasPortal: false, children: [] });
  });
});
