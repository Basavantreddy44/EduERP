/**
 * AC83–AC86 Campus life II (Phase 16): library catalogue (accession numbers, ISBN, import, search);
 * circulation (never issued twice — also at once, limits, overdue block, fine billed to fees once,
 * renewals, reservations held for the first in line, lost copy billed, stock verification, own loans
 * only); health (rights, parents told, audit without details, vaccinations due); discipline (report,
 * class teacher read-only, parents told, review → action → close, fines with and without approval)
 * and counselling (notes encrypted, author only); isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let lib: Session;
let nurse: Session;
let warden: Session;
let ravi: Session;
let sunita: Session;
let head: Session;
let c1: Session;
let c2: Session;
let parent: Session;
const ids: Record<string, string> = {};
const tag = Date.now().toString(36);
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const nowIso = () => new Date(Date.now() - 60_000).toISOString();
const parentOf = async (student: string, email: string) => {
  const g = (await get(`/students/${student}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  await post(`/students/${student}/portal/guardians/${g}`, { email });
  await setPassword(email, 'Parent@Test123');
  const s = await login(app, email, 'Parent@Test123');
  return s.tenantId ? s : switchTenant(app, s, A.tenantId);
};
const issue = (code: string, student: string, s: Session = lib) => post('/library/issue', { code, memberType: 'STUDENT', memberId: ids[student] }, s);

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'LifeA');
  B = await createTenant(app, platform, 'LifeB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  const s0 = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A', 'B'], capacity: 40 })).body;
  const l0 = Array.isArray(s0) ? s0 : s0.items ?? s0.sections;
  ids.secA = l0.find((s: { name: string }) => s.name === 'A').id;
  ids.secB = l0.find((s: { name: string }) => s.name === 'B').id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, sec] of [['1', 'Asha', 'A'], ['2', 'Bala', 'B'], ['3', 'Chitra', 'B']] as const) {
    const r: Record<string, string> = { admissionNo: `LF/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: n === '2' ? 'Boy' : 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: sec, fatherName: `${f} Father`, parentPhone: `98444000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const [k, first, campus] of [['ravi', 'Ravi', main], ['sunita', 'Sunita', main], ['meena', 'Meena', north]] as const) ids[k] = (await post('/staff', { campusId: campus, firstName: first, gender: 'FEMALE', employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  await put(`/academics/sections/${ids.secA}/teachers`, { classTeacherId: ids.ravi, subjects: [] });
  await createRole(A.tenantId, 'LIB_R', [PERMISSIONS.LIB_MANAGE, PERMISSIONS.LIB_CIRCULATE, PERMISSIONS.LIB_WAIVE]);
  await createRole(A.tenantId, 'NURSE_R', [PERMISSIONS.HEALTH_READ, PERMISSIONS.HEALTH_MANAGE]);
  await createRole(A.tenantId, 'WARDEN_R', [PERMISSIONS.HEALTH_HOSTEL]);
  await createRole(A.tenantId, 'TEACH_R', [PERMISSIONS.DISC_REPORT, PERMISSIONS.DISC_CLASS]);
  await createRole(A.tenantId, 'HEAD_R', [PERMISSIONS.DISC_MANAGE, PERMISSIONS.DISC_REPORT]);
  await createRole(A.tenantId, 'COUNSEL_R', [PERMISSIONS.COUNSEL]);
  lib = (await addMember(app, A.session, { label: 'Lib', roleCode: 'LIB_R', campusId: main })).session;
  nurse = (await addMember(app, A.session, { label: 'Nurse', roleCode: 'NURSE_R', campusId: main })).session;
  warden = (await addMember(app, A.session, { label: 'Warden', roleCode: 'WARDEN_R', campusId: main })).session;
  const r = await addMember(app, A.session, { label: 'RaviCl', roleCode: 'TEACH_R', campusId: main });
  ravi = r.session;
  await post(`/staff/${ids.ravi}/user`, { userId: r.userId });
  const s = await addMember(app, A.session, { label: 'SunitaCl', roleCode: 'TEACH_R', campusId: main });
  sunita = s.session;
  await post(`/staff/${ids.sunita}/user`, { userId: s.userId });
  head = (await addMember(app, A.session, { label: 'Head', roleCode: 'HEAD_R', campusId: main })).session;
  c1 = (await addMember(app, A.session, { label: 'CounselOne', roleCode: 'COUNSEL_R', campusId: main })).session;
  c2 = (await addMember(app, A.session, { label: 'CounselTwo', roleCode: 'COUNSEL_R', campusId: main })).session;
  parent = await parentOf(ids.Asha, `life.parent.${tag}@test.local`);
}, 180_000);
afterAll(() => app?.close());

describe('AC83 library catalogue', () => {
  it('numbers copies automatically, refuses duplicate accession numbers and ISBNs, and finds books', async () => {
    expect((await get('/library/settings', lib)).body).toMatchObject({ studentLoanDays: 14, studentMaxBooks: 2, maxRenewals: 1, finePerDay: '1.00' });
    const b = await post('/library/books', { title: 'Wings of Fire', authors: 'A. P. J. Abdul Kalam', isbn: '978-81-7371-146-6', subject: 'Biography' }, lib);
    expect(b.status).toBe(201);
    ids.wings = b.body.id;
    expect((await post('/library/books', { title: 'Wings again', isbn: '9788173711466' }, lib)).status).toBe(409);
    const c = await post(`/library/books/${ids.wings}/copies`, { campusId: main, count: 3, price: 295 }, lib);
    expect(c.body.accessionNos).toEqual(['1', '2', '3']);
    expect((await post(`/library/books/${ids.wings}/copies`, { campusId: main, accessionNo: 'r-100' }, lib)).body.accessionNos).toEqual(['R-100']);
    expect((await post(`/library/books/${ids.wings}/copies`, { campusId: main, accessionNo: 'R-100' }, lib)).status).toBe(409);
    expect((await post(`/library/books/${ids.wings}/copies`, { campusId: north, count: 1 }, lib)).status).toBe(404);
    for (const term of ['wings', 'kalam', '9788173711466', 'R-100']) expect((await get(`/library/books?q=${encodeURIComponent(term)}`, lib)).body.map((x: { id: string }) => x.id)).toContain(ids.wings);
    expect((await get('/library/books?q=wings', lib)).body[0]).toMatchObject({ copies: 4, available: 4 });
    ids.pancha = (await post('/library/books', { title: 'Panchatantra Tales', authors: 'Vishnu Sharma' }, lib)).body.id;
    await post(`/library/books/${ids.pancha}/copies`, { campusId: main, accessionNo: 'P-1', price: 150 }, lib);
  });

  it('imports the accession register: one row per copy, copies of one ISBN become one book', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(IMPORT_TYPES.LIBRARY_BOOKS.columns.map((c) => c.header));
    const rows = [
      { accessionNo: 'K-1', title: 'Malgudi Days', authors: 'R. K. Narayan', isbn: '9780143039655', campusCode: 'MAIN', price: '250' },
      { accessionNo: 'K-2', title: 'Malgudi Days', authors: 'R. K. Narayan', isbn: '9780143039655', campusCode: 'MAIN', price: '250' },
      { accessionNo: 'R-100', title: 'Duplicate accession', campusCode: 'MAIN' },
    ];
    for (const r of rows) ws.addRow(IMPORT_TYPES.LIBRARY_BOOKS.columns.map((c) => (r as Record<string, string>)[c.key] ?? ''));
    const job = await http().post(`${API}/imports/LIBRARY_BOOKS`).set(auth(lib)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'books.xlsx');
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ validRows: 2, errorRows: 1 });
    expect((await post(`/imports/jobs/${job.body.id}/commit`, {}, lib)).status).toBeLessThan(300);
    const found = (await get('/library/books?q=9780143039655', lib)).body;
    expect(found).toHaveLength(1);
    expect(found[0].copies).toBe(2);
  });
});

describe('AC84 circulation', () => {
  it('a copy is never issued twice — also when two desks issue it at once; limits hold', async () => {
    expect((await issue('1', 'Asha')).status).toBe(201);
    expect((await issue('1', 'Bala')).status).toBe(409);
    const [x, y] = await Promise.all([issue('2', 'Bala'), issue('2', 'Chitra')]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect((await issue('3', 'Asha')).status).toBe(201);
    const third = await issue('R-100', 'Asha');
    expect(third.status).toBe(409);
    expect(third.body.type).toBe('member-limit');
    expect((await post('/library/issue', { code: '3', memberType: 'STUDENT', memberId: ids.Asha }, ravi)).status).toBe(403);
  });

  it('an overdue book blocks new loans; a late return bills the fine to fees once (or waives it)', async () => {
    const db = ownerDb();
    const copy1 = await db.libraryCopy.findFirstOrThrow({ where: { tenantId: A.tenantId, accessionNo: '1' } });
    await db.libraryIssue.updateMany({ where: { copyId: copy1.id, status: 'ISSUED' }, data: { issueDate: new Date(`${shift(-20)}T00:00:00Z`), dueDate: new Date(`${shift(-5)}T00:00:00Z`) } });
    await db.$disconnect();
    await post('/library/return', { code: '3' }, lib);
    const blocked = await issue('3', 'Asha');
    expect(blocked.body.type).toBe('member-overdue');
    const noHead = await post('/library/return', { code: '1' }, lib);
    expect(noHead.status).toBe(409);
    expect(noHead.body.type).toBe('no-fine-head');
    expect((await post('/fees/heads', { name: 'Fines', code: 'FINE', feeType: 'FINE' })).status).toBe(201);
    const r = await post('/library/return', { code: '1' }, lib);
    expect(r.body).toMatchObject({ daysLate: 5, fine: '5.00', fineStatus: 'CHARGED' });
    expect((await post('/library/return', { code: '1' }, lib)).status).toBe(409);
    const db2 = ownerDb();
    const bills = await db2.feeInvoice.findMany({ where: { tenantId: A.tenantId, studentId: ids.Asha, description: { contains: 'Library fine' } } });
    expect(bills).toHaveLength(1);
    expect(Number(bills[0].netAmount)).toBe(5);
    await db2.$disconnect();
  });

  it('renewals respect the limit; a reserved book is held for the first in line', async () => {
    const bala = (await get(`/library/members/STUDENT/${ids.Bala}`, lib)).body;
    const loan = bala.loans.find((l: { accessionNo: string }) => l.accessionNo === '2');
    const rn = await post(`/library/loans/${loan.id}/renew`, {}, lib);
    expect(rn.body.renewCount).toBe(1);
    expect((await post(`/library/loans/${loan.id}/renew`, {}, lib)).body.type).toBe('renew-limit');
    // Panchatantra has one copy: Chitra has it, Asha waits.
    expect((await issue('P-1', 'Chitra')).status).toBe(201);
    const res = await post('/library/reservations', { memberType: 'STUDENT', memberId: ids.Asha, bookId: ids.pancha, campusId: main }, lib);
    expect(res.body.position).toBe(1);
    expect((await post('/library/reservations', { memberType: 'STUDENT', memberId: ids.Asha, bookId: ids.pancha, campusId: main }, lib)).status).toBe(409);
    const chitraLoan = (await get(`/library/members/STUDENT/${ids.Chitra}`, lib)).body.loans[0];
    expect((await post(`/library/loans/${chitraLoan.id}/renew`, {}, lib)).body.type).toBe('reserved');
    expect((await post('/library/return', { code: 'P-1' }, lib)).body.heldFor).toBe('Asha Test');
    expect((await issue('P-1', 'Bala')).body.type).toBe('copy-held');
    expect((await issue('P-1', 'Asha')).status).toBe(201);
    const db = ownerDb();
    expect((await db.libraryReservation.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe('COLLECTED');
    await db.$disconnect();
  });

  it('a lost copy bills its price; borrowers see only their own loans', async () => {
    const bala = (await get(`/library/members/STUDENT/${ids.Bala}`, lib)).body;
    const lost = await post(`/library/loans/${bala.loans[0].id}/lost`, { remarks: 'Lost on the bus' }, lib);
    expect(lost.body).toMatchObject({ status: 'LOST', charged: '295.00' });
    const mine = await get(`/library/children/${ids.Asha}`, parent);
    expect(mine.status).toBe(200);
    expect(mine.body.loans.map((l: { title: string }) => l.title)).toContain('Panchatantra Tales');
    expect((await get(`/library/children/${ids.Bala}`, parent)).status).toBe(404);
    const staff = await post('/library/issue', { code: '3', memberType: 'EMPLOYEE', memberId: ids.ravi }, lib);
    expect(staff.status).toBe(201);
    expect((await get('/library/my', ravi)).body.loans.map((l: { accessionNo: string }) => l.accessionNo)).toEqual(['3']);
  });

  it('stock verification lists what was not found and can mark it lost', async () => {
    const ck = await post('/library/stock-check', { campusId: main }, lib);
    expect(ck.body.open.expected).toBeGreaterThan(0);
    expect((await post('/library/stock-check', { campusId: main }, lib)).status).toBe(409);
    const scan = await post(`/library/stock-check/${ck.body.open.id}/scan`, { code: 'R-100' }, lib);
    expect(scan.body.scanned).toBe(1);
    expect((await post(`/library/stock-check/${ck.body.open.id}/scan`, { code: 'R-100' }, lib)).body.already).toBe(true);
    const missing = scan.body.missing.map((m: { accessionNo: string }) => m.accessionNo);
    expect(missing).toEqual(expect.arrayContaining(['1', 'K-1', 'K-2']));
    expect(missing).not.toContain('R-100');
    const closed = await post(`/library/stock-check/${ck.body.open.id}/close`, { markLost: true }, lib);
    expect(closed.body.markedLost).toBe(closed.body.missing);
    const db = ownerDb();
    expect((await db.libraryCopy.findFirstOrThrow({ where: { tenantId: A.tenantId, accessionNo: 'K-1' } })).status).toBe('LOST');
    expect((await db.libraryCopy.findFirstOrThrow({ where: { tenantId: A.tenantId, accessionNo: 'R-100' } })).status).toBe('AVAILABLE');
    await db.$disconnect();
  });
});

describe('AC85 health & infirmary', () => {
  it('health records need the health right; the audit log keeps no health details', async () => {
    expect((await get(`/health/students/${ids.Asha}`, ravi)).status).toBe(404);
    expect((await get(`/health/students/${ids.Asha}`, warden)).status).toBe(404); // not in the warden's hostel
    expect((await put(`/health/students/${ids.Asha}/profile`, { heightCm: 132, weightKg: 29, allergies: 'Peanuts (severe)', doctorPhone: '9845012345' }, nurse)).status).toBe(200);
    const v = (await get(`/health/students/${ids.Asha}`, nurse)).body;
    expect(v.profile).toMatchObject({ heightCm: 132, allergies: 'Peanuts (severe)' });
    const db = ownerDb();
    const logs = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'HEALTH_PROFILE' } });
    expect(JSON.stringify(logs)).not.toContain('Peanuts');
    await db.$disconnect();
  });

  it('a child sent home is recorded and the parents are told', async () => {
    const v = await post('/health/visits', { memberType: 'STUDENT', memberId: ids.Asha, campusId: main, complaint: 'Fever and headache', temperature: 101.2, outcome: 'SENT_HOME' }, nurse);
    expect(v.status).toBe(201);
    expect(v.body.parentInformed).toBe(true);
    const back = await post('/health/visits', { memberType: 'STUDENT', memberId: ids.Bala, campusId: main, complaint: 'Scraped knee', treatment: 'Cleaned and dressed', outcome: 'RETURNED_TO_CLASS' }, nurse);
    expect(back.body.parentInformed).toBe(false);
    expect((await post('/health/visits', { memberType: 'EMPLOYEE', memberId: ids.meena, campusId: north, complaint: 'Cold', outcome: 'REST' }, nurse)).status).toBe(404);
    expect((await get('/health/visits', nurse)).body.map((x: { complaint: string }) => x.complaint)).toEqual(expect.arrayContaining(['Fever and headache', 'Scraped knee']));
  });

  it('vaccinations due are listed until the next dose is recorded', async () => {
    await post(`/health/students/${ids.Asha}/vaccinations`, { vaccineName: 'Hepatitis B', doseNo: 1, vaccinationDate: shift(-20), nextDueDate: shift(10) }, nurse);
    expect((await post(`/health/students/${ids.Asha}/vaccinations`, { vaccineName: 'Typhoid', vaccinationDate: shift(-1), nextDueDate: shift(-2) }, nurse)).status).toBe(422);
    const due = (await get('/health/vaccinations/due?days=30', nurse)).body;
    expect(due.find((d: { vaccineName: string }) => d.vaccineName === 'Hepatitis B')).toMatchObject({ nextDose: 2, overdue: false });
    await post(`/health/students/${ids.Asha}/vaccinations`, { vaccineName: 'Hepatitis B', doseNo: 2, vaccinationDate: today }, nurse);
    expect((await get('/health/vaccinations/due?days=30', nurse)).body.find((d: { vaccineName: string }) => d.vaccineName === 'Hepatitis B')).toBeUndefined();
  });
});

describe('AC86 discipline & counselling', () => {
  it('teachers report; the class teacher reads their class only; parents are told when the type says so', async () => {
    const types = (await get('/discipline/types', head)).body;
    ids.bully = types.find((t: { name: string }) => t.name === 'Bullying').id;
    ids.late = types.find((t: { name: string }) => t.name === 'Late coming').id;
    const a = await post('/discipline/incidents', { studentId: ids.Asha, typeId: ids.late, incidentAt: nowIso(), description: 'Came in after the assembly' }, sunita);
    expect(a.body.parentNotified).toBe(false);
    ids.ashaLate = a.body.id;
    const b = await post('/discipline/incidents', { studentId: ids.Bala, typeId: ids.bully, incidentAt: nowIso(), location: 'Playground', description: 'Pushed a younger child repeatedly during lunch' }, sunita);
    expect(b.body.parentNotified).toBe(false); // Bala's parents have no app or email
    ids.balaBully = b.body.id;
    expect((await get(`/discipline/incidents/${ids.ashaLate}`, ravi)).status).toBe(200); // Ravi is Asha's class teacher
    expect((await get(`/discipline/incidents/${ids.balaBully}`, ravi)).status).toBe(404);
    expect((await post(`/discipline/incidents/${ids.ashaLate}/review`, {}, ravi)).status).toBe(403);
    const told = await post('/discipline/incidents', { studentId: ids.Asha, typeId: ids.bully, incidentAt: nowIso(), description: 'Name-calling in class' }, head);
    expect(told.body.parentNotified).toBe(true);
  });

  it('review → action → closed; a fine is billed to fees, after approval where a rule exists', async () => {
    expect((await post(`/discipline/incidents/${ids.balaBully}/review`, {}, head)).body.status).toBe('UNDER_REVIEW');
    expect((await post(`/discipline/incidents/${ids.balaBully}/actions`, { actionType: 'SUSPENSION', description: 'Suspended' }, head)).status).toBe(422);
    expect((await post(`/discipline/incidents/${ids.balaBully}/actions`, { actionType: 'SUSPENSION', description: 'Two days at home', fromDate: shift(1), toDate: shift(2) }, head)).status).toBe(201);
    const fine = await post(`/discipline/incidents/${ids.balaBully}/actions`, { actionType: 'FINE', description: 'Broken window share', fineAmount: 200 }, head);
    expect(fine.body.fineStatus).toBe('CHARGED');
    const db = ownerDb();
    expect(await db.feeInvoice.count({ where: { tenantId: A.tenantId, studentId: ids.Bala, description: { contains: 'Discipline fine' } } })).toBe(1);
    const adminRole = await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'INSTITUTION_ADMIN' } });
    await db.$disconnect();
    expect((await post('/approvals/rules', { entityType: 'DISCIPLINE_FINE', levelNo: 1, approverRoleId: adminRole.id })).status).toBe(201);
    const pending = await post(`/discipline/incidents/${ids.balaBully}/actions`, { actionType: 'FINE', description: 'Second fine', fineAmount: 100 }, head);
    expect(pending.body.fineStatus).toBe('PENDING_APPROVAL');
    const req = (await get('/approvals/inbox')).body.find((x: { entityType: string }) => x.entityType === 'DISCIPLINE_FINE');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' })).status).toBeLessThan(300);
    const v = (await get(`/discipline/incidents/${ids.balaBully}`, head)).body;
    expect(v.status).toBe('ACTION_TAKEN');
    expect(v.actions.map((x: { fineStatus: string }) => x.fineStatus)).toEqual(['NONE', 'CHARGED', 'CHARGED']);
    expect((await post(`/discipline/incidents/${ids.balaBully}/close`, { closingNote: 'Parents met; apology given' }, head)).body.status).toBe('CLOSED');
    expect((await post(`/discipline/incidents/${ids.balaBully}/actions`, { actionType: 'WARNING', description: 'Late' }, head)).status).toBe(409);
  });

  it('counselling notes are stored encrypted and only their author can read them', async () => {
    const s = await post('/discipline/counselling', { studentId: ids.Bala, sessionAt: nowIso(), referralSource: 'DISCIPLINE', incidentId: ids.balaBully, notes: 'Worried about home situation; follow up weekly', followUpDate: shift(7) }, c1);
    expect(s.status).toBe(201);
    const db = ownerDb();
    const row = await db.counsellingSession.findUniqueOrThrow({ where: { id: s.body.id } });
    expect(row.notesEnc).toMatch(/^v1:/);
    expect(row.notesEnc).not.toContain('home situation');
    const logs = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'COUNSELLING_SESSION' } });
    expect(JSON.stringify(logs)).not.toContain('home situation');
    await db.$disconnect();
    expect((await get(`/discipline/counselling/${s.body.id}`, c1)).body.notes).toContain('home situation');
    const other = (await get(`/discipline/counselling/${s.body.id}`, c2)).body;
    expect(other).toMatchObject({ notes: null, notesHidden: true });
    expect((await put(`/discipline/counselling/${s.body.id}`, { studentId: ids.Bala, sessionAt: nowIso(), referralSource: 'SELF', notes: 'changed' }, c2)).status).toBe(409);
    expect((await get(`/discipline/counselling/${s.body.id}`, head)).status).toBe(403);
  });

  it('another institution sees none of it', async () => {
    expect((await get(`/library/books/${ids.wings}`, B.session)).status).toBe(404);
    expect((await get('/library/books?q=wings', B.session)).body).toHaveLength(0);
    expect((await get(`/health/students/${ids.Asha}`, B.session)).status).toBe(404);
    expect((await get(`/discipline/incidents/${ids.balaBully}`, B.session)).status).toBe(404);
    expect((await get('/discipline/incidents', B.session)).body).toHaveLength(0);
  });
});
