/**
 * AC95–AC98 Placements, and Reports & exports (Phase 19): companies (blacklisted ones get no new drive);
 * one placement profile per student with CGPA / backlogs verified by the placement cell; only opted-in,
 * verified, eligible students apply while a drive is open, once, with an eligibility snapshot; offers only
 * for selected students, accepting marks them placed, a second accepted full-time offer is refused unless
 * the drive allows it; statistics match; reports run only with their right and campus; background exports
 * give the same rows in Excel and CSV, logged, downloadable only by their owner; saved reports private
 * unless shared; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';
import { ReportsService } from '../src/modules/reports/reports.service';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let officer: Session;
let viewer: Session;
let accountant: Session;
let asha: Session;
let bala: Session;
const ids: Record<string, string> = {};
const tag = Date.now().toString(36);
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const year = Number(today.slice(0, 4)) + 1;
const studentLogin = async (student: string, email: string) => {
  expect((await post(`/students/${student}/portal/student`, { email })).status).toBeLessThan(300);
  await setPassword(email, 'Student@Test123');
  const s = await login(app, email, 'Student@Test123');
  return s.tenantId ? s : switchTenant(app, s, A.tenantId);
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'PlcA');
  B = await createTenant(app, platform, 'PlcB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main College', campusType: 'DEGREE' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North College', campusType: 'DEGREE' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const yr = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const bca = (await post('/programs', { campusId: main, name: 'BCA', code: 'BCA', programType: 'UG', levelLabel: 'Year', durationLevels: 3 })).body;
  const bcom = (await post('/programs', { campusId: main, name: 'BCom', code: 'BCOM', programType: 'UG', levelLabel: 'Year', durationLevels: 3 })).body;
  ids.bca = bca.id; ids.bcom = bcom.id;
  for (const p of [bca, bcom]) await post('/sections', { academicYearId: yr, programLevelId: p.levels[2].id, names: ['A'], capacity: 60 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, prog, lvl] of [['1', 'Asha', 'BCA', bca.levels[2].name], ['2', 'Bala', 'BCA', bca.levels[2].name], ['3', 'Chitra', 'BCOM', bcom.levels[2].name], ['4', 'Dev', 'BCA', bca.levels[2].name]] as const) {
    const r: Record<string, string> = { admissionNo: `PL/${n}`, firstName: f, lastName: 'Test', dob: '2004-01-01', gender: n === '2' || n === '4' ? 'Boy' : 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: prog, className: lvl, section: 'A', fatherName: `${f} Father`, parentPhone: `98666000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await createRole(A.tenantId, 'PLACE_R', [PERMISSIONS.PLACE_READ, PERMISSIONS.PLACE_MANAGE, PERMISSIONS.STU_STUDENT_READ]);
  await createRole(A.tenantId, 'VIEW_R', [PERMISSIONS.PLACE_READ]);
  await createRole(A.tenantId, 'ACC_R', [PERMISSIONS.FEE_READ]);
  officer = (await addMember(app, A.session, { label: 'Officer', roleCode: 'PLACE_R', campusId: main })).session;
  viewer = (await addMember(app, A.session, { label: 'Viewer', roleCode: 'VIEW_R', campusId: north })).session;
  accountant = (await addMember(app, A.session, { label: 'Acc', roleCode: 'ACC_R', campusId: main })).session;
  asha = await studentLogin(ids.Asha, `plc.asha.${tag}@test.local`);
  bala = await studentLogin(ids.Bala, `plc.bala.${tag}@test.local`);
}, 180_000);
afterAll(() => app?.close());

describe('AC95 companies & profiles', () => {
  it('companies; blacklisted gets no drive; one profile per student with a verified score in range', async () => {
    const infy = await post('/placements/companies', { name: 'Infosys', industry: 'IT services', website: 'https://www.infosys.com', hrName: 'Ravi K', hrEmail: 'campus@infosys.example', status: 'ACTIVE' }, officer);
    expect(infy.status).toBe(201);
    ids.infy = infy.body.id;
    ids.wipro = (await post('/placements/companies', { name: 'Wipro', status: 'ACTIVE' }, officer)).body.id;
    expect((await post('/placements/companies', { name: 'infosys' }, officer)).status).toBe(409);
    expect((await post('/placements/companies', { name: 'Shady Ltd', status: 'BLACKLISTED' }, officer)).status).toBe(422);
    ids.shady = (await post('/placements/companies', { name: 'Shady Ltd', status: 'BLACKLISTED', blacklistReason: 'Did not honour offers in 2025' }, officer)).body.id;
    expect((await post('/placements/companies', { name: 'X' }, viewer)).status).toBe(403);
    const prof = (s: string, b: object) => put(`/placements/students/${s}/profile`, b, officer);
    expect((await prof(ids.Asha, { isOptedIn: true, passingYear: year, scoreType: 'CGPA', score: 8.4, backlogs: 0, skills: 'Java, SQL' })).status).toBe(200);
    expect((await prof(ids.Bala, { isOptedIn: true, passingYear: year, scoreType: 'CGPA', score: 6.2, backlogs: 2 })).status).toBe(200);
    expect((await prof(ids.Chitra, { isOptedIn: true, passingYear: year, scoreType: 'PERCENT', score: 78, backlogs: 0 })).status).toBe(200);
    expect((await prof(ids.Dev, { isOptedIn: false, passingYear: year, scoreType: 'CGPA', score: 9.1, backlogs: 0 })).status).toBe(200);
    expect((await prof(ids.Asha, { isOptedIn: true, passingYear: year, scoreType: 'CGPA', score: 11 })).status).toBe(422);
    expect((await prof(ids.Asha, { isOptedIn: true, passingYear: year, score: 8 })).status).toBe(422);
    const db = ownerDb();
    const p = await db.studentPlacementProfile.findFirstOrThrow({ where: { studentId: ids.Asha } });
    expect(p.scoreVerifiedBy).toBeTruthy();
    await expect(db.studentPlacementProfile.create({ data: { tenantId: A.tenantId, studentId: ids.Asha } })).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE student_placement_profiles SET score = 12 WHERE id = '${p.id}'`)).rejects.toThrow();
    await db.$disconnect();
    const list = (await get(`/placements/students?passingYear=${year}`, officer)).body;
    expect(list.map((s: { name: string }) => s.name).sort()).toEqual(['Asha Test', 'Bala Test', 'Chitra Test', 'Dev Test']);
    expect(list.find((s: { name: string }) => s.name === 'Asha Test')).toMatchObject({ program: 'BCA', profile: { score: '8.40', backlogs: 0 } });
  });
});

describe('AC96 drives & applications', () => {
  it('only eligible students apply, while open and before the last date, once, with a snapshot', async () => {
    const base = { campusId: main, title: 'Systems engineer', jobType: 'FULL_TIME', ctcMin: 360000, ctcMax: 450000, eligibleProgramIds: [ids.bca], passingYear: year, scoreType: 'CGPA', minScore: 7, maxBacklogs: 0, lastDateToApply: shift(5), driveDate: shift(10), rounds: ['Aptitude', 'Technical', 'HR'] };
    expect((await post('/placements/drives', { ...base, companyId: ids.shady }, officer)).status).toBe(409);
    expect((await post('/placements/drives', { ...base, companyId: ids.infy, campusId: north }, officer)).status).toBe(404);
    expect((await post('/placements/drives', { ...base, companyId: ids.infy, eligibleProgramIds: [ids.bca], ctcMin: 500000 }, officer)).status).toBe(422);
    const d = await post('/placements/drives', { ...base, companyId: ids.infy }, officer);
    expect(d.status).toBe(201);
    ids.drive = d.body.id;
    // Not open yet.
    const pre = await post(`/placements/children/${ids.Asha}/drives/${ids.drive}/apply`, {}, asha);
    expect(pre.status).toBe(409);
    const open = await post(`/placements/drives/${ids.drive}/status`, { status: 'OPEN' }, officer);
    expect(open.body).toMatchObject({ status: 'OPEN', told: 1 }); // only Asha is eligible and has a login
    const el = (await get(`/placements/drives/${ids.drive}/eligible`, officer)).body;
    const why = (n: string) => el.find((x: { name: string }) => x.name === n)?.reasons;
    expect(why('Asha Test')).toEqual([]);
    expect(why('Bala Test')).toEqual(['SCORE', 'BACKLOGS']);
    expect(why('Chitra Test')).toEqual(['PROGRAMME', 'SCORE_TYPE']);
    expect(why('Dev Test')).toBeUndefined(); // not opted in: not listed
    const view = (await get(`/placements/children/${ids.Asha}`, asha)).body;
    expect(view.openDrives).toEqual([expect.objectContaining({ id: ids.drive, eligible: true })]);
    expect((await post(`/placements/children/${ids.Bala}/drives/${ids.drive}/apply`, {}, bala)).body.type).toBe('not-eligible');
    expect((await post(`/placements/children/${ids.Bala}/drives/${ids.drive}/apply`, {}, asha)).status).toBe(404); // not her record
    const ap = await post(`/placements/children/${ids.Asha}/drives/${ids.drive}/apply`, {}, asha);
    expect(ap.status).toBe(201);
    ids.app = ap.body.id;
    expect((await post(`/placements/children/${ids.Asha}/drives/${ids.drive}/apply`, {}, asha)).body.type).toBe('already-applied');
    expect((await post(`/placements/drives/${ids.drive}/applications`, { studentIds: [ids.Bala] }, officer)).status).toBe(409);
    const db = ownerDb();
    const row = await db.placementApplication.findUniqueOrThrow({ where: { id: ids.app } });
    expect(row.eligibilitySnapshot).toMatchObject({ program: 'BCA', score: '8.40', backlogs: 0 });
    await expect(db.placementApplication.create({ data: { tenantId: A.tenantId, driveId: ids.drive, studentId: ids.Asha, appliedBy: row.appliedBy, eligibilitySnapshot: {} } })).rejects.toThrow();
    // The last date passes: no more applications.
    await db.placementDrive.update({ where: { id: ids.drive }, data: { lastDateToApply: new Date(`${shift(-1)}T00:00:00Z`), driveDate: null } });
    await db.studentPlacementProfile.updateMany({ where: { studentId: ids.Bala }, data: { score: 7.5, backlogs: 0 } });
    expect((await post(`/placements/children/${ids.Bala}/drives/${ids.drive}/apply`, {}, bala)).body.type).toBe('last-date-passed');
    await db.$disconnect();
    expect((await post(`/placements/drives/${ids.drive}/applications`, { studentIds: [ids.Bala] }, officer)).body).toEqual({ added: 1, already: 0 });
    expect((await get(`/placements/children/${ids.Asha}`, bala)).status).toBe(404);
  });

  it('rounds move forward; the student is told; withdrawn applications stay withdrawn', async () => {
    expect((await put(`/placements/applications/${ids.app}`, { status: 'SHORTLISTED', currentRound: 'Lunch' }, officer)).status).toBe(422);
    expect((await put(`/placements/applications/${ids.app}`, { status: 'SHORTLISTED', currentRound: 'Technical' }, officer)).status).toBe(200);
    const db = ownerDb();
    const u = await db.student.findUniqueOrThrow({ where: { id: ids.Asha }, select: { userId: true } });
    expect(await db.notification.count({ where: { userId: u.userId!, entityType: 'PLACEMENT_APPLICATION' } })).toBeGreaterThan(0);
    await db.$disconnect();
    const bApp = (await get(`/placements/drives/${ids.drive}`, officer)).body.applications.find((a: { name: string }) => a.name === 'Bala Test').id;
    expect((await post(`/placements/children/${ids.Bala}/applications/${bApp}/withdraw`, {}, bala)).body.status).toBe('WITHDRAWN');
    expect((await put(`/placements/applications/${bApp}`, { status: 'SHORTLISTED' }, officer)).status).toBe(409);
  });
});

describe('AC97 offers & statistics', () => {
  it('offers only for selected; accepting marks placed; a second full-time acceptance refused unless allowed; stats match', async () => {
    expect((await post(`/placements/applications/${ids.app}/offer`, { ctc: 420000, offerDate: today }, officer)).status).toBe(409);
    await put(`/placements/applications/${ids.app}`, { status: 'SELECTED' }, officer);
    const o = await post(`/placements/applications/${ids.app}/offer`, { ctc: 420000, offerDate: today, joiningDate: shift(200) }, officer);
    expect(o.status).toBe(201);
    expect((await post(`/placements/children/${ids.Asha}/offers/${o.body.id}`, { status: 'ACCEPTED' }, asha)).body.status).toBe('ACCEPTED');
    const db = ownerDb();
    expect((await db.studentPlacementProfile.findFirstOrThrow({ where: { studentId: ids.Asha } })).isPlaced).toBe(true);
    await db.$disconnect();
    // A second full-time drive: placed students are not eligible...
    const d2 = (await post('/placements/drives', { campusId: main, companyId: ids.wipro, title: 'Project engineer', jobType: 'FULL_TIME', eligibleProgramIds: [], passingYear: year, scoreType: 'CGPA', lastDateToApply: shift(5), rounds: [] }, officer)).body.id;
    await post(`/placements/drives/${d2}/status`, { status: 'OPEN' }, officer);
    expect((await post(`/placements/children/${ids.Asha}/drives/${d2}/apply`, {}, asha)).body.type).toBe('not-eligible');
    // ...unless the drive allows placed students: then a second acceptance is allowed.
    const d3 = (await post('/placements/drives', { campusId: main, companyId: ids.wipro, title: 'Dream offer', jobType: 'FULL_TIME', eligibleProgramIds: [], passingYear: year, scoreType: 'CGPA', allowPlaced: true, lastDateToApply: shift(5), rounds: [] }, officer)).body.id;
    await post(`/placements/drives/${d3}/status`, { status: 'OPEN' }, officer);
    const a3 = (await post(`/placements/children/${ids.Asha}/drives/${d3}/apply`, {}, asha)).body.id;
    await put(`/placements/applications/${a3}`, { status: 'SELECTED' }, officer);
    const o3 = (await post(`/placements/applications/${a3}/offer`, { ctc: 900000, offerDate: today }, officer)).body.id;
    expect((await post(`/placements/offers/${o3}/status`, { status: 'ACCEPTED' }, officer)).status).toBe(200);
    // If the drive does not allow placed students, a second full-time acceptance is refused.
    const dbx = ownerDb();
    await dbx.placementDrive.update({ where: { id: d3 }, data: { allowPlaced: false } });
    await dbx.placementOffer.update({ where: { id: o3 }, data: { status: 'OFFERED', decidedAt: null } });
    await dbx.$disconnect();
    expect((await post(`/placements/offers/${o3}/status`, { status: 'ACCEPTED' }, officer)).body.type).toBe('already-placed');
    expect((await post(`/placements/offers/${o3}/status`, { status: 'DECLINED' }, officer)).status).toBe(200);
    expect((await post(`/placements/offers/${o3}/status`, { status: 'ACCEPTED' }, officer)).status).toBe(409);
    const st = (await get(`/placements/stats?passingYear=${year}`, officer)).body;
    expect(st).toMatchObject({ optedIn: 3, placed: 1, placedPercent: 33.3, highestCtc: '420000.00', offers: 1 });
    expect(st.byProgram.find((p: { program: string }) => p.program === 'BCA')).toMatchObject({ opted: 2, placed: 1 });
    expect((await get('/placements/stats', viewer)).body.optedIn).toBe(0); // north campus only
  });
});

describe('AC98 reports & exports', () => {
  it('reports run only with their right and campus; exports match the screen in Excel and CSV; owner-only download; saved reports private unless shared', async () => {
    const cat = (await get('/reports/catalogue', officer)).body.map((r: { code: string }) => r.code);
    expect(cat).toEqual(expect.arrayContaining(['STUDENT_LIST', 'PLACEMENT_OFFERS']));
    expect(cat).not.toContain('FEE_DUES');
    expect((await post('/reports/run/FEE_DUES', {}, officer)).status).toBe(404);
    const screen = (await post('/reports/run/STUDENT_LIST', {}, officer)).body;
    expect(screen.total).toBe(4);
    expect((await post('/reports/run/PLACEMENT_OFFERS', { passingYear: year }, viewer)).body.total).toBe(0); // north only
    const offers = (await post('/reports/run/PLACEMENT_OFFERS', { passingYear: year }, officer)).body;
    expect(offers.rows.map((r: { company: string; status: string }) => `${r.company}:${r.status}`).sort()).toEqual(['Infosys:ACCEPTED', 'Wipro:DECLINED']);
    const x = await post('/reports/exports', { reportCode: 'STUDENT_LIST', format: 'XLSX' }, officer);
    const c = await post('/reports/exports', { reportCode: 'STUDENT_LIST', format: 'CSV' }, officer);
    expect([x.status, c.status]).toEqual([201, 201]);
    expect((await post('/reports/exports', { reportCode: 'FEE_DUES', format: 'CSV' }, officer)).status).toBe(404);
    expect(await app.get(ReportsService).processQueued()).toBeGreaterThanOrEqual(2);
    const mine = (await get('/reports/exports', officer)).body;
    expect(mine.filter((j: { status: string; rowCount: number }) => j.status === 'DONE' && j.rowCount === 4)).toHaveLength(2);
    const csv = await http().get(`${API}/reports/exports/${c.body.id}/file`).set(auth(officer));
    expect(csv.status).toBe(200);
    const text = csv.text.replace(/^﻿/, '').trim().split(/\r\n/);
    expect(text[0]).toBe('Admission no,Name,Class,Gender,Date of birth,Admitted on,Status');
    expect(text).toHaveLength(5);
    const xf = await http().get(`${API}/reports/exports/${x.body.id}/file`).set(auth(officer)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (d: Buffer) => b.push(d)); res.on('end', () => cb(null, Buffer.concat(b))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xf.body as Buffer);
    expect(wb.worksheets[0].rowCount).toBe(5);
    expect((await http().get(`${API}/reports/exports/${x.body.id}/file`).set(auth(accountant))).status).toBe(404);
    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'EXPORT_JOB', action: 'EXPORT' } })).toBe(2);
    await db.exportJob.update({ where: { id: c.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http().get(`${API}/reports/exports/${c.body.id}/file`).set(auth(officer))).body.type).toBe('export-expired');
    await db.$disconnect();
    // Saved reports.
    const s1 = await post('/reports/saved', { reportCode: 'STUDENT_LIST', name: 'Final-year students', filters: {}, isShared: false }, officer);
    expect(s1.status).toBe(201);
    await post('/reports/saved', { reportCode: 'FEE_COLLECTION', name: 'This month collection', filters: {}, isShared: true }, accountant);
    expect((await get('/reports/saved', officer)).body.map((r: { name: string }) => r.name)).toEqual(['Final-year students']); // the shared fee report is not his to run
    expect((await get('/reports/saved', A.session)).body.map((r: { name: string }) => r.name)).toEqual(['This month collection']);
    expect((await post(`/reports/saved/${s1.body.id}/delete`, {}, accountant)).status).toBe(404);
    // Schedule: a weekly saved report is queued once.
    await put(`/reports/saved/${s1.body.id}`, { reportCode: 'STUDENT_LIST', name: 'Final-year students', filters: {}, schedule: 'WEEKLY', scheduleFormat: 'CSV' }, officer);
    expect(await app.get(ReportsService).queueScheduled()).toBeGreaterThanOrEqual(1);
    const queued = (await get('/reports/exports', officer)).body.filter((j: { status: string }) => j.status === 'QUEUED');
    expect(queued).toHaveLength(1);
    await app.get(ReportsService).queueScheduled();
    expect((await get('/reports/exports', officer)).body.filter((j: { status: string }) => j.status === 'QUEUED')).toHaveLength(1);
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get('/placements/companies', B.session)).body).toEqual([]);
    expect((await get(`/placements/drives/${ids.drive}`, B.session)).status).toBe(404);
    expect((await put(`/placements/students/${ids.Asha}/profile`, { isOptedIn: true }, B.session)).status).toBe(404);
    expect((await get('/reports/exports', B.session)).body).toEqual([]);
    expect((await post('/reports/run/STUDENT_LIST', {}, B.session)).body.total).toBe(0);
  });
});
