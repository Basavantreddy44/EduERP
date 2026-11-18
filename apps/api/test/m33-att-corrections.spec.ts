/**
 * AC38 corrections & alerts (M3.3): a submitted mark changes only through a correction (reason,
 * approval when a rule exists, applied at once otherwise; history kept; one open correction per
 * mark; drafts are edited directly); the database still refuses direct edits; absent alerts go once
 * per student per day, only to the main contact, only for today, and can be switched off.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, isWeeklyOff } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let pu: string;
let secA: string;
let puSec: string;
let p1: string;
let p2: string;
let approver: Session;
let marker: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const workday = (n: number) => { let d = today; let k = -1; for (;;) { if (!isWeeklyOff(d, 'SUN')) k += 1; if (k === n) return d; d = shift(d, -1); } };
const sheet = async (sectionId: string, date: string, periodId?: string) => (await get(`/attendance/sheet?sectionId=${sectionId}&date=${date}${periodId ? `&periodId=${periodId}` : ''}`)).body;
const marks = (students: { id: string }[], absent: string[]) => students.map((x) => ({ studentId: x.id, status: absent.includes(x.id) ? 'ABSENT' : 'PRESENT' }));
const mails = async (to?: string) => {
  const db = ownerDb();
  const n = await db.notificationDelivery.count({ where: { tenantId: A.tenantId, channel: 'EMAIL', ...(to ? { recipient: to } : {}), notification: { eventCode: 'ATTENDANCE_ABSENT' } } });
  await db.$disconnect();
  return n;
};
const mark = async (studentId: string, date: string) => {
  const db = ownerDb();
  const r = await db.attendanceRecord.findFirst({ where: { studentId, attendanceDate: new Date(`${date}T00:00:00Z`) }, orderBy: { createdAt: 'desc' } });
  await db.$disconnect();
  return r;
};

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'CorrA');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  pu = (await post('/campuses', { code: 'PUC', name: 'PU College', campusType: 'PU' })).body.id;
  const year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  secA = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 })).body[0].id;
  const puc = (await post('/programs', { campusId: pu, name: 'PU Science', code: 'PCMB', programType: 'PU', levelLabel: 'PUC', durationLevels: 2 })).body;
  puSec = (await post('/sections', { academicYearId: year, programLevelId: puc.levels[0].id, names: ['A'], capacity: 60 })).body[0].id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  const rows: [string, string, string, string, string, string][] = [
    ['1', 'Asha', 'MAIN', 'SBS', sbs.levels[0].name, 'asha.parent@example.in'], ['2', 'Bala', 'MAIN', 'SBS', sbs.levels[0].name, 'bala.parent@example.in'],
    ['3', 'Chitra', 'MAIN', 'SBS', sbs.levels[0].name, ''], ['4', 'Dev', 'MAIN', 'SBS', sbs.levels[0].name, 'dev.parent@example.in'],
    ['5', 'Farid', 'PUC', 'PCMB', puc.levels[0].name, 'farid.parent@example.in'],
  ];
  for (const [n, f, campus, prog, cls, email] of rows) {
    const r: Record<string, string> = { admissionNo: `C/${n}`, firstName: f, lastName: 'Test', dob: '2018-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: campus, programCode: prog, className: cls, section: 'A', fatherName: `${f} Father`, parentPhone: `98700000${n.padStart(2, '0')}`, parentEmail: email, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  expect((await post(`/imports/jobs/${job.body.id}/commit`, {})).status).toBeLessThan(300);
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  await put('/settings/attendance.mode', { campusId: pu, value: 'PERIOD' });
  [p1, p2] = (await put('/attendance/periods', { campusId: pu, periods: [{ name: 'P1', startTime: '09:00', endTime: '09:50' }, { name: 'P2', startTime: '09:50', endTime: '10:40' }] })).body.map((p: { id: string }) => p.id);
  const approverRole = await createRole(A.tenantId, 'ATT_APPROVER', [PERMISSIONS.ATT_READ]);
  approver = (await addMember(app, A.session, { label: 'Approver', roleCode: 'ATT_APPROVER' })).session;
  await createRole(A.tenantId, 'MARKER', [PERMISSIONS.ATT_READ, PERMISSIONS.ATT_MARK]);
  marker = (await addMember(app, A.session, { label: 'Marker', roleCode: 'MARKER' })).session;
  (globalThis as { approverRole?: string }).approverRole = approverRole;
}, 180_000);
afterAll(() => app?.close());

describe('AC38 absent alerts', () => {
  it('on submit today: one email per absent student to the main contact; none without an email', async () => {
    const s = await sheet(secA, today === workday(0) ? today : workday(0));
    if (workday(0) !== today) return; // run on a working day only (alerts are for today)
    const r = await post('/attendance/sheet', { sectionId: secA, date: today, records: marks(s.students, [ids.Asha, ids.Chitra]) });
    expect(r.body.alerts).toEqual({ alerted: 1, noEmail: 1, alreadyTold: 0, skipped: null });
    expect(await mails('asha.parent@example.in')).toBe(1);
    expect((await mark(ids.Asha, today))!.parentNotified).toBe(true);
    expect((await mark(ids.Bala, today))!.parentNotified).toBe(false);
    expect((await sheet(secA, today)).students.find((x: { id: string }) => x.id === ids.Asha).parentNotified).toBe(true);
  });

  it('period-wise: absent in two periods is still one message that day', async () => {
    if (workday(0) !== today) return;
    const s1 = await sheet(puSec, today, p1);
    expect((await post('/attendance/sheet', { sectionId: puSec, date: today, periodId: p1, records: marks(s1.students, [ids.Farid]) })).body.alerts).toMatchObject({ alerted: 1 });
    expect((await post('/attendance/sheet', { sectionId: puSec, date: today, periodId: p2, records: marks(s1.students, [ids.Farid]) })).body.alerts).toMatchObject({ alerted: 0, alreadyTold: 1 });
    expect(await mails('farid.parent@example.in')).toBe(1);
  });

  it('an earlier day never messages parents; the setting can switch alerts off', async () => {
    const d = workday(1);
    const s = await sheet(secA, d);
    expect((await post('/attendance/sheet', { sectionId: secA, date: d, records: marks(s.students, [ids.Bala]) })).body.alerts).toMatchObject({ alerted: 0, skipped: 'not-today' });
    expect(await mails('bala.parent@example.in')).toBe(0);
    if (workday(0) !== today) return;
    // Switched off: a correction to Absent on today's sheet sends nothing…
    expect((await put('/settings/attendance.absent_alerts', { campusId: main, value: 'OFF' })).status).toBe(200);
    const todaySession = (await sheet(secA, today)).session.id;
    expect((await post('/attendance/corrections', { sessionId: todaySession, studentId: ids.Bala, newStatus: 'ABSENT', reason: 'Left after the first hour' })).body.status).toBe('APPROVED');
    expect(await mails('bala.parent@example.in')).toBe(0);
    // …switched on: the same for Dev reaches his parent.
    await put('/settings/attendance.absent_alerts', { campusId: main, value: 'ON' });
    expect((await post('/attendance/corrections', { sessionId: todaySession, studentId: ids.Dev, newStatus: 'ABSENT', reason: 'Left after the first hour' })).body.status).toBe('APPROVED');
    expect(await mails('dev.parent@example.in')).toBe(1);
  });
});

describe('AC38 corrections', () => {
  let session: string;
  const d = () => workday(1);

  it('drafts are changed directly; a correction needs a submitted sheet, a reason and a real change', async () => {
    const d3 = workday(3);
    const s = await sheet(secA, d3);
    const draft = await post('/attendance/sheet', { sectionId: secA, date: d3, records: marks(s.students, []), submit: false });
    const draftSession = draft.body.sessionId;
    expect((await post('/attendance/corrections', { sessionId: draftSession, studentId: ids.Asha, newStatus: 'ABSENT', reason: 'Wrongly marked' })).body.type).toBe('sheet-not-submitted');
    session = (await sheet(secA, d())).session.id;
    expect((await post('/attendance/corrections', { sessionId: session, studentId: ids.Bala, newStatus: 'ABSENT', reason: 'Wrongly marked' })).body.type).toBe('no-change');
    expect((await post('/attendance/corrections', { sessionId: session, studentId: ids.Bala, newStatus: 'PRESENT', reason: 'x' })).status).toBe(422);
    expect((await post('/attendance/corrections', { sessionId: session, studentId: ids.Bala, newStatus: 'PRESENT', reason: 'Came after assembly' }, marker)).status).toBe(403);
  });

  it('without an approval rule the correction applies at once, with history', async () => {
    const c = await post('/attendance/corrections', { sessionId: session, studentId: ids.Bala, newStatus: 'LATE', reason: 'Came after assembly, teacher missed it' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ status: 'APPROVED', oldStatus: 'ABSENT', newStatus: 'LATE', approvalRequestId: null });
    expect((await mark(ids.Bala, d()))!.status).toBe('LATE');
    const list = (await get(`/attendance/corrections?sessionId=${session}`)).body;
    expect(list.items[0]).toMatchObject({ status: 'APPROVED', reason: 'Came after assembly, teacher missed it', requestedByName: expect.any(String), decidedByName: expect.any(String) });
    const db = ownerDb();
    const audit = await db.auditLog.findFirst({ where: { tenantId: A.tenantId, entityType: 'ATTENDANCE', entityId: session, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    await db.$disconnect();
    expect(audit).toMatchObject({ oldValues: { status: 'ABSENT' }, newValues: { status: 'LATE' } });
  });

  it('with a rule it waits for the approver; one open correction per mark; approve and reject', async () => {
    expect((await post('/approvals/rules', { entityType: 'ATTENDANCE_CORRECTION', levelNo: 1, approverRoleId: (globalThis as { approverRole?: string }).approverRole })).status).toBe(201);
    const c = await post('/attendance/corrections', { sessionId: session, studentId: ids.Chitra, newStatus: 'ABSENT', reason: 'Was at the doctor, parent called' });
    expect(c.body).toMatchObject({ status: 'PENDING', approvalRequestId: expect.any(String) });
    expect((await mark(ids.Chitra, d()))!.status).toBe('PRESENT');
    expect((await sheet(secA, d())).students.find((x: { id: string }) => x.id === ids.Chitra).pendingCorrection).toMatchObject({ newStatus: 'ABSENT' });
    expect((await post('/attendance/corrections', { sessionId: session, studentId: ids.Chitra, newStatus: 'LEAVE', reason: 'Second try' })).body.type).toBe('correction-pending');
    const inbox = (await get('/approvals/inbox', approver)).body;
    const req = (inbox.items ?? inbox).find((x: { entityId: string }) => x.entityId === c.body.id);
    expect(req.summary).toMatch(/Chitra Test · .* · \d{1,2} [A-Z][a-z]{2} \d{4}: Present → Absent/);
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, approver)).status).toBe(201);
    expect((await mark(ids.Chitra, d()))!.status).toBe('ABSENT');
    expect(await mails()).toBe(workday(0) === today ? 3 : 0); // Asha, Farid, Dev — an earlier day's correction sends nothing

    const r = await post('/attendance/corrections', { sessionId: session, studentId: ids.Asha, newStatus: 'ABSENT', reason: 'Left at lunch' });
    const req2 = ((await get('/approvals/inbox', approver)).body.items ?? (await get('/approvals/inbox', approver)).body).find((x: { entityId: string }) => x.entityId === r.body.id);
    expect((await post(`/approvals/requests/${req2.id}/act`, { action: 'REJECT', remarks: 'Was present after lunch' }, approver)).status).toBe(201);
    expect((await mark(ids.Asha, d()))!.status).toBe('PRESENT');
    const rejected = (await get('/attendance/corrections?status=REJECTED')).body.items[0];
    expect(rejected).toMatchObject({ newStatus: 'ABSENT', decisionRemarks: 'Was present after lunch' });
  });

  it('the database still refuses direct edits, but allows recording that the parent was told', async () => {
    const rec = await mark(ids.Dev, d());
    const db = appDb();
    await expect(db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A.tenantId}', true)`),
      db.$executeRawUnsafe(`UPDATE attendance_records SET status = 'ABSENT' WHERE id = '${rec!.id}'`),
    ])).rejects.toThrow(/submitted/);
    const ok = await db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A.tenantId}', true)`),
      db.$executeRawUnsafe(`UPDATE attendance_records SET parent_notified = true WHERE id = '${rec!.id}'`),
    ]);
    await db.$disconnect();
    expect(ok[1]).toBe(1);
  });
});
