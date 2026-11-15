/**
 * AC34 promotion & AC35 Transfer Certificate (M1.4).
 * Promotion: the preview changes nothing and lists missing sections / too few seats; commit is refused
 * while problems remain; each class moves up (same section name or mapped), the final class passes out,
 * chosen students are detained, fees for the new year are assigned, a re-run changes nothing.
 * TC: refused while fees are due; otherwise numbered, the student marked transferred, the class place
 * closed and future fees stopped; only one per student; permissions and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let clerk: Session;
let y1: string;
let y2: string;
const lv: Record<string, string> = {};
const sec: Record<string, string> = {};
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plan = (extra: Record<string, unknown> = {}) => ({ fromYearId: y1, toYearId: y2, programLevelIds: [lv.c1, lv.c3], detainIds: [ids.Chitra], ...extra });
const enrolments = async (name: string) => {
  const db = ownerDb();
  const r = await db.studentEnrollment.findMany({ where: { studentId: ids[name] }, include: { academicYear: true, section: { include: { level: true } } }, orderBy: { createdAt: 'asc' } });
  await db.$disconnect();
  return r.map((e) => `${e.academicYear.name} ${e.section.level.name}-${e.section.name} ${e.status}`);
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'LifeA');
  B = await createTenant(app, platform, 'LifeB');
  const campus = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  y1 = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  y2 = (await post('/academic-years', { name: '2027-28', startDate: '2027-06-01', endDate: '2028-03-31' })).body.id;
  const prog = (await post('/programs', { campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  [lv.c1, lv.c2, lv.c3] = prog.levels.map((l: { id: string }) => l.id);
  expect(prog.levels.map((l: { isFinal: boolean }) => l.isFinal)).toEqual([false, false, true]);
  const mk = async (year: string, level: string, names: string[], capacity: number) => (await post('/sections', { academicYearId: year, programLevelId: level, names, capacity })).body;
  [sec.c1A, sec.c1B] = (await mk(y1, lv.c1, ['A', 'B'], 40)).map((s: { id: string }) => s.id);
  sec.c2A1 = (await mk(y1, lv.c2, ['A'], 40))[0].id;
  sec.c3A = (await mk(y1, lv.c3, ['A'], 40))[0].id;
  sec.n2A = (await mk(y2, lv.c2, ['A'], 2))[0].id; // next year: Class 2 A only (2 seats)
  sec.n1A = (await mk(y2, lv.c1, ['A'], 40))[0].id;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  const rows: [string, string, string, string][] = [['1', 'Asha', 'Class 1', 'A'], ['2', 'Bala', 'Class 1', 'A'], ['3', 'Chitra', 'Class 1', 'A'], ['4', 'Dev', 'Class 1', 'B'], ['5', 'Esha', 'Class 3', 'A'], ['6', 'Farid', 'Class 3', 'A'], ['7', 'Gita', 'Class 2', 'A']];
  for (const [n, f, cls, s] of rows) {
    const r: Record<string, string> = { admissionNo: `L/${n}`, firstName: f, lastName: 'Test', dob: '2018-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: 'MAIN', programCode: 'SBS', className: cls, section: s, fatherName: 'Parent', parentPhone: `987650003${n}` };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  expect((await post(`/imports/jobs/${job.body.id}/commit`, {})).status).toBeLessThan(300);
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  expect(Object.keys(ids)).toHaveLength(7);

  // Fees: Class 3 this year (Esha will owe, Farid pays); Class 2 next year (assigned on promotion).
  const head = (await post('/fees/heads', { name: 'Tuition fee', code: 'TUITION', feeType: 'ACADEMIC' })).body.id;
  const structure = async (year: string, level: string, name: string, due: string) => {
    const st = await post('/fees/structures', { campusId: campus, academicYearId: year, programLevelId: level, name, instalments: [{ instalmentNo: 1, name: 'Annual', dueDate: due }], items: [{ feeHeadId: head, instalmentNo: 1, amount: '15000' }] });
    expect((await post(`/fees/structures/${st.body.id}/activate`, {})).body.status).toBe('ACTIVE');
    return st.body.id as string;
  };
  await structure(y1, lv.c3, 'Class 3 fees', '2026-07-01');
  await structure(y2, lv.c2, 'Class 2 fees 2027-28', '2027-07-01');
  await post('/fees/billing/runs', { academicYearId: y1, instalmentNo: 1 });
  expect((await post('/fees/payments', { studentId: ids.Farid, amount: '15000', mode: 'UPI', referenceNo: 'U-9', payerName: 'Parent' })).status).toBe(201);

  await createRole(A.tenantId, 'CLERK', [PERMISSIONS.STU_STUDENT_READ]);
  clerk = (await addMember(app, A.session, { label: 'Clerk', roleCode: 'CLERK' })).session;
}, 120_000);
afterAll(() => app?.close());

describe('AC34 promotion', () => {
  it('the preview lists who goes where and changes nothing', async () => {
    const r = await post('/promotions/preview', plan());
    expect(r.status).toBe(200);
    expect(r.body.totals).toEqual({ promote: 3, detain: 1, passOut: 2, skipped: 0, withDues: 1 });
    const c1 = r.body.classes.find((c: { levelId: string }) => c.levelId === lv.c1);
    expect(c1).toMatchObject({ nextLevelName: 'Class 2', final: false });
    expect(c1.students.map((s: { firstName: string; outcome: string }) => `${s.firstName}:${s.outcome}`)).toEqual(['Asha:PROMOTE', 'Bala:PROMOTE', 'Chitra:DETAIN', 'Dev:PROMOTE']);
    const c3 = r.body.classes.find((c: { levelId: string }) => c.levelId === lv.c3);
    expect(c3).toMatchObject({ final: true, nextLevelId: null });
    expect(c3.students.find((s: { firstName: string }) => s.firstName === 'Esha').hasDues).toBe(true);
    // Class 1 B has no "B" next year.
    expect(r.body.issues).toHaveLength(1);
    expect(r.body.issues[0]).toMatch(/no section "B" in Class 2 for 2027-28/);
    expect(await enrolments('Asha')).toEqual(['2026-27 Class 1-A ACTIVE']);
  });

  it('counts seats, including students mapped into a section', async () => {
    const r = await post('/promotions/preview', plan({ sectionMap: { [sec.c1B]: sec.n2A } }));
    expect(r.body.issues).toEqual(['A would have 3 students for 2 seats']);
    const rows = r.body.classes.find((c: { levelId: string }) => c.levelId === lv.c1).sections;
    expect(rows.map((x: { fromName: string; incoming: number; after: number; over: boolean }) => [x.fromName, x.incoming, x.after, x.over])).toEqual([['A', 2, 3, true], ['B', 1, 3, true]]);
  });

  it('commit is refused while problems remain, and needs permission', async () => {
    const r = await post('/promotions', plan());
    expect(r.status).toBe(409);
    expect(r.body.type).toBe('promotion-blocked');
    expect(r.body.errors[0].message).toMatch(/no section "B"/);
    expect((await post('/promotions/preview', plan(), clerk)).status).toBe(403);
    expect((await post('/promotions', plan(), clerk)).status).toBe(403);
    expect(await enrolments('Dev')).toEqual(['2026-27 Class 1-B ACTIVE']);
  });

  it('rejects a target year that is not later', async () => {
    const r = await post('/promotions/preview', { ...plan(), fromYearId: y2, toYearId: y1 });
    expect(r.status).toBe(409);
    expect(r.body.type).toBe('year-order');
  });

  it('commits: promote, detain, pass out; fees assigned for the new year', async () => {
    sec.n2B = (await post('/sections', { academicYearId: y2, programLevelId: lv.c2, names: ['B'], capacity: 40 })).body[0].id;
    const pre = await post('/promotions/preview', plan());
    expect(pre.body.issues).toEqual([]);
    const r = await post('/promotions', plan());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ promoted: 3, detained: 1, passedOut: 2, skipped: 0, from: '2026-27', to: '2027-28' });
    expect(await enrolments('Asha')).toEqual(['2026-27 Class 1-A PROMOTED', '2027-28 Class 2-A ACTIVE']);
    expect(await enrolments('Dev')).toEqual(['2026-27 Class 1-B PROMOTED', '2027-28 Class 2-B ACTIVE']);
    expect(await enrolments('Chitra')).toEqual(['2026-27 Class 1-A DETAINED', '2027-28 Class 1-A ACTIVE']);
    expect(await enrolments('Esha')).toEqual(['2026-27 Class 3-A COMPLETED']);
    expect(await enrolments('Gita')).toEqual(['2026-27 Class 2-A ACTIVE']); // Class 2 was not chosen
    const db = ownerDb();
    const esha = await db.student.findUniqueOrThrow({ where: { id: ids.Esha } });
    const hist = await db.studentStatusHistory.findMany({ where: { studentId: ids.Esha } });
    const fees = await db.studentFeeAssignment.findMany({ where: { academicYearId: y2, status: 'ACTIVE' }, include: { student: true } });
    const runs = await db.promotionRun.findMany({ where: { tenantId: A.tenantId } });
    const audit = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'PROMOTION' } });
    await db.$disconnect();
    expect(esha.status).toBe('PASSED_OUT');
    expect(hist.map((h) => `${h.oldStatus}→${h.newStatus}`)).toContain('ACTIVE→PASSED_OUT');
    expect(fees.map((f) => f.student.firstName).sort()).toEqual(['Asha', 'Bala', 'Dev']); // Chitra stays in Class 1 (no structure next year)
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ promoted: 3, detained: 1, passedOut: 2 });
    expect(audit).toHaveLength(1);
  });

  it('a second run changes nothing', async () => {
    const r = await post('/promotions', plan());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ promoted: 0, detained: 0, passedOut: 0, runId: null });
    expect((await get('/promotions')).body).toHaveLength(1);
    expect(await enrolments('Asha')).toEqual(['2026-27 Class 1-A PROMOTED', '2027-28 Class 2-A ACTIVE']);
  });

  it('promotion history cannot be edited', async () => {
    const db = appDb();
    await expect(db.$executeRawUnsafe(`UPDATE promotion_runs SET promoted = 99 WHERE tenant_id = '${A.tenantId}'`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });
});

describe('AC35 Transfer Certificate', () => {
  const tc = { leavingDate: today, reason: 'Family moving to Mysuru', conduct: 'GOOD' };

  it('is refused while fees are due', async () => {
    const r = await post(`/students/${ids.Esha}/tc`, tc);
    expect(r.status).toBe(409);
    expect(r.body.type).toBe('dues-pending');
    expect(r.body.detail).toMatch(/15,000/);
    expect(r.body.errors).toHaveLength(1);
  });

  it('checks the leaving date and needs permission', async () => {
    expect((await post(`/students/${ids.Gita}/tc`, { ...tc, leavingDate: '2026-01-01' })).body.type).toBe('date-before-admission');
    expect((await post(`/students/${ids.Gita}/tc`, { ...tc, leavingDate: '2099-01-01' })).status).toBe(422);
    expect((await post(`/students/${ids.Gita}/tc`, tc, clerk)).status).toBe(403);
  });

  it('issues a numbered TC: student transferred, class place closed, future fees stopped', async () => {
    const r = await post(`/students/${ids.Gita}/tc`, tc);
    expect(r.status).toBe(201);
    expect(r.body.tcNo).toMatch(/^TC/);
    expect(r.body).toMatchObject({ status: 'ISSUED', duesCleared: true, lastYear: '2026-27', conduct: 'GOOD' });
    expect(r.body.lastClass).toMatch(/^Class 2 – A/);
    expect(await enrolments('Gita')).toEqual(['2026-27 Class 2-A TRANSFERRED']);
    const s = (await get(`/students/${ids.Gita}`)).body;
    expect(s.status).toBe('TRANSFERRED');
    const view = await get(`/transfer-certificates/${r.body.id}`, clerk);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ tcNo: r.body.tcNo, student: { firstName: 'Gita', admissionNo: 'L/7' } });
    expect(view.body.institution).toBeTruthy();
    expect((await get(`/students/${ids.Gita}/tcs`)).body).toHaveLength(1);
  });

  it('a passed-out student with no dues gets a TC and stays passed out', async () => {
    const r = await post(`/students/${ids.Farid}/tc`, { ...tc, reason: 'Higher studies' });
    expect(r.status).toBe(201);
    expect(r.body.lastClass).toMatch(/^Class 3 – A/);
    expect((await get(`/students/${ids.Farid}`)).body.status).toBe('PASSED_OUT');
  });

  it('a promoted student leaving before the new year: last class is the one attended; the new-year place and fees are cancelled', async () => {
    const r = await post(`/students/${ids.Bala}/tc`, tc);
    expect(r.status).toBe(201);
    expect(r.body.lastYear).toBe('2026-27');
    expect(r.body.lastClass).toMatch(/^Class 1 – A/);
    const db = ownerDb();
    const fees = await db.studentFeeAssignment.findMany({ where: { studentId: ids.Bala } });
    await db.$disconnect();
    expect(fees.map((f) => f.status)).toEqual(['CANCELLED']);
    expect(await enrolments('Bala')).toEqual(['2026-27 Class 1-A PROMOTED', '2027-28 Class 2-A CANCELLED']);
  });

  it('only one per student; other schools cannot see it', async () => {
    const again = await post(`/students/${ids.Gita}/tc`, tc);
    expect(again.status).toBe(409);
    expect(again.body.type).toBe('tc-issued');
    const id = (await get(`/students/${ids.Gita}/tcs`)).body[0].id;
    expect((await get(`/transfer-certificates/${id}`, B.session)).status).toBe(404);
    expect((await post(`/students/${ids.Asha}/tc`, tc, B.session)).status).toBe(404);
    const db = appDb();
    await expect(db.$executeRawUnsafe(`DELETE FROM transfer_certificates WHERE id = '${id}'`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });
});
