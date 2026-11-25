/**
 * AC109–AC113 Residential edition (Phase 21): the allotment list import and joining (one student, also
 * when pressed twice at once; only the school's own allotments); moves between schools (history, records
 * kept, refused while a bed is held, audited) and staff moves; the monthly report by school; the warden's
 * daily report and remarks; health check-up camps. Isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let HO: Session; // head office (institution admin)
let pHns: Session; // principal of Hunsur
let pKlg: Session; // principal of Kollegal
let other: Awaited<ReturnType<typeof createTenant>>;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (p: string, b: unknown, s: Session = HO) => http().post(`${API}${p}`).set(auth(s)).send(b as object);
const put = (p: string, b: unknown, s: Session = HO) => http().put(`${API}${p}`).set(auth(s)).send(b as object);
const patch = (p: string, b: unknown, s: Session = HO) => http().patch(`${API}${p}`).set(auth(s)).send(b as object);
const get = (p: string, s: Session = HO) => http().get(`${API}${p}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function upload(rows: Record<string, string>[], s: Session = HO) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.ALLOTMENTS.columns.map((c) => c.header));
  for (const r of rows) ws.addRow(IMPORT_TYPES.ALLOTMENTS.columns.map((c) => r[c.key] ?? ''));
  return http().post(`${API}/imports/ALLOTMENTS`).set(auth(s)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'allot.xlsx');
}
const allot = (n: string, o: Partial<Record<string, string>> = {}) => ({ entranceRegNo: `MDRS26-${n}`, firstName: `Child${n}`, lastName: 'Test', gender: Number(n) % 2 ? 'Girl' : 'Boy', dob: '2015-03-14', category: 'SC', quota: 'SC rural', rank: n, campusCode: 'HNS', className: 'Class 6', fatherName: `Father ${n}`, parentPhone: `98440${n.padStart(5, '0')}`, address: 'Hunsur', ...o });

beforeAll(async () => {
  app = await startApp();
  const platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  const slug = `res-${Date.now().toString(36)}`;
  const admin = { fullName: 'Head Office', email: `ho.${slug}@test.local`, password: 'Admin@Test12345' };
  const t = await http().post(`${API}/platform/tenants`).set(auth(platform)).send({ name: 'Res Schools', slug, institutionType: 'GROUP', edition: 'RESIDENTIAL', admin });
  ids.tenant = t.body.id;
  HO = await login(app, admin.email, admin.password);
  other = await createTenant(app, platform, 'ResOther');
  ids.hns = (await post('/campuses', { code: 'HNS', name: 'MDRS Hunsur', campusType: 'SCHOOL', district: 'Mysuru' })).body.id;
  ids.klg = (await post('/campuses', { code: 'KLG', name: 'MDRS Kollegal', campusType: 'SCHOOL', district: 'Chamarajanagar' })).body.id;
  const ys = `${shift(-120).slice(0, 7)}-01`;
  const ye = new Date(Date.parse(`${ys}T00:00:00Z`)); ye.setUTCMonth(ye.getUTCMonth() + 12); ye.setUTCDate(0);
  ids.year = (await post('/academic-years', { name: `${ys.slice(0, 4)}-${ye.toISOString().slice(2, 4)}`, startDate: ys, endDate: ye.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  for (const [campus, code] of [[ids.hns, 'MH'], [ids.klg, 'MK']]) {
    const p = (await post('/programs', { campusId: campus, name: 'Residential School', code, programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2, startAt: 6 })).body;
    for (const l of p.levels) {
      const sec = (await post('/sections', { academicYearId: ids.year, programLevelId: l.id, names: ['A'], capacity: 40 })).body;
      ids[`${code}-${l.name}`] = (Array.isArray(sec) ? sec[0] : sec.sections?.[0] ?? sec).id;
    }
  }
  pHns = (await addMember(app, HO, { label: 'PrinHns', roleCode: 'PRINCIPAL', campusId: ids.hns })).session;
  pKlg = (await addMember(app, HO, { label: 'PrinKlg', roleCode: 'PRINCIPAL', campusId: ids.klg })).session;
}, 180_000);
afterAll(() => app?.close());

describe('AC109 allotment list', () => {
  it('the import checks every row; nothing becomes a student until joining', async () => {
    const job = await upload([
      allot('1'), allot('2'), allot('3', { campusCode: 'KLG', parentPhone: '9844000003' }), allot('4', { campusCode: 'KLG', parentPhone: '9844000004', category: 'Cat-1' }),
      allot('1', { firstName: 'Twice' }), allot('5', { className: 'Class 9' }), allot('6', { fatherName: '' }), allot('7', { parentPhone: '12345' }), allot('8', { campusCode: 'XYZ' }),
    ]);
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ validRows: 4, errorRows: 5 });
    expect((await post(`/imports/jobs/${job.body.id}/commit`, {})).status).toBeLessThan(300);
    const again = await upload([allot('2')]);
    expect(again.body).toMatchObject({ validRows: 0, errorRows: 1 });
    // a principal cannot import the list
    expect((await upload([allot('9')], pHns)).status).toBe(403);
    const db = ownerDb();
    expect(await db.student.count({ where: { tenantId: ids.tenant } })).toBe(0);
    await db.$disconnect();
    const l = (await get('/allotments')).body;
    expect(l.rows).toHaveLength(4);
    expect(l.rows.find((r: { entranceRegNo: string }) => r.entranceRegNo === 'MDRS26-4').category).toBe('CAT_1');
    expect(l.summary.find((s: { campus: string }) => s.campus === 'MDRS Hunsur')).toMatchObject({ allotted: 2, waiting: 2, joined: 0 });
    for (const r of l.rows) ids[r.entranceRegNo] = r.id;
    // a principal sees only their school
    const k = (await get('/allotments', pKlg)).body;
    expect(k.rows.map((r: { entranceRegNo: string }) => r.entranceRegNo)).toEqual(['MDRS26-3', 'MDRS26-4']);
  });

  it('joining creates one student in the allotted class — also when pressed twice at once', async () => {
    const a = ids['MDRS26-1'];
    expect((await post(`/allotments/${a}/join`, { sectionId: ids['MH-Class 6'], joinedOn: today }, pKlg)).status).toBe(404);
    expect((await post(`/allotments/${a}/join`, { sectionId: ids['MH-Class 7'], joinedOn: today }, pHns)).status).toBe(422);
    expect((await post(`/allotments/${a}/join`, { sectionId: ids['MK-Class 6'], joinedOn: today }, pHns)).status).toBe(422);
    const opts = (await get(`/allotments/${a}/sections`, pHns)).body;
    expect(opts.map((s: { id: string }) => s.id)).toEqual([ids['MH-Class 6']]);
    const [r1, r2] = await Promise.all([
      post(`/allotments/${a}/join`, { sectionId: ids['MH-Class 6'], joinedOn: today }, pHns),
      post(`/allotments/${a}/join`, { sectionId: ids['MH-Class 6'], joinedOn: today }, pHns),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const ok = r1.status === 200 ? r1.body : r2.body;
    ids.s1 = ok.studentId;
    const db = ownerDb();
    const s = await db.student.findUniqueOrThrow({ where: { id: ids.s1 }, include: { guardians: true, enrollments: true } });
    const hist = await db.studentStatusHistory.findFirst({ where: { studentId: ids.s1 } });
    expect(await db.student.count({ where: { tenantId: ids.tenant } })).toBe(1);
    await db.$disconnect();
    expect(s).toMatchObject({ campusId: ids.hns, firstName: 'Child1', category: 'SC', admissionNo: ok.admissionNo });
    expect(s.guardians).toHaveLength(1);
    expect(s.enrollments[0].sectionId).toBe(ids['MH-Class 6']);
    expect(hist?.reason).toBe('Joined from allotment MDRS26-1');
    // a joined allotment never changes
    expect((await post(`/allotments/${a}/status`, { status: 'NOT_REPORTED', date: today, reason: 'test' }, pHns)).status).toBe(409);
  });

  it('not reported by the school, cancelled only by head office, and back to allotted', async () => {
    const a = ids['MDRS26-2'];
    expect((await post(`/allotments/${a}/status`, { status: 'NOT_REPORTED', date: today, reason: 'x' }, pHns)).status).toBe(422);
    expect((await post(`/allotments/${a}/status`, { status: 'NOT_REPORTED', date: today, reason: 'Did not come by the last date' }, pHns)).body.status).toBe('NOT_REPORTED');
    expect((await post(`/allotments/${a}/status`, { status: 'CANCELLED', date: today, reason: 'Seat given to the next child' }, pHns)).status).toBe(403);
    expect((await post(`/allotments/${a}/status`, { status: 'CANCELLED', date: today, reason: 'Seat given to the next child' })).body.status).toBe('CANCELLED');
    expect((await post(`/allotments/${a}/status`, { status: 'ALLOTTED', date: today, reason: 'Came late with a reason' }, pHns)).status).toBe(403);
    expect((await post(`/allotments/${a}/status`, { status: 'ALLOTTED', date: today, reason: 'Came late with a reason' })).body.status).toBe('ALLOTTED');
    const j = await post(`/allotments/${a}/join`, { sectionId: ids['MH-Class 6'], joinedOn: today }, pHns);
    expect(j.status).toBe(200);
    ids.s2 = j.body.studentId;
    const db = ownerDb();
    const audits = await db.auditLog.count({ where: { tenantId: ids.tenant, entityType: 'STUDENT_ALLOTMENT', action: 'STATUS_CHANGE' } });
    await db.$disconnect();
    expect(audits).toBe(3);
  });
});

describe('AC110 moves between schools', () => {
  it('a student moves with their record; refused while holding a bed; history and audit', async () => {
    expect((await post(`/moves/students/${ids.s1}`, { toCampusId: ids.klg, sectionId: ids['MK-Class 6'], transferDate: today, reason: 'Parent moved' }, pHns)).status).toBe(403);
    const o = (await get(`/moves/students/${ids.s1}/options`)).body;
    expect(o).toMatchObject({ levelName: 'Class 6', holdsBed: false });
    expect(o.schools.map((s: { campusId: string }) => s.campusId)).toEqual([ids.klg]);
    expect((await post(`/moves/students/${ids.s1}`, { toCampusId: ids.hns, sectionId: ids['MH-Class 6'], transferDate: today, reason: 'Same school' })).status).toBe(422);
    expect((await post(`/moves/students/${ids.s1}`, { toCampusId: ids.klg, sectionId: ids['MK-Class 7'], transferDate: today, reason: 'Wrong class' })).status).toBe(422);
    const m = await post(`/moves/students/${ids.s1}`, { toCampusId: ids.klg, sectionId: ids['MK-Class 6'], transferDate: today, orderNo: 'KREIS/TR/2026/14', reason: 'Parent transferred to Kollegal' });
    expect(m.status).toBe(201);
    const db = ownerDb();
    const s = await db.student.findUniqueOrThrow({ where: { id: ids.s1 }, include: { enrollments: { orderBy: { createdAt: 'asc' } } } });
    const audit = await db.auditLog.findFirst({ where: { tenantId: ids.tenant, entityType: 'STUDENT_MOVE', entityId: ids.s1 } });
    await db.$disconnect();
    expect(s.campusId).toBe(ids.klg);
    expect(s.enrollments.map((e) => [e.status, e.sectionId])).toEqual([['MOVED', ids['MH-Class 6']], ['ACTIVE', ids['MK-Class 6']]]);
    expect(audit?.reason).toBe('Parent transferred to Kollegal');
    const h = (await get(`/moves/students/${ids.s1}`)).body;
    expect(h[0]).toMatchObject({ from: 'MDRS Hunsur', to: 'MDRS Kollegal', orderNo: 'KREIS/TR/2026/14', transferDate: today });
    // both principals see the move in their list; the new school now holds the student
    expect((await get('/moves', pKlg)).body.map((x: { personId: string }) => x.personId)).toContain(ids.s1);
    expect((await get(`/students/${ids.s1}`, pKlg)).status).toBe(200);
    expect((await get(`/students/${ids.s1}`, pHns)).status).toBe(404);

    // bed held → refused
    const hostel = (await post('/hostel/hostels', { campusId: ids.hns, name: 'Hunsur girls', hostelType: 'GIRLS', depositAmount: '0' })).body;
    const hostelB = (await post('/hostel/hostels', { campusId: ids.hns, name: 'Hunsur boys', hostelType: 'BOYS', depositAmount: '0' })).body;
    ids.hostel = hostel.id; ids.hostelB = hostelB.id;
    await post(`/hostel/hostels/${hostel.id}/rooms/bulk`, { prefix: 'G', from: 1, to: 1, roomType: 'DORMITORY', capacity: 8, feeAmount: '0' });
    await post(`/hostel/hostels/${hostelB.id}/rooms/bulk`, { prefix: 'B', from: 1, to: 1, roomType: 'DORMITORY', capacity: 8, feeAmount: '0' });
    const free = (await get(`/hostel/students/${ids.s2}/free-beds`)).body;
    const stay = free.hostels.find((x: { rooms: unknown[] }) => x.rooms.length);
    ids.stayHostel = stay.id;
    const bedId = stay.rooms[0].beds[0].id;
    const al = await post('/hostel/allotments', { studentId: ids.s2, bedId, checkInDate: today, bill: false });
    expect(al.status).toBe(201);
    expect((await post(`/hostel/allotments/${al.body.id}/check-in`, { items: [] })).body.status).toBe('CHECKED_IN');
    expect((await get(`/moves/students/${ids.s2}/options`)).body.holdsBed).toBe(true);
    expect((await post(`/moves/students/${ids.s2}`, { toCampusId: ids.klg, sectionId: ids['MK-Class 6'], transferDate: today, reason: 'Try' })).body.type).toBe('holds-hostel-bed');
  });

  it('a staff member moves to another school with a department of that school', async () => {
    const e = (await post('/staff', { campusId: ids.hns, firstName: 'Shobha', gender: 'FEMALE', employeeType: 'TEACHING', designation: 'Assistant Teacher', joiningDate: shift(-400) })).body.id;
    const dHns = (await post('/departments', { campusId: ids.hns, name: 'Science', code: 'SCI', deptType: 'ACADEMIC' })).body.id;
    const dKlg = (await post('/departments', { campusId: ids.klg, name: 'Science', code: 'SCI', deptType: 'ACADEMIC' })).body.id;
    expect((await post(`/moves/staff/${e}`, { toCampusId: ids.klg, departmentId: dHns, transferDate: today, reason: 'Counselling transfer' })).status).toBe(422);
    expect((await post(`/moves/staff/${e}`, { toCampusId: ids.klg, departmentId: dKlg, transferDate: today, orderNo: 'GO-118', reason: 'Counselling transfer' }, pHns)).status).toBe(403);
    expect((await post(`/moves/staff/${e}`, { toCampusId: ids.klg, departmentId: dKlg, transferDate: today, orderNo: 'GO-118', reason: 'Counselling transfer' })).status).toBe(201);
    const db = ownerDb();
    const emp = await db.employee.findUniqueOrThrow({ where: { id: e } });
    await db.$disconnect();
    expect(emp).toMatchObject({ campusId: ids.klg, departmentId: dKlg });
    expect((await get(`/moves/staff/${e}`)).body[0]).toMatchObject({ personType: 'STAFF', from: 'MDRS Hunsur', to: 'MDRS Kollegal', orderNo: 'GO-118' });
    expect((await get('/moves?personType=STAFF')).body).toHaveLength(1);
  });
});

describe('AC111 monthly report by school', () => {
  it('counts match the records; a principal sees only their school', async () => {
    const r = (await post('/reports/run/MIS_MONTHLY', { from: `${today.slice(0, 7)}-01`, to: today })).body;
    const rows = r.rows as Record<string, string | number | null>[];
    const hns = rows.find((x) => x.school === 'MDRS Hunsur')!;
    const klg = rows.find((x) => x.school === 'MDRS Kollegal')!;
    expect(hns).toMatchObject({ district: 'Mysuru', students: 1, joined: 2, movedOut: 1, movedIn: 0, hostel: 1 });
    expect(klg).toMatchObject({ district: 'Chamarajanagar', students: 1, movedIn: 1, joined: 0 });
    expect(rows.find((x) => x.school === 'All 2 schools')).toMatchObject({ students: 2, joined: 2 });
    const p = (await post('/reports/run/MIS_MONTHLY', { from: `${today.slice(0, 7)}-01`, to: today }, pHns)).body.rows as { school: string }[];
    expect(p.map((x) => x.school)).toEqual(['MDRS Hunsur']);
  });
});

describe('AC112 warden daily report', () => {
  it('counts follow roll call, outpasses and sick visits; remarks are one per hostel and day', async () => {
    expect((await post('/hostel/roll-call', { hostelId: ids.stayHostel, date: today, records: [{ studentId: ids.s2, status: 'ABSENT', remarks: 'Not in the dormitory at 8 pm' }] })).status).toBeLessThan(300);
    await post('/health/visits', { memberType: 'STUDENT', memberId: ids.s2, campusId: ids.hns, complaint: 'Fever', temperature: 101.2, outcome: 'REST' }).then((r) => expect(r.status).toBe(201));
    const d = (await get(`/hostel-day/${ids.stayHostel}?date=${today}`, pHns)).body;
    expect(d).toMatchObject({ residents: 1, absent: 1, present: 0, notMarked: 0, rollCallTaken: true });
    expect(d.absentees[0]).toMatchObject({ studentId: ids.s2, remarks: 'Not in the dormitory at 8 pm' });
    expect(d.sick[0]).toMatchObject({ complaint: 'Fever', outcome: 'REST' });
    expect((await put(`/hostel-day/${ids.stayHostel}/remarks`, { date: shift(1), remarks: 'Tomorrow' }, pHns)).status).toBe(422);
    expect((await put(`/hostel-day/${ids.stayHostel}/remarks`, { date: today, remarks: 'Water tank cleaned; one child sent to rest with fever.' }, pHns)).status).toBe(200);
    expect((await put(`/hostel-day/${ids.stayHostel}/remarks`, { date: today, remarks: 'Water tank cleaned; Asha resting with fever, doctor visit tomorrow.' }, pHns)).status).toBe(200);
    expect((await get(`/hostel-day/${ids.stayHostel}?date=${today}`)).body.remarks).toMatch(/doctor visit tomorrow/);
    expect((await get(`/hostel-day/${ids.stayHostel}?date=${today}`, pKlg)).status).toBe(404);
    const db = ownerDb();
    expect(await db.hostelDailyNote.count({ where: { tenantId: ids.tenant } })).toBe(1);
    await db.$disconnect();
  });
});

describe('AC113 health check-up camps', () => {
  it('a camp sheet is checked, saved as check-ups once per child, and summarised', async () => {
    expect((await post('/health/camps', { campusId: ids.hns, campDate: today, title: 'RBSK' }, pKlg)).status).toBe(422);
    const c = (await post('/health/camps', { campusId: ids.hns, campDate: today, title: 'RBSK screening — term 1', conductedBy: 'PHC Hunsur' }, pHns)).body.id;
    const sheet = (await get(`/health/camps/${c}?sectionId=${ids['MH-Class 6']}`, pHns)).body;
    expect(sheet.summary).toMatchObject({ students: 1, screened: 0, notScreened: 1 });
    expect(sheet.sheet.map((x: { studentId: string }) => x.studentId)).toEqual([ids.s2]);
    expect((await put(`/health/camps/${c}/entries`, { entries: [{ studentId: ids.s2, haemoglobin: 40 }] }, pHns)).status).toBe(422);
    expect((await put(`/health/camps/${c}/entries`, { entries: [{ studentId: ids.s1, heightCm: 140 }] }, pHns)).status).toBe(422); // moved to Kollegal
    expect((await put(`/health/camps/${c}/entries`, { entries: [{ studentId: ids.s2, heightCm: 138, weightKg: 29, vision: '6/9', haemoglobin: 10.2, findings: 'Pale; low haemoglobin', referred: true }] }, pHns)).body.saved).toBe(1);
    expect((await put(`/health/camps/${c}/entries`, { entries: [{ studentId: ids.s2, heightCm: 138, weightKg: 29.5, vision: '6/9', haemoglobin: 10.4, findings: 'Pale; low haemoglobin', referred: true }] }, pHns)).body.saved).toBe(1);
    const after = (await get(`/health/camps/${c}?sectionId=${ids['MH-Class 6']}`, pHns)).body;
    expect(after.summary).toMatchObject({ screened: 1, referred: 1, notScreened: 0 });
    expect(after.sheet[0].entry).toMatchObject({ weightKg: 29.5, bmi: 15.5, referred: true });
    const db = ownerDb();
    expect(await db.healthCheckup.count({ where: { studentId: ids.s2, campId: c } })).toBe(1);
    await db.$disconnect();
    expect((await patch(`/health/camps/${c}`, { status: 'CLOSED' }, pHns)).body.status).toBe('CLOSED');
    expect((await put(`/health/camps/${c}/entries`, { entries: [{ studentId: ids.s2, heightCm: 139 }] }, pHns)).status).toBe(409);
    expect((await get('/health/camps', pKlg)).body).toEqual([]);
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get(`/allotments/${ids['MDRS26-3']}/sections`, other.session)).status).toBe(404);
    expect((await get('/allotments', other.session)).body.rows).toEqual([]);
    expect((await get(`/moves/students/${ids.s1}`, other.session)).status).toBe(404);
    expect((await get(`/hostel-day/${ids.hostel}?date=${today}`, other.session)).status).toBe(404);
  });
});
