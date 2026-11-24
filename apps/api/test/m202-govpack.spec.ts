/**
 * AC101–AC104 Government residential school pack (improvement round G1–G5): the SATS / UDISE+ card,
 * exports with the institution's own column layout and the readiness list; welfare schemes handed out
 * per class never beyond the entitlement (also at once), stock leaving as a welfare movement, cash with
 * a reference; the diet scale, the meal register and the diet report (due = children-days × scale,
 * issued = kitchen issues); government staff details and the HRMS report; the overview of schools by
 * district with a campus-only reader; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { GOV_STANDARD_LAYOUTS, IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let clerk: Session; // Main campus: student records, welfare hand-out, meals, overview
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const stock = async (storeId: string, itemId: string) => {
  const db = ownerDb();
  const b = await db.stockBalance.findFirst({ where: { storeId, itemId } });
  await db.$disconnect();
  return Number(b?.quantity ?? 0);
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'GovA');
  B = await createTenant(app, platform, 'GovB');
  main = (await post('/campuses', { code: 'MAIN', name: 'MDRS Hunsur', campusType: 'SCHOOL', district: 'Mysuru', udiseCode: '29220100101' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'MDRS Kollegal', campusType: 'SCHOOL', district: 'Chamarajanagar' })).body.id;
  const yearStart = `${shift(-90).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${yearStart}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  ids.year = (await post('/academic-years', { name: `${yearStart.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: yearStart, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const pm = (await post('/programs', { campusId: main, name: 'Residential School', code: 'MDRS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2 })).body;
  const pn = (await post('/programs', { campusId: north, name: 'Residential School North', code: 'MDRSN', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2 })).body;
  ids.level1 = pm.levels[0].name;
  ids.level2 = pm.levels[1].name;
  const s1 = (await post('/sections', { academicYearId: ids.year, programLevelId: pm.levels[0].id, names: ['A'], capacity: 40 })).body;
  await post('/sections', { academicYearId: ids.year, programLevelId: pm.levels[1].id, names: ['A'], capacity: 40 });
  await post('/sections', { academicYearId: ids.year, programLevelId: pn.levels[0].id, names: ['A'], capacity: 40 });
  ids.sec1 = (Array.isArray(s1) ? s1[0] : s1.sections?.[0] ?? s1).id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  const rows: [string, string, string, string, string, string][] = [
    ['1', 'Asha', 'Girl', 'MAIN', 'MDRS', pm.levels[0].name], ['2', 'Bala', 'Boy', 'MAIN', 'MDRS', pm.levels[0].name], ['3', 'Chitra', 'Girl', 'MAIN', 'MDRS', pm.levels[0].name],
    ['4', 'Deepa', 'Girl', 'MAIN', 'MDRS', pm.levels[1].name], ['5', 'Eshwar', 'Boy', 'NORTH', 'MDRSN', pn.levels[0].name],
  ];
  for (const [n, f, g, campusCode, programCode, className] of rows) {
    const r: Record<string, string> = { admissionNo: `G/${n}`, firstName: f, lastName: 'Test', dob: '2013-02-01', gender: g, category: n === '1' ? '2A' : 'SC', motherTongue: 'Kannada', admissionDate: yearStart, campusCode, programCode, className, section: 'A', fatherName: `${f} Father`, motherName: `${f} Mother`, parentPhone: `98766000${n}0`, address: 'Hunsur, Mysuru', rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  const db = ownerDb();
  ids.sec1 = (await db.studentEnrollment.findFirstOrThrow({ where: { studentId: ids.Asha } })).sectionId;
  ids.sec2 = (await db.studentEnrollment.findFirstOrThrow({ where: { studentId: ids.Deepa } })).sectionId;
  await db.$disconnect();
  ids.dept = (await post('/departments', { campusId: main, name: 'Kitchen', code: 'KIT', deptType: 'ADMIN' })).body.id;
  await createRole(A.tenantId, 'CLERK_R', [PERMISSIONS.STU_STUDENT_READ, PERMISSIONS.STU_STUDENT_MANAGE, PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.WELFARE_MANAGE, PERMISSIONS.MEALS_RECORD, PERMISSIONS.DIET_MANAGE, PERMISSIONS.OVERVIEW_READ, PERMISSIONS.HOSTEL_READ]);
  clerk = (await addMember(app, A.session, { label: 'Clerk', roleCode: 'CLERK_R', campusId: main })).session;
}, 180_000);
afterAll(() => app?.close());

describe('AC101 government data & exports', () => {
  it('the card is validated, saved and audited; readiness lists what is missing', async () => {
    expect((await put(`/govt/students/${ids.Asha}`, { isCwsn: true }, clerk)).status).toBe(422);
    expect((await put(`/govt/students/${ids.Asha}`, { satsId: '!!', isCwsn: false }, clerk)).status).toBe(422);
    const ok = await put(`/govt/students/${ids.Asha}`, { satsId: '123456789', penNo: 'PEN2201', rationCardType: 'BPL', isEws: false, isCwsn: true, disabilityType: 'Low vision', mediumOfInstruction: 'KANNADA', distanceKm: '42.5', previousSchool: 'GHPS Hunsur' }, clerk);
    expect(ok.status).toBe(200);
    const card = (await get(`/govt/students/${ids.Asha}`, clerk)).body;
    expect(card.profile).toMatchObject({ satsId: '123456789', rationCardType: 'BPL', isCwsn: true, distanceKm: 42.5, mediumOfInstruction: 'KANNADA' });
    expect(card.missing.SATS).toEqual(['Religion']);
    expect(card.missing.UDISE).toEqual([]);
    // North is outside the clerk's campus.
    expect((await get(`/govt/students/${ids.Eshwar}`, clerk)).status).toBe(404);
    expect((await put(`/govt/students/${ids.Eshwar}`, { isCwsn: false }, clerk)).status).toBe(404);
    const r = (await get('/govt/readiness', clerk)).body;
    expect(r.campuses).toEqual([{ campusId: main, campus: 'MDRS Hunsur', students: 4, SATS: 0, UDISE: 1 }]);
    expect(r.totalWithGaps).toBe(4);
    expect(r.students.find((s: { name: string }) => s.name === 'Bala Test').SATS).toEqual(expect.arrayContaining(['SATS student ID', 'Medium of instruction', 'Religion']));
    expect((await get('/govt/readiness')).body.campuses).toHaveLength(2);
    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'STUDENT_GOV_PROFILE', entityId: ids.Asha } })).toBe(1);
    await db.$disconnect();
  });

  it('exports follow the standard layout, then the institution\'s own (renamed, reordered, fewer), and reset', async () => {
    const std = (await post('/reports/run/GOV_UDISE', { campusId: main }, clerk)).body;
    expect(std.columns.map((c: { key: string }) => c.key)).toEqual(GOV_STANDARD_LAYOUTS.UDISE);
    expect(std.total).toBe(4);
    const asha = std.rows.find((x: { name: string }) => x.name === 'Asha Test');
    expect(asha).toMatchObject({ penNo: 'PEN2201', socialCategory: 'OBC', bpl: 'Yes', aay: 'No', cwsn: 'Yes', motherName: 'Asha Mother', udiseCode: '29220100101', distanceKm: 42.5 });
    expect(std.rows.find((x: { name: string }) => x.name === 'Bala Test').socialCategory).toBe('SC');
    // The clerk may read but not change the layout.
    expect((await put('/govt/layouts/UDISE', { columns: [{ key: 'name', label: 'x' }] }, clerk)).status).toBe(403);
    expect((await put('/govt/layouts/UDISE', { columns: [{ key: 'name', label: 'A' }, { key: 'name', label: 'B' }] })).status).toBe(422);
    const own = await put('/govt/layouts/UDISE', { columns: [{ key: 'penNo', label: 'Student PEN' }, { key: 'className', label: 'Class studying' }, { key: 'name', label: 'Name of student' }] });
    expect(own.status).toBe(200);
    const run = (await post('/reports/run/GOV_UDISE', { campusId: main }, clerk)).body;
    expect(run.columns).toEqual([{ key: 'penNo', label: 'Student PEN', type: 'text' }, { key: 'className', label: 'Class studying', type: 'text' }, { key: 'name', label: 'Name of student', type: 'text' }]);
    const cat = (await get('/reports/catalogue', clerk)).body.find((c: { code: string }) => c.code === 'GOV_UDISE');
    expect(cat.columns).toHaveLength(3);
    // A background export uses the same layout.
    const job = await post('/reports/exports', { reportCode: 'GOV_UDISE', filters: { campusId: main }, format: 'CSV' }, clerk);
    expect(job.status).toBe(201);
    expect((await post('/govt/layouts/UDISE/reset', {})).status).toBe(200);
    expect((await post('/reports/run/GOV_UDISE', {}, clerk)).body.columns.map((c: { key: string }) => c.key)).toEqual(GOV_STANDARD_LAYOUTS.UDISE);
    const sats = (await post('/reports/run/GOV_SATS', {})).body;
    expect(sats.total).toBe(5);
    expect(sats.rows.find((x: { name: string }) => x.name === 'Asha Test')).toMatchObject({ satsId: '123456789', category: '2A', cwsn: 'Yes', disabilityType: 'Low vision' });
  });
});

describe('AC102 welfare', () => {
  it('schemes are set for all campuses; item hand-outs take stock once, skip those given, follow class and gender', async () => {
    const cats = (await get('/inventory/options')).body.categories;
    ids.cat = cats[0].id;
    ids.uniform = (await post('/inventory/items', { name: 'Uniform set (girls)', categoryId: ids.cat, unit: 'SET' })).body.id;
    ids.store = (await post('/inventory/stores', { campusId: main, name: 'Main Store' })).body.id;
    await post('/inventory/opening-stock', { storeId: ids.store, date: shift(-10), lines: [{ itemId: ids.uniform, quantity: 5, rate: 600 }] });
    const body = { academicYearId: ids.year, name: 'Uniform (girls)', kind: 'ITEM', inventoryItemId: ids.uniform, quantityPerStudent: 2, levelNames: [ids.level1], gender: 'FEMALE' };
    // The clerk has the right for one campus only — schemes apply to every campus.
    expect((await post('/welfare/schemes', body, clerk)).status).toBe(403);
    const s = await post('/welfare/schemes', body);
    expect(s.status).toBe(201);
    ids.uniformScheme = s.body.id;
    expect((await post('/welfare/schemes', { ...body, name: 'uniform (GIRLS)' })).status).toBe(409);
    expect((await post('/welfare/schemes', { ...body, name: 'Cash with item', kind: 'CASH', amountPerStudent: 100, quantityPerStudent: null })).status).toBe(422);

    const sec = (await get(`/welfare/schemes/${ids.uniformScheme}/sections/${ids.sec1}`, clerk)).body;
    expect(sec.students.filter((x: { eligible: boolean }) => x.eligible).map((x: { name: string }) => x.name).sort()).toEqual(['Asha Test', 'Chitra Test']);
    // Two hand-outs at once: 2 girls × 2 sets = 4 leave the store, never 8.
    expect((await post(`/welfare/schemes/${ids.uniformScheme}/give`, { sectionId: ids.sec1, givenOn: today }, clerk)).body.type).toBe('store-required');
    const both = await Promise.all([1, 2].map(() => post(`/welfare/schemes/${ids.uniformScheme}/give`, { sectionId: ids.sec1, givenOn: today, storeId: ids.store }, clerk)));
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(both.map((r) => r.body.given).sort()).toEqual([0, 2]);
    expect(await stock(ids.store, ids.uniform)).toBe(1);
    const db = ownerDb();
    const moves = await db.stockTransaction.findMany({ where: { tenantId: A.tenantId, itemId: ids.uniform, referenceType: 'WELFARE' } });
    expect(moves).toHaveLength(1);
    expect(Number(moves[0].quantity)).toBe(4);
    await db.$disconnect();
    const after = (await get(`/welfare/schemes/${ids.uniformScheme}/sections/${ids.sec1}`, clerk)).body.students;
    expect(after.find((x: { name: string }) => x.name === 'Asha Test')).toMatchObject({ received: '2.00', pending: '0.00' });
    expect(after.find((x: { name: string }) => x.name === 'Bala Test')).toMatchObject({ eligible: false, received: '0.00' });
    // The entitlement can rise (the difference is then due) but never fall below what was given.
    expect((await put(`/welfare/schemes/${ids.uniformScheme}`, { ...body, quantityPerStudent: 1 })).body.type).toBe('below-given');
    expect((await put(`/welfare/schemes/${ids.uniformScheme}`, { ...body, quantityPerStudent: 3 })).status).toBe(200);
    // One more set each would need 2, only 1 in stock: refused, nothing recorded.
    const short = await post(`/welfare/schemes/${ids.uniformScheme}/give`, { sectionId: ids.sec1, givenOn: today, storeId: ids.store }, clerk);
    expect(short.body.type).toBe('insufficient-stock');
    expect((await get(`/welfare/students/${ids.Asha}`, clerk)).body).toEqual([expect.objectContaining({ scheme: 'Uniform (girls)', quantity: 2, unit: 'SET', givenOn: today })]);
    // A chosen student only.
    const one = await post(`/welfare/schemes/${ids.uniformScheme}/give`, { sectionId: ids.sec1, givenOn: today, storeId: ids.store, studentIds: [ids.Chitra] }, clerk);
    expect(one.body).toMatchObject({ given: 1, total: '1.00' });
    expect(await stock(ids.store, ids.uniform)).toBe(0);
  });

  it('cash allowances need a reference; the status report and the overview count them', async () => {
    const cash = (await post('/welfare/schemes', { academicYearId: ids.year, name: 'Travel allowance', kind: 'CASH', amountPerStudent: 500, levelNames: [], gender: 'ALL' })).body.id;
    expect((await post(`/welfare/schemes/${cash}/give`, { sectionId: ids.sec2, givenOn: today }, clerk)).body.type).toBe('reference-required');
    expect((await post(`/welfare/schemes/${cash}/give`, { sectionId: ids.sec2, givenOn: today, reference: 'DBT-778812' }, clerk)).body).toMatchObject({ given: 1, total: '500.00' });
    const rep = (await post('/reports/run/WELFARE_STATUS', { schemeId: cash }, clerk)).body;
    expect(rep.rows.map((r: { student: string; received: string; pending: string }) => [r.student, r.received, r.pending]).sort()).toEqual([['Asha Test', '0.00', '500.00'], ['Bala Test', '0.00', '500.00'], ['Chitra Test', '0.00', '500.00'], ['Deepa Test', '500.00', '0.00']]);
    const list = (await get('/welfare/schemes', clerk)).body;
    expect(list.find((x: { name: string }) => x.name === 'Travel allowance')).toMatchObject({ eligible: 4, fullyGiven: 1 });
    expect((await get(`/welfare/schemes/${cash}/sections/${ids.sec1}`, B.session)).status).toBe(404);
  });
});

describe('AC103 diet scale and meals', () => {
  it('scale lines never overlap; meals suggested from the roll call; the report compares due with kitchen issues', async () => {
    ids.rice = (await post('/inventory/items', { name: 'Rice', categoryId: ids.cat, unit: 'KG' })).body.id;
    await post('/inventory/opening-stock', { storeId: ids.store, date: shift(-10), lines: [{ itemId: ids.rice, quantity: 100, rate: 40 }] });
    const line = { inventoryItemId: ids.rice, quantityPerChild: 0.15, levelNames: [], effectiveFrom: shift(-30) };
    expect((await post('/diet/scale', line, clerk)).status).toBe(403);
    expect((await post('/diet/scale', line)).status).toBe(201);
    expect((await post('/diet/scale', { ...line, levelNames: [ids.level1], effectiveFrom: shift(-5) })).body.type).toBe('overlap');

    // Roll call: Asha and Chitra present in the hostel yesterday.
    const db = ownerDb();
    const hostel = await db.hostel.create({ data: { tenantId: A.tenantId, campusId: main, name: 'Girls hostel', hostelType: 'GIRLS' } });
    const admin = await db.user.findFirstOrThrow({ where: { email: A.admin.email } });
    for (const s of [ids.Asha, ids.Chitra]) await db.hostelRollCall.create({ data: { tenantId: A.tenantId, hostelId: hostel.id, studentId: s, attendanceDate: new Date(`${shift(-1)}T00:00:00Z`), status: 'PRESENT', markedBy: admin.id } });
    await db.$disconnect();
    const reg = (await get(`/diet/meals?campusId=${main}&date=${shift(-1)}`, clerk)).body;
    expect(reg.rows.find((r: { levelName: string }) => r.levelName === ids.level1)).toMatchObject({ presentInHostel: 2, lunch: null });
    expect((await post('/diet/meals', { campusId: main, mealDate: shift(1), rows: [{ levelName: ids.level1, breakfast: 1, lunch: 1, snacks: 1, dinner: 1 }] }, clerk)).body.type).toBe('future-date');
    expect((await post('/diet/meals', { campusId: north, mealDate: shift(-1), rows: [{ levelName: ids.level1, breakfast: 1, lunch: 1, snacks: 1, dinner: 1 }] }, clerk)).status).toBe(404);
    for (const [d, a, b] of [[shift(-2), 100, 50], [shift(-1), 100, 60]] as [string, number, number][]) {
      expect((await post('/diet/meals', { campusId: main, mealDate: d, rows: [{ levelName: ids.level1, breakfast: a, lunch: a, snacks: a - 10, dinner: a }, { levelName: ids.level2, breakfast: b, lunch: b, snacks: b, dinner: b - 5 }] }, clerk)).status).toBe(200);
    }
    // Saving again replaces the day's counts.
    await post('/diet/meals', { campusId: main, mealDate: shift(-1), rows: [{ levelName: ids.level2, breakfast: 50, lunch: 50, snacks: 50, dinner: 50 }] }, clerk);
    // Kitchen issues 45 kg rice; a transfer and a welfare hand-out are not kitchen use.
    await post('/inventory/issues', { issueType: 'ISSUE', fromStoreId: ids.store, toDepartmentId: ids.dept, issueDate: shift(-1), items: [{ itemId: ids.rice, quantity: 45 }] });
    const rep = (await get(`/diet/report?campusId=${main}&from=${shift(-2)}&to=${shift(-1)}`, clerk)).body;
    // Children-days: 100 + 50 + 100 + 50 = 300; due 300 × 0.15 = 45 kg; issued 45 → not flagged.
    expect(rep.days).toBe(2);
    expect(rep.lines).toEqual([expect.objectContaining({ item: 'Rice', childDays: 300, due: 45, issued: 45, difference: 0, percent: 0, flagged: false })]);
    const tight = (await get(`/diet/report?campusId=${main}&from=${shift(-2)}&to=${shift(-2)}&tolerance=5`, clerk)).body;
    // One day: due 150 × 0.15 = 22.5, issued 0 that day → −100% → flagged.
    expect(tight.lines[0]).toMatchObject({ due: 22.5, issued: 0, flagged: true });
    expect((await get(`/diet/report?campusId=${main}&from=${shift(-2)}&to=${shift(-1)}`, B.session)).status).toBe(404);
  });
});

describe('AC104 government staff details and the overview', () => {
  it('staff details are saved, audited and in the HRMS report with the campus DDO code', async () => {
    const emp = (await post('/staff', { campusId: main, firstName: 'Manjunath', gender: 'MALE', employeeType: 'TEACHING', designation: 'Assistant teacher', joiningDate: '2019-06-01' })).body.id;
    expect((await put(`/govt/staff/${emp}`, { pranNo: '123' })).status).toBe(422);
    expect((await put(`/govt/staff/${emp}`, { govtEmployment: 'GOVERNMENT', kgidNo: '1234567', hrmsId: 'HR2201', pranNo: '110012345678', payScale: '33450-62600', govtServiceDate: '2012-07-01' })).status).toBe(200);
    expect((await put(`/govt/campuses/${main}/ddo`, { ddoCode: '0101AB' })).status).toBe(200);
    expect((await get(`/govt/staff/${emp}`)).body).toMatchObject({ govtEmployment: 'GOVERNMENT', kgidNo: '1234567', pranNo: '110012345678', govtServiceDate: '2012-07-01', ddoCode: '0101AB' });
    const rep = (await post('/reports/run/STAFF_GOVT', { campusId: main })).body;
    expect(rep.rows.find((r: { name: string }) => r.name === 'Manjunath')).toMatchObject({ ddoCode: '0101AB', kgidNo: '1234567', hrmsId: 'HR2201', payScale: '33450-62600' });
    const db = ownerDb();
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, entityType: 'EMPLOYEE_GOVT', entityId: emp } })).toBe(1);
    await db.$disconnect();
    expect((await get(`/govt/staff/${emp}`, B.session)).status).toBe(404);
  });

  it('the overview matches the modules per campus, totals by district add up, a campus reader sees only theirs', async () => {
    const all = (await get('/govt/overview')).body;
    expect(all.rows.map((r: { name: string }) => r.name)).toEqual(['MDRS Kollegal', 'MDRS Hunsur']);
    const hunsur = all.rows.find((r: { campusId: string }) => r.campusId === main);
    expect(hunsur).toMatchObject({ district: 'Mysuru', students: 4, boys: 1, girls: 3, fedYesterday: 150, readiness: { SATS: 0, UDISE: 25 } });
    // Welfare this year: uniform — 2 girls, entitlement now 3, only Chitra has all 3; travel allowance — 4, Deepa given = 2 of 6.
    expect(hunsur.welfare).toEqual({ due: 6, given: 2, percent: 33.3 });
    const kollegal = all.rows.find((r: { campusId: string }) => r.campusId === north);
    expect(kollegal).toMatchObject({ students: 1, boys: 1, fedYesterday: null });
    const sum = all.districts.reduce((t: number, d: { students: number }) => t + d.students, 0);
    expect(sum).toBe(5);
    expect(all.allDistricts).toEqual(['Chamarajanagar', 'Mysuru']);
    expect((await get('/govt/overview?district=Mysuru')).body.rows).toHaveLength(1);
    const mine = (await get('/govt/overview', clerk)).body;
    expect(mine.rows.map((r: { campusId: string }) => r.campusId)).toEqual([main]);
    expect((await get('/govt/overview', B.session)).body.rows).toEqual([]);
  });
});
