/**
 * AC91–AC94 Labs, and Sports & activities (Phase 18): labs and equipment with unique asset tags and the
 * calibration due list; practical sessions that never overlap in a lab (also booked at the same moment);
 * breakages billed to fees once — after approval where a rule exists — or waived with a reason;
 * activities with members once per year, shown on the profile and to the child's own parent; competitions
 * with one entry per student and category; achievements verified before they reach the profile, the
 * parents and the news feed; isolation.
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
let labMgr: Session;
let ravi: Session;
let sunita: Session;
let coach: Session;
let parent: Session;
let otherParent: Session;
const ids: Record<string, string> = {};
const tag = Date.now().toString(36);
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const del = (path: string, s: Session = A.session) => http().delete(`${API}${path}`).set(auth(s));
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const parentOf = async (student: string, email: string) => {
  const g = (await get(`/students/${student}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  await post(`/students/${student}/portal/guardians/${g}`, { email });
  await setPassword(email, 'Parent@Test123');
  const s = await login(app, email, 'Parent@Test123');
  return s.tenantId ? s : switchTenant(app, s, A.tenantId);
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'ActA');
  B = await createTenant(app, platform, 'ActB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  ids.year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  const s0 = (await post('/sections', { academicYearId: ids.year, programLevelId: sbs.levels[0].id, names: ['A', 'B'], capacity: 40 })).body;
  const l0 = Array.isArray(s0) ? s0 : s0.items ?? s0.sections;
  ids.secA = l0.find((s: { name: string }) => s.name === 'A').id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, sec] of [['1', 'Asha', 'A'], ['2', 'Bala', 'B'], ['3', 'Chitra', 'B']] as const) {
    const r: Record<string, string> = { admissionNo: `AC/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: n === '2' ? 'Boy' : 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: sec, fatherName: `${f} Father`, parentPhone: `98555000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const [k, first] of [['ravi', 'Ravi'], ['sunita', 'Sunita'], ['coachE', 'Kiran']] as const) ids[k] = (await post('/staff', { campusId: main, firstName: first, gender: 'FEMALE', employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  ids.subject = (await post('/academics/subjects', { name: 'Chemistry', code: 'CHE', subjectType: 'THEORY_PRACTICAL' })).body.id ?? null;
  await createRole(A.tenantId, 'LABM_R', [PERMISSIONS.LAB_READ, PERMISSIONS.LAB_MANAGE, PERMISSIONS.LAB_SESSION]);
  await createRole(A.tenantId, 'TEACH_R', [PERMISSIONS.LAB_READ, PERMISSIONS.LAB_SESSION, PERMISSIONS.ACT_READ, PERMISSIONS.ACH_ADD]);
  await createRole(A.tenantId, 'COACH_R', [PERMISSIONS.ACT_READ, PERMISSIONS.ACT_MANAGE, PERMISSIONS.ACH_ADD]);
  labMgr = (await addMember(app, A.session, { label: 'LabM', roleCode: 'LABM_R', campusId: main })).session;
  const r = await addMember(app, A.session, { label: 'RaviT', roleCode: 'TEACH_R', campusId: main });
  ravi = r.session;
  await post(`/staff/${ids.ravi}/user`, { userId: r.userId });
  const s = await addMember(app, A.session, { label: 'SunitaT', roleCode: 'TEACH_R', campusId: main });
  sunita = s.session;
  await post(`/staff/${ids.sunita}/user`, { userId: s.userId });
  coach = (await addMember(app, A.session, { label: 'Coach', roleCode: 'COACH_R', campusId: main })).session;
  await post('/fees/heads', { name: 'Fines', code: 'FINE', feeType: 'FINE' });
  parent = await parentOf(ids.Asha, `act.parent.${tag}@test.local`);
  otherParent = await parentOf(ids.Bala, `act.other.${tag}@test.local`);
}, 180_000);
afterAll(() => app?.close());

describe('AC91 labs & equipment', () => {
  it('labs per campus; asset tags unique per institution; calibration due list; campus scope', async () => {
    const lab = await post('/labs', { campusId: main, name: 'Chemistry Lab', inchargeEmployeeId: ids.ravi, capacity: 30 }, labMgr);
    expect(lab.status).toBe(201);
    ids.lab = lab.body.id;
    expect((await post('/labs', { campusId: main, name: 'chemistry lab' }, labMgr)).status).toBe(409);
    expect((await post('/labs', { campusId: north, name: 'North Lab' }, labMgr)).status).toBe(404);
    ids.labB = (await post('/labs', { campusId: main, name: 'Physics Lab' }, labMgr)).body.id;
    const bal = await post('/labs/equipment', { labId: ids.lab, name: 'Digital balance', assetTag: 'chem-bal-01', quantity: 2, lastCalibrationDate: shift(-350), nextCalibrationDate: shift(10) }, labMgr);
    expect(bal.status).toBe(201);
    ids.balance = bal.body.id;
    ids.burette = (await post('/labs/equipment', { labId: ids.lab, name: 'Burette 50 ml', assetTag: 'CHEM-BUR-01', quantity: 12 }, labMgr)).body.id;
    await post('/labs/equipment', { labId: ids.labB, name: 'Vernier caliper', assetTag: 'PHY-VER-01', quantity: 10, nextCalibrationDate: shift(-3) }, labMgr);
    expect((await post('/labs/equipment', { labId: ids.labB, name: 'Same tag', assetTag: 'CHEM-BAL-01' }, labMgr)).status).toBe(409);
    expect((await post('/labs/equipment', { labId: ids.lab, name: 'Bad dates', assetTag: 'X-1', lastCalibrationDate: shift(5), nextCalibrationDate: shift(1) }, labMgr)).status).toBe(422);
    expect((await post('/labs/equipment', { labId: ids.lab, name: 'Teacher cannot', assetTag: 'X-2' }, ravi)).status).toBe(403);
    const due = (await get('/labs/equipment?due=true', labMgr)).body;
    expect(due.map((d: { assetTag: string; calibration: string }) => `${d.assetTag}:${d.calibration}`)).toEqual(['PHY-VER-01:OVERDUE', 'CHEM-BAL-01:DUE']);
    const list = (await get('/labs', ravi)).body;
    expect(list.find((l: { id: string }) => l.id === ids.lab)).toMatchObject({ incharge: 'Ravi', equipment: 2, calibrationDue: 1, can: { manage: false, session: true } });
  });
});

describe('AC92 practical sessions & breakages', () => {
  it('sessions never overlap in one lab, also when booked at the same moment; only the teacher or a manager completes', async () => {
    const day = shift(1);
    const s1 = await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, subjectId: ids.subject, batchName: 'Batch A', sessionDate: day, startTime: '10:00', endTime: '11:00', experimentTitle: 'Titration of HCl with NaOH' }, ravi);
    expect(s1.status).toBe(201);
    ids.s1 = s1.body.id;
    const clash = await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, sessionDate: day, startTime: '10:30', endTime: '11:30', experimentTitle: 'Another' }, sunita);
    expect(clash.status).toBe(409);
    expect(clash.body.detail).toMatch(/10:00–11:00/);
    expect((await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, sessionDate: day, startTime: '11:00', endTime: '12:00', experimentTitle: 'Back to back is fine' }, sunita)).status).toBe(201);
    expect((await post('/labs/sessions', { labId: ids.labB, sectionId: ids.secA, sessionDate: day, startTime: '10:00', endTime: '11:00', experimentTitle: 'Other lab is free' }, sunita)).status).toBe(201);
    // Two bookings of the same slot at the same moment: exactly one wins.
    const both = await Promise.all([ravi, sunita].map((s) => post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, sessionDate: shift(2), startTime: '09:00', endTime: '10:00', experimentTitle: 'Race' }, s)));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, sessionDate: shift(-1), startTime: '09:00', endTime: '10:00', experimentTitle: 'Past' }, ravi)).status).toBe(422);
    expect((await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, employeeId: ids.sunita, sessionDate: shift(3), startTime: '09:00', endTime: '10:00', experimentTitle: 'For someone else' }, ravi)).status).toBe(422);
    expect((await post(`/labs/sessions/${ids.s1}/status`, { status: 'CANCELLED' }, sunita)).status).toBe(404);
    expect((await post(`/labs/sessions/${ids.s1}/status`, { status: 'COMPLETED', studentsPresent: 28 }, ravi)).status).toBe(409); // tomorrow's session
    expect((await post(`/labs/sessions/${ids.s1}/status`, { status: 'CANCELLED', remarks: 'Exam rescheduled' }, ravi)).status).toBe(200);
    expect((await post('/labs/sessions', { labId: ids.lab, sectionId: ids.secA, sessionDate: day, startTime: '10:00', endTime: '11:00', experimentTitle: 'Slot freed by the cancellation' }, sunita)).status).toBe(201);
    const mine = (await get(`/labs/sessions?mine=true&from=${today}&to=${shift(5)}`, ravi)).body.rows;
    expect(mine.every((r: { teacher: string }) => r.teacher === 'Ravi')).toBe(true);
    const db = ownerDb();
    await expect(db.$executeRawUnsafe(`UPDATE lab_sessions SET end_time = '09:00' WHERE id = '${ids.s1}'`)).rejects.toThrow();
    await db.$disconnect();
  });

  it('breakages billed once to the student, after approval where a rule exists, or waived with a reason; equipment marked', async () => {
    const b1 = await post('/labs/breakages', { labId: ids.lab, equipmentId: ids.burette, itemDescription: 'Burette broken', studentId: ids.Asha, breakageDate: today, quantity: 1, chargeAmount: 350, markDamaged: true }, ravi);
    expect(b1.status).toBe(201);
    expect(b1.body.status).toBe('REPORTED');
    const db = ownerDb();
    expect((await db.labEquipment.findUniqueOrThrow({ where: { id: ids.burette } })).quantity).toBe(11);
    expect((await post('/labs/breakages', { labId: ids.lab, itemDescription: 'Amount but no student', breakageDate: today, chargeAmount: 50 }, ravi)).status).toBe(422);
    expect((await post(`/labs/breakages/${b1.body.id}/decide`, { action: 'CHARGE' }, ravi)).status).toBe(403);
    const charged = await post(`/labs/breakages/${b1.body.id}/decide`, { action: 'CHARGE' }, labMgr);
    expect(charged.body.status).toBe('CHARGED');
    expect((await post(`/labs/breakages/${b1.body.id}/decide`, { action: 'CHARGE' }, labMgr)).status).toBe(409);
    const row = await db.labBreakage.findUniqueOrThrow({ where: { id: b1.body.id } });
    const inv = await db.feeInvoice.findUniqueOrThrow({ where: { id: row.feeInvoiceId! } });
    expect([inv.studentId, Number(inv.netAmount)]).toEqual([ids.Asha, 350]);
    await expect(db.$executeRawUnsafe(`UPDATE lab_breakages SET fee_invoice_id = NULL WHERE id = '${b1.body.id}'`)).rejects.toThrow();
    // With a rule: waits for approval, then billed.
    const adminRole = await db.role.findFirstOrThrow({ where: { tenantId: A.tenantId, code: 'INSTITUTION_ADMIN' } });
    expect((await post('/approvals/rules', { entityType: 'LAB_BREAKAGE', levelNo: 1, approverRoleId: adminRole.id })).status).toBe(201);
    const b2 = await post('/labs/breakages', { labId: ids.lab, itemDescription: 'Beaker 250 ml', studentId: ids.Bala, breakageDate: today, chargeAmount: 120 }, ravi);
    expect((await post(`/labs/breakages/${b2.body.id}/decide`, { action: 'CHARGE' }, labMgr)).body.status).toBe('PENDING_APPROVAL');
    const req = (await get('/approvals/inbox')).body.find((x: { entityType: string }) => x.entityType === 'LAB_BREAKAGE');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' })).status).toBeLessThan(300);
    expect((await db.labBreakage.findUniqueOrThrow({ where: { id: b2.body.id } })).status).toBe('CHARGED');
    // Waived needs a reason.
    const b3 = await post('/labs/breakages', { labId: ids.lab, itemDescription: 'Test tube', studentId: ids.Chitra, breakageDate: today, chargeAmount: 20 }, ravi);
    expect((await post(`/labs/breakages/${b3.body.id}/decide`, { action: 'WAIVE' }, labMgr)).status).toBe(422);
    expect((await post(`/labs/breakages/${b3.body.id}/decide`, { action: 'WAIVE', reason: 'First time, very small' }, labMgr)).body.status).toBe('WAIVED');
    const list = (await get('/labs/breakages', labMgr)).body;
    expect(list.map((b: { status: string }) => b.status).sort()).toEqual(['CHARGED', 'CHARGED', 'WAIVED']);
    await db.$disconnect();
  });
});

describe('AC93 activities & members', () => {
  it('a student is a member once per year; the profile and the own parent see it; other parents do not', async () => {
    expect((await post('/activities', { campusId: main, name: 'Cricket', activityType: 'SPORT', coordinatorEmployeeId: ids.coachE }, ravi)).status).toBe(403);
    const cricket = await post('/activities', { campusId: main, name: 'Cricket', activityType: 'SPORT', coordinatorEmployeeId: ids.coachE }, coach);
    expect(cricket.status).toBe(201);
    ids.cricket = cricket.body.id;
    ids.nss = (await post('/activities', { campusId: main, name: 'NSS', activityType: 'CLUB' }, coach)).body.id;
    expect((await post('/activities', { campusId: main, name: 'cricket', activityType: 'SPORT' }, coach)).status).toBe(409);
    const add = await post(`/activities/${ids.cricket}/members`, { studentIds: [ids.Asha, ids.Bala], teamName: 'U-14', memberRole: 'MEMBER' }, coach);
    expect(add.body).toEqual({ added: 2, already: 0 });
    expect((await post(`/activities/${ids.cricket}/members`, { studentIds: [ids.Asha, ids.Chitra] }, coach)).body).toEqual({ added: 1, already: 1 });
    const det = (await get(`/activities/${ids.cricket}`, ravi)).body;
    expect(det.members).toHaveLength(3);
    const asha = det.members.find((m: { studentId: string }) => m.studentId === ids.Asha);
    expect((await put(`/activities/members/${asha.id}`, { teamName: 'U-14', memberRole: 'CAPTAIN' }, coach)).status).toBe(200);
    const chitra = det.members.find((m: { studentId: string }) => m.studentId === ids.Chitra);
    expect((await del(`/activities/members/${chitra.id}`, coach)).status).toBe(200);
    const db = ownerDb();
    await expect(db.activityMember.create({ data: { tenantId: A.tenantId, activityId: ids.cricket, studentId: ids.Asha, academicYearId: ids.year } })).rejects.toThrow();
    await db.$disconnect();
    const prof = (await get(`/activities/students/${ids.Asha}`)).body;
    expect(prof.activities).toEqual([expect.objectContaining({ name: 'Cricket', memberRole: 'CAPTAIN', teamName: 'U-14' })]);
    expect((await get(`/activities/children/${ids.Asha}`, parent)).body.activities).toHaveLength(1);
    expect((await get(`/activities/children/${ids.Asha}`, otherParent)).status).toBe(404);
  });
});

describe('AC94 competitions & achievements', () => {
  it('one entry per student and category; achievements from results are verified, told to parents, posted to the feed; manual ones wait for a coordinator', async () => {
    const comp = await post('/activities/competitions', { activityId: ids.cricket, name: 'Inter-school cricket cup', level: 'DISTRICT', venue: 'Chinnaswamy nets', startDate: shift(-5), endDate: shift(-4), addToCalendar: true }, coach);
    expect(comp.status).toBe(201);
    expect(comp.body.eventId).toBeTruthy();
    ids.comp = comp.body.id;
    expect((await post('/activities/competitions', { activityId: ids.cricket, name: 'Bad', level: 'STATE', startDate: shift(2), endDate: shift(1) }, coach)).status).toBe(422);
    expect((await post(`/activities/competitions/${ids.comp}/participants`, { studentIds: [ids.Asha, ids.Bala], category: 'Batting' }, coach)).body).toEqual({ added: 2, already: 0 });
    expect((await post(`/activities/competitions/${ids.comp}/participants`, { studentIds: [ids.Asha], category: 'Batting' }, coach)).body).toEqual({ added: 0, already: 1 });
    expect((await post(`/activities/competitions/${ids.comp}/participants`, { studentIds: [ids.Asha], category: 'Bowling' }, coach)).body).toEqual({ added: 1, already: 0 });
    const c = (await get(`/activities/competitions/${ids.comp}`, coach)).body;
    const ashaBat = c.participants.find((p: { studentId: string; category: string }) => p.studentId === ids.Asha && p.category === 'Batting');
    expect((await post(`/activities/participants/${ashaBat.id}/achievement`, { postToFeed: true }, coach)).status).toBe(409); // no result yet
    expect((await put(`/activities/participants/${ashaBat.id}`, { result: 'WINNER' }, coach)).status).toBe(200);
    const ach = await post(`/activities/participants/${ashaBat.id}/achievement`, { postToFeed: true }, coach);
    expect(ach.status).toBe(201);
    expect(ach.body.title).toBe('Winner — Batting, Inter-school cricket cup');
    expect((await post(`/activities/participants/${ashaBat.id}/achievement`, { postToFeed: false }, coach)).status).toBe(409);
    expect((await put(`/activities/participants/${ashaBat.id}`, { result: 'THIRD' }, coach)).status).toBe(409); // a verified achievement rests on it
    expect((await del(`/activities/participants/${ashaBat.id}`, coach)).status).toBe(409);
    const db = ownerDb();
    const row = await db.achievement.findUniqueOrThrow({ where: { id: ach.body.id } });
    expect(row).toMatchObject({ isVerified: true, category: 'SPORTS', level: 'DISTRICT' });
    const post_ = await db.feedPost.findUniqueOrThrow({ where: { id: row.feedPostId! } });
    expect(post_.postType).toBe('ACHIEVEMENT');
    const notice = await db.notification.findFirst({ where: { tenantId: A.tenantId, entityType: 'ACHIEVEMENT', entityId: row.id } });
    expect(notice).toBeTruthy();
    await expect(db.achievement.create({ data: { tenantId: A.tenantId, campusId: main, studentId: ids.Asha, employeeId: ids.ravi, title: 'Both', category: 'OTHER', level: 'INTRA', achievementDate: new Date() } })).rejects.toThrow();
    // A teacher records one: it waits; the profile shows only verified achievements.
    const manual = await post('/activities/achievements', { studentId: ids.Bala, title: 'First in the state science quiz', category: 'ACADEMIC', level: 'STATE', achievementDate: shift(-10) }, ravi);
    expect(manual.body.isVerified).toBe(false);
    expect((await get(`/activities/students/${ids.Bala}`)).body.achievements).toHaveLength(0);
    expect((await post(`/activities/achievements/${manual.body.id}/verify`, { postToFeed: false }, ravi)).status).toBe(403);
    expect((await post(`/activities/achievements/${manual.body.id}/verify`, { postToFeed: false }, coach)).status).toBe(200);
    expect((await get(`/activities/students/${ids.Bala}`)).body.achievements).toHaveLength(1);
    expect((await del(`/activities/achievements/${manual.body.id}`, ravi)).status).toBe(409);
    const wrong = await post('/activities/achievements', { studentId: ids.Chitra, title: 'Entered by mistake', category: 'OTHER', level: 'INTRA', achievementDate: today }, ravi);
    expect((await del(`/activities/achievements/${wrong.body.id}`, ravi)).status).toBe(200);
    const staffAward = await post('/activities/achievements', { employeeId: ids.coachE, title: 'Best coach award', category: 'SPORTS', level: 'DISTRICT', achievementDate: today }, coach);
    expect(staffAward.body.isVerified).toBe(true);
    const kid = (await get(`/activities/children/${ids.Asha}`, parent)).body;
    expect(kid.achievements.map((a: { title: string }) => a.title)).toEqual(['Winner — Batting, Inter-school cricket cup']);
    expect(kid.competitions).toHaveLength(2);
    const rep = (await get('/activities/report', coach)).body;
    expect(rep.rows[0]).toMatchObject({ activity: 'Cricket', competitions: 1, entries: 3, students: 2, gold: 1 });
    expect(rep.totals.achievements).toBe(3);
    await db.$disconnect();
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get('/labs', B.session)).body).toEqual([]);
    expect((await get('/activities', B.session)).body).toEqual([]);
    expect((await get(`/activities/${ids.cricket}`, B.session)).status).toBe(404);
    expect((await get(`/activities/students/${ids.Asha}`, B.session)).status).toBe(404);
    expect((await post(`/labs/breakages`, { labId: ids.lab, itemDescription: 'Beaker', breakageDate: today }, B.session)).status).toBe(404);
    expect((await get('/activities/achievements', B.session)).body).toEqual([]);
  });
});
