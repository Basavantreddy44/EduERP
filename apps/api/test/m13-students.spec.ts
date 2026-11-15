/**
 * AC28 students (M1.3): import (validation, seats, numbering), search by name / admission number /
 * parent phone with filters, < 300 ms with 20,000 students (measured), status history, section
 * change with one active enrolment, siblings sharing parents, export → import round trip,
 * campus scope, tenant isolation and the module switch.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let northStaff: Session;
let main: string;
let north: string;
let year: string;
let class1: string;
let class2: string;
let sec1A: string;
let sec1B: string;
let sec2A: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const HEADERS = IMPORT_TYPES.STUDENTS.columns.map((c) => c.header);

/** One spreadsheet row from named values, in template column order. */
const row = (v: Partial<Record<(typeof IMPORT_TYPES.STUDENTS.columns)[number]['key'], string>>) => IMPORT_TYPES.STUDENTS.columns.map((c) => v[c.key] ?? '');
async function xlsx(header: string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
const upload = (s: Session, file: Buffer) => http().post(`${API}/imports/STUDENTS`).set(auth(s)).attach('file', file, 'students.xlsx');
const search = (s: Session, qs: string) => http().get(`${API}/students?${qs}`).set(auth(s));
const names = (res: request.Response) => res.body.items.map((i: { firstName: string }) => i.firstName);
const profile = async (id: string, s: Session = A.session) => (await http().get(`${API}/students/${id}`).set(auth(s))).body;

const KAVYA = { admissionNo: 'ADM/OLD/001', firstName: 'Kavya', lastName: 'Gowda', dob: '2019-05-14', gender: 'Girl', category: '2A', motherTongue: 'Kannada', aadhaarLast4: '4321', bloodGroup: 'B+', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', rollNo: '7', admissionDate: '2025-06-02', fatherName: 'Ramesh Gowda', motherName: 'Sunita Gowda', parentPhone: '9876511111', parentEmail: 'ramesh@example.in', address: '12, 4th Cross, Jayanagar' };

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'StuA');
  B = await createTenant(app, platform, 'StuB');
  main = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'NORTH', name: 'North PU College', campusType: 'PU' })).body.id;
  year = (await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 });
  [class1, class2] = [sbs.body.levels[0].id, sbs.body.levels[1].id];
  const s1 = (await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: class1, names: ['A', 'B'], capacity: 3 })).body;
  sec1A = s1.find((s: { name: string }) => s.name === 'A').id;
  sec1B = s1.find((s: { name: string }) => s.name === 'B').id;
  sec2A = (await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: class2, names: ['A'], capacity: 40 })).body[0].id;
  const pu = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: north, name: 'PU Science', code: 'PUS', programType: 'PU', levelLabel: 'PUC', durationLevels: 2 });
  await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: pu.body.levels[0].id, names: ['A'], capacity: 60 });

  await createRole(A.tenantId, 'NORTH_OFFICE', [PERMISSIONS.STU_STUDENT_READ, PERMISSIONS.STU_STUDENT_MANAGE]);
  northStaff = (await addMember(app, A.session, { label: 'North', roleCode: 'NORTH_OFFICE', campusId: north })).session;
}, 120_000);
afterAll(() => app?.close());

describe('AC28 import', () => {
  it('validates every row (full Aadhaar, seats, class) before anything is written; blank numbers are allocated', async () => {
    const types = (await http().get(`${API}/imports/types`).set(auth(A.session))).body.map((t: { type: string }) => t.type);
    expect(types).toContain('STUDENTS');
    const tpl = await binary(http().get(`${API}/imports/templates/STUDENTS`).set(auth(A.session)));
    expect(tpl.status).toBe(200);

    const file = await xlsx(HEADERS, [
      row(KAVYA),
      row({ ...KAVYA, admissionNo: '', firstName: 'Karthik', dob: '2018-01-20', gender: 'Boy', className: 'Class 2', section: 'A', rollNo: '', motherName: '', aadhaarLast4: '', bloodGroup: 'o +ve' }),
      row({ admissionNo: 'ADM/OLD/003', firstName: 'Meera', lastName: 'Iyer', dob: '19-08-2019', gender: 'girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'a', motherName: 'Lakshmi Iyer', parentPhone: '+91 98765 22222' }),
      row({ admissionNo: 'ADM/OLD/004', firstName: 'Asha', lastName: 'K', dob: '2019-02-02', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Kumar K', parentPhone: '9876544444' }),
      row({ admissionNo: 'ADM/OLD/005', firstName: 'Bina', dob: '2019-03-03', gender: 'Girl', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'A', fatherName: 'Babu', parentPhone: '9876555555' }),
      row({ admissionNo: 'ADM/OLD/006', firstName: 'Chetan', dob: '2019-03-03', gender: 'Boy', campusCode: 'MAIN', programCode: 'SBS', className: 'Class 1', section: 'B', fatherName: 'Chandru', parentPhone: '9876566666', aadhaarLast4: '1234 5678 9012' }),
      row({ admissionNo: 'ADM/N/001', firstName: 'Rahul', lastName: 'Shetty', dob: '2010-07-07', gender: 'Boy', campusCode: 'NORTH', programCode: 'PUS', className: 'I PUC', section: 'A', fatherName: 'Prakash Shetty', parentPhone: '9876533333' }),
    ]);
    const job = await upload(A.session, file);
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ totalRows: 7, validRows: 5, errorRows: 2 });
    const bad = (await http().get(`${API}/imports/jobs/${job.body.id}/rows?status=INVALID`).set(auth(A.session))).body.items;
    expect(bad.map((r: { rowNo: number }) => r.rowNo)).toEqual([6, 7]);
    expect(bad[0].errors.join()).toContain('Class 1 A is full (3 seats)');
    expect(bad[1].errors.join()).toContain('Do not enter the full Aadhaar number');
    expect(await ownerDb().student.count({ where: { tenantId: A.tenantId } })).toBe(0); // dry run

    const done = await http().post(`${API}/imports/jobs/${job.body.id}/commit`).set(auth(A.session));
    expect(done.status).toBe(201);
    expect(done.body.importedRows).toBe(5);
    const all = (await search(A.session, 'pageSize=100')).body.items as { id: string; firstName: string; admissionNo: string }[];
    for (const s of all) ids[s.firstName] = s.id;
    expect(all.find((s) => s.firstName === 'Karthik')!.admissionNo).toBe('ADM/2026-27/0001');
    const k = await profile(ids.Kavya);
    expect(k).toMatchObject({ aadhaarLast4: '4321', bloodGroup: 'B+', category: '2A', status: 'ACTIVE' });
    expect(k.statusHistory.map((h: { reason: string; newStatus: string }) => [h.newStatus, h.reason])).toEqual([['ACTIVE', 'Imported']]);
    expect(k.enrollments[0]).toMatchObject({ status: 'ACTIVE', rollNo: '7', enrolledOn: '2026-06-01T00:00:00.000Z' });
    expect((await profile(ids.Karthik)).bloodGroup).toBe('O+');
  });
});

describe('AC28 export → import round trip', () => {
  it('the export uses the import columns and gives back what was imported; re-importing it is refused as duplicates', async () => {
    const res = await binary(http().get(`${API}/exports/STUDENTS`).set(auth(A.session)));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const header = (ws.getRow(1).values as string[]).slice(1);
    expect(header).toEqual([...HEADERS, 'Status']);
    const rows: string[][] = [];
    ws.eachRow((r, n) => { if (n > 1) rows.push(HEADERS.map((_, i) => String(r.getCell(i + 1).text ?? ''))); });
    expect(rows).toHaveLength(5);
    const kavya = rows.find((r) => r[1] === 'Kavya')!;
    expect(kavya).toEqual(row(KAVYA));

    const again = await upload(A.session, await xlsx(HEADERS, rows));
    expect(again.body).toMatchObject({ totalRows: 5, validRows: 0, errorRows: 5 });
    const errs = (await http().get(`${API}/imports/jobs/${again.body.id}/rows?status=INVALID`).set(auth(A.session))).body.items;
    expect(errs[0].errors.join()).toMatch(/Admission no: .* already exists/);
  });
});

describe('AC28 search and filters', () => {
  it('finds by name, admission number or parent mobile (any spacing / +91)', async () => {
    expect(names(await search(A.session, 'q=kav'))).toEqual(['Kavya']);
    expect(names(await search(A.session, 'q=gowda'))).toEqual(['Karthik', 'Kavya']);
    expect(names(await search(A.session, 'q=gowda%20kar'))).toEqual(['Karthik']);
    expect(names(await search(A.session, 'q=old%2F003'))).toEqual(['Meera']);
    expect(names(await search(A.session, `q=${encodeURIComponent('+91 98765 11111')}`))).toEqual(['Karthik', 'Kavya']);
    expect(names(await search(A.session, 'q=22222'))).toEqual(['Meera']);
    expect(names(await search(A.session, 'q=100%25'))).toEqual([]); // LIKE wildcards are literal
  });

  it('filters by campus, class, section and status; sorts and pages', async () => {
    expect(names(await search(A.session, `sectionId=${sec1A}`))).toEqual(['Asha', 'Kavya', 'Meera']);
    expect(names(await search(A.session, `programLevelId=${class2}`))).toEqual(['Karthik']);
    expect(names(await search(A.session, `campusId=${north}`))).toEqual(['Rahul']);
    expect(names(await search(A.session, 'status=INACTIVE'))).toEqual([]);
    const sorted = await search(A.session, 'sort=admissionNo&dir=desc&pageSize=2&page=2');
    expect(sorted.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(sorted.body.items.map((i: { admissionNo: string }) => i.admissionNo)).toEqual(['ADM/OLD/001', 'ADM/N/001']);
    const first = (await search(A.session, 'q=kavya')).body.items[0];
    expect(first).toMatchObject({ admissionNo: 'ADM/OLD/001', campusCode: 'MAIN', levelName: 'Class 1', sectionName: 'A', rollNo: '7', guardianName: 'Ramesh Gowda', guardianPhone: '9876511111' });
    expect((await search(A.session, 'page=9')).body).toMatchObject({ items: [], total: 5 });
  });
});

describe('AC28 siblings share parents', () => {
  it('brothers and sisters with the same mobile share one parent record; an edit shows for both', async () => {
    const kavya = await profile(ids.Kavya);
    const karthik = await profile(ids.Karthik);
    const kFather = kavya.guardians.find((g: { relation: string }) => g.relation === 'FATHER');
    const kkFather = karthik.guardians.find((g: { relation: string }) => g.relation === 'FATHER');
    expect(kkFather.guardianId).toBe(kFather.guardianId);
    expect(kFather.siblings.map((s: { firstName: string }) => s.firstName)).toEqual(['Karthik']);
    expect(kFather.isPrimary).toBe(true);

    const edit = await http().patch(`${API}/students/${ids.Karthik}/guardians/${kFather.guardianId}`).set(auth(A.session)).send({ name: 'Ramesh B Gowda', occupation: 'Farmer' });
    expect(edit.status).toBe(200);
    expect((await profile(ids.Kavya)).guardians.find((g: { relation: string }) => g.relation === 'FATHER').guardian).toMatchObject({ name: 'Ramesh B Gowda', occupation: 'Farmer' });
  });

  it('a parent already on record is linked, not added twice; the main contact stays until replaced', async () => {
    const lookup = (await http().get(`${API}/students/guardians/lookup?phone=9876511111`).set(auth(A.session))).body;
    expect(lookup).toHaveLength(1);
    expect(lookup[0].children.map((c: { firstName: string }) => c.firstName).sort()).toEqual(['Karthik', 'Kavya']);

    const dup = await http().post(`${API}/students/${ids.Meera}/guardians`).set(auth(A.session)).send({ relation: 'GUARDIAN', name: 'Ramesh Gowda', phone: '9876511111' });
    expect(dup.status).toBe(409);
    expect(dup.body.type).toBe('guardian-phone-exists');
    const link = await http().post(`${API}/students/${ids.Meera}/guardians`).set(auth(A.session)).send({ relation: 'GUARDIAN', guardianId: lookup[0].id });
    expect(link.status).toBe(201);
    expect(link.body.reused).toBe(true);
    const meera = await profile(ids.Meera);
    expect(meera.guardians).toHaveLength(2);
    const mother = meera.guardians.find((g: { relation: string }) => g.relation === 'MOTHER');
    expect(mother.isPrimary).toBe(true);

    expect((await http().delete(`${API}/students/${ids.Meera}/guardians/${mother.guardianId}`).set(auth(A.session))).body.type).toBe('primary-contact');
    const switched = await http().patch(`${API}/students/${ids.Meera}/guardians/${lookup[0].id}`).set(auth(A.session)).send({ isPrimary: true });
    expect(switched.status).toBe(200);
    const removed = await http().delete(`${API}/students/${ids.Meera}/guardians/${mother.guardianId}`).set(auth(A.session));
    expect(removed.status).toBe(200);
    const after = await profile(ids.Meera);
    expect(after.guardians.map((g: { relation: string; isPrimary: boolean }) => [g.relation, g.isPrimary])).toEqual([['GUARDIAN', true]]);
    // The parent record itself stays (another child may use it later).
    expect(await ownerDb().guardian.count({ where: { id: mother.guardianId } })).toBe(1);
  });
});

describe('AC28 edit', () => {
  it('edits details and the roll number; refuses a full Aadhaar and a future date of birth', async () => {
    const ok = await http().patch(`${API}/students/${ids.Asha}`).set(auth(A.session)).send({ lastName: 'Kumar', apaarId: '123456789012', rollNo: '3' });
    expect(ok.status).toBe(200);
    const asha = await profile(ids.Asha);
    expect(asha).toMatchObject({ lastName: 'Kumar', apaarId: '123456789012' });
    expect(asha.enrollments[0].rollNo).toBe('3');
    expect((await http().patch(`${API}/students/${ids.Asha}`).set(auth(A.session)).send({ aadhaarLast4: '123456789012' })).status).toBe(422);
    expect((await http().patch(`${API}/students/${ids.Asha}`).set(auth(A.session)).send({ dob: '2099-01-01' })).status).toBe(422);
  });
});

describe('AC28 status changes keep history', () => {
  const change = (id: string, body: Record<string, unknown>) => http().post(`${API}/students/${id}/status`).set(auth(A.session)).send(body);
  const seats = async (id: string) => (await http().get(`${API}/students/${id}/sections`).set(auth(A.session))).body;

  it('inactive keeps the seat; dropped frees it; coming back needs a section with a free seat', async () => {
    expect((await change(ids.Kavya, { status: 'INACTIVE', effectiveDate: today, reason: 'Long medical leave' })).status).toBe(201);
    expect((await search(A.session, `sectionId=${sec1A}`)).body.total).toBe(3);
    expect((await change(ids.Kavya, { status: 'INACTIVE', effectiveDate: today, reason: 'again' })).body.type).toBe('same-status');

    expect((await change(ids.Kavya, { status: 'DROPPED', effectiveDate: today, reason: 'Family moved to Mysuru' })).status).toBe(201);
    const k = await profile(ids.Kavya);
    expect(k.status).toBe('DROPPED');
    expect(k.enrollments[0]).toMatchObject({ status: 'LEFT', endedOn: `${today}T00:00:00.000Z`, remarks: 'Family moved to Mysuru' });
    expect((await search(A.session, `sectionId=${sec1A}`)).body.total).toBe(2);

    const back = await change(ids.Kavya, { status: 'ACTIVE', effectiveDate: today, reason: 'Family returned' });
    expect(back.body.type).toBe('section-required');
    expect((await change(ids.Kavya, { status: 'ACTIVE', effectiveDate: today, reason: 'Family returned', sectionId: sec1A })).status).toBe(201);
    const h = (await profile(ids.Kavya)).statusHistory.map((x: { oldStatus: string | null; newStatus: string }) => `${x.oldStatus ?? '-'}→${x.newStatus}`);
    expect(h).toEqual(['DROPPED→ACTIVE', 'INACTIVE→DROPPED', 'ACTIVE→INACTIVE', '-→ACTIVE']);
    expect((await seats(ids.Kavya)).currentSectionId).toBe(sec1A);
  });

  it('transfer / passed out are not manual; future dates are refused; history cannot be edited', async () => {
    expect((await change(ids.Kavya, { status: 'TRANSFERRED', effectiveDate: today, reason: 'Moved school' })).status).toBe(422);
    expect((await change(ids.Kavya, { status: 'INACTIVE', effectiveDate: '2099-01-01', reason: 'Future leave' })).status).toBe(422);
    expect((await change(ids.Kavya, { status: 'INACTIVE', effectiveDate: '2020-01-01', reason: 'Before admission' })).body.type).toBe('date-before-admission');
    const db = appDb();
    await expect(db.$executeRawUnsafe(`UPDATE student_status_history SET reason = 'changed'`)).rejects.toThrow(/permission denied/);
    await expect(db.$executeRawUnsafe(`DELETE FROM student_status_history`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
    const events = await ownerDb().outboxEvent.count({ where: { tenantId: A.tenantId, eventType: 'student.status_changed', aggregateId: ids.Kavya } });
    expect(events).toBe(3);
  });
});

describe('AC28 section change keeps one active enrolment', () => {
  const move = (id: string, body: Record<string, unknown>) => http().post(`${API}/students/${id}/section`).set(auth(A.session)).send(body);

  it('moves within the class and year; the old row stays as MOVED', async () => {
    const opts = (await http().get(`${API}/students/${ids.Meera}/sections`).set(auth(A.session))).body;
    expect(opts.sections.map((s: { name: string; available: number }) => [s.name, s.available])).toEqual([['A', 0], ['B', 3]]);
    const res = await move(ids.Meera, { sectionId: sec1B, effectiveDate: today, reason: 'Parent request — sibling timing', rollNo: '1' });
    expect(res.status).toBe(201);
    const m = await profile(ids.Meera);
    expect(m.enrollments.map((e: { status: string; section: { name: string } }) => [e.status, e.section.name])).toEqual([['ACTIVE', 'B'], ['MOVED', 'A']]);
    expect(names(await search(A.session, `sectionId=${sec1B}`))).toEqual(['Meera']);
    expect(await ownerDb().studentEnrollment.count({ where: { studentId: ids.Meera, academicYearId: year, status: 'ACTIVE' } })).toBe(1);
  });

  it('refuses another class, the same section, a full section — and the database refuses a second active row', async () => {
    expect((await move(ids.Meera, { sectionId: sec2A, effectiveDate: today, reason: 'Wrong class' })).body.type).toBe('other-class');
    expect((await move(ids.Meera, { sectionId: sec1B, effectiveDate: today, reason: 'Same again' })).body.type).toBe('same-section');
    expect((await move(ids.Asha, { sectionId: sec1A, effectiveDate: today, reason: 'Same again' })).body.type).toBe('same-section');
    const db = ownerDb();
    await db.section.update({ where: { id: sec1B }, data: { capacity: 1 } });
    expect((await move(ids.Asha, { sectionId: sec1B, effectiveDate: today, reason: 'Wants B' })).body.type).toBe('section-full');
    await expect(
      db.studentEnrollment.create({ data: { tenantId: A.tenantId, studentId: ids.Meera, academicYearId: year, sectionId: sec1A, enrolledOn: new Date(), status: 'ACTIVE' } }),
    ).rejects.toThrow(/enrollments_active_uq|Unique constraint/);
    await db.$disconnect();
  });
});

describe('AC28 campus scope, isolation and module switch', () => {
  it('campus staff see and change only their campus', async () => {
    expect(names(await search(northStaff, ''))).toEqual(['Rahul']);
    expect((await http().get(`${API}/students/${ids.Kavya}`).set(auth(northStaff))).status).toBe(404);
    expect((await http().patch(`${API}/students/${ids.Kavya}`).set(auth(northStaff)).send({ lastName: 'X' })).status).toBe(404);
    expect((await search(northStaff, `campusId=${main}`)).status).toBe(404);
    const opts = (await http().get(`${API}/students/options`).set(auth(northStaff))).body;
    expect(opts.campuses.map((c: { code: string }) => c.code)).toEqual(['NORTH']);
    const job = await upload(northStaff, await xlsx(HEADERS, [row({ ...KAVYA, admissionNo: 'X/1', parentPhone: '9000000001' })]));
    expect((await http().get(`${API}/imports/jobs/${job.body.id}/rows?status=INVALID`).set(auth(northStaff))).body.items[0].errors.join()).toContain('you do not manage campus MAIN');
  });

  it('another institution sees nothing; without permission or module the routes are refused', async () => {
    expect((await http().get(`${API}/students/${ids.Kavya}`).set(auth(B.session))).status).toBe(404);
    expect((await search(B.session, 'q=kavya')).body.total).toBe(0);
    await createRole(A.tenantId, 'NO_STUDENTS', []);
    const nobody = (await addMember(app, A.session, { label: 'NoStu', roleCode: 'NO_STUDENTS' })).session;
    expect((await search(nobody, '')).status).toBe(403);

    const db = ownerDb();
    await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'STUDENTS' }, data: { isEnabled: false } });
    try {
      const off = await search(A.session, '');
      expect(off.status).toBe(403);
      expect(off.body.type).toBe('module-not-enabled');
      expect((await http().get(`${API}/imports/types`).set(auth(A.session))).body.map((t: { type: string }) => t.type)).not.toContain('STUDENTS');
      expect((await http().get(`${API}/exports/STUDENTS`).set(auth(A.session))).status).toBe(403);
    } finally {
      await db.tenantModule.updateMany({ where: { tenantId: A.tenantId, moduleCode: 'STUDENTS' }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });
});

describe('AC28 speed with 20,000 students', () => {
  it('search and the first page answer in under 300 ms', async () => {
    const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
    const P = await createTenant(app, platform, 'StuPerf');
    const campus = (await http().post(`${API}/campuses`).set(auth(P.session)).send({ code: 'BIG', name: 'Big School', campusType: 'SCHOOL' })).body.id;
    const y = (await http().post(`${API}/academic-years`).set(auth(P.session)).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
    const prog = (await http().post(`${API}/programs`).set(auth(P.session)).send({ campusId: campus, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10 })).body;
    for (const l of prog.levels) await http().post(`${API}/sections`).set(auth(P.session)).send({ academicYearId: y, programLevelId: l.id, names: ['A', 'B', 'C', 'D'], capacity: 500 });

    // 20,000 students, each with a father, a mother (main contact with a mobile) and an active enrolment.
    const db = ownerDb();
    const t = P.tenantId;
    await db.$executeRawUnsafe(`
      WITH secs AS (SELECT id, row_number() OVER (ORDER BY id) - 1 AS n FROM sections WHERE tenant_id = '${t}'),
      fn AS (SELECT ARRAY['Aarav','Ananya','Kavya','Rohan','Diya','Arjun','Isha','Karthik','Meera','Nikhil','Pooja','Rahul','Sneha','Varun','Yashas','Bhavya','Chetan','Divya','Ganesh','Harini'] a),
      ln AS (SELECT ARRAY['Rao','Gowda','Shetty','Iyer','Hegde','Naik','Patil','Kulkarni','Reddy','Bhat','Kamath','Murthy','Prasad','Joshi','Desai'] a),
      s AS (
        INSERT INTO students (id, tenant_id, campus_id, admission_no, first_name, last_name, dob, gender, admission_date, status, updated_at)
        SELECT gen_random_uuid(), '${t}', '${campus}', 'ADM/P/' || lpad(i::text, 5, '0'),
               (SELECT a[1 + (i % 20)] FROM fn), (SELECT a[1 + ((i / 20) % 15)] FROM ln) || ' ' || i,
               date '2012-01-01' + (i % 3000), CASE WHEN i % 2 = 0 THEN 'FEMALE' ELSE 'MALE' END, date '2026-06-01',
               CASE WHEN i % 50 = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END, now()
          FROM generate_series(1, 20000) i
        RETURNING id, admission_no
      )
      INSERT INTO student_enrollments (id, tenant_id, student_id, academic_year_id, section_id, enrolled_on, status, updated_at)
      SELECT gen_random_uuid(), '${t}', s.id, '${y}', secs.id, date '2026-06-01', 'ACTIVE', now()
        FROM s JOIN secs ON secs.n = (substr(s.admission_no, 7)::int % 40)`);
    await db.$executeRawUnsafe(`
      WITH g AS (
        INSERT INTO guardians (id, tenant_id, name, phone, updated_at)
        SELECT gen_random_uuid(), '${t}', 'Parent of ' || s.admission_no, '9' || lpad((800000000 + substr(s.admission_no, 7)::int)::text, 9, '0'), now()
          FROM students s WHERE s.tenant_id = '${t}'
        RETURNING id, name
      )
      INSERT INTO student_guardians (tenant_id, student_id, guardian_id, relation, is_primary)
      SELECT '${t}', s.id, g.id, 'MOTHER', true FROM g JOIN students s ON s.tenant_id = '${t}' AND 'Parent of ' || s.admission_no = g.name`);
    for (const tbl of ['students', 'student_enrollments', 'guardians', 'student_guardians']) await db.$executeRawUnsafe(`ANALYZE ${tbl}`);
    expect(await db.student.count({ where: { tenantId: t } })).toBe(20000);
    const sectionId = (await db.section.findFirst({ where: { tenantId: t, name: 'C', level: { sequence: 4 } } }))!.id;
    await db.$disconnect();

    const cases: [string, string][] = [
      ['first page', ''],
      ['name', 'q=kavya'],
      ['two words', 'q=kavya%20gowda'],
      ['admission no', 'q=P%2F1234'],
      ['parent mobile', 'q=9800001234'],
      ['section + name', `sectionId=${sectionId}&q=rao`],
      ['status + sort by class', 'status=INACTIVE&sort=class'],
      ['last page', 'page=800'],
    ];
    // Warm-up: each search once, right after 20,000 rows were bulk-inserted (cold cache and fresh
    // statistics are a test artefact; a school's data is warm). Then each search is timed.
    for (const [, qs] of cases) await search(P.session, qs);
    const timings: string[] = [];
    let worst = 0;
    for (const [label, qs] of cases) {
      const t0 = process.hrtime.bigint();
      const res = await search(P.session, qs);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      timings.push(`${label}: ${ms.toFixed(0)} ms (db ${res.body.tookMs} ms, ${res.body.total} found)`);
      expect(res.status).toBe(200);
      worst = Math.max(worst, ms);
    }
    // All timings are printed first, so a slow run shows which search was slow.
    console.log(`AC28 timings with 20,000 students\n  ${timings.join('\n  ')}`);
    expect(worst).toBeLessThan(300);
    expect((await search(P.session, 'q=9800001234')).body.items[0].admissionNo).toBe('ADM/P/01234');
    expect((await search(P.session, '')).body.total).toBe(20000);
  }, 180_000);
});
