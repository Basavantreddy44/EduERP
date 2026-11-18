/**
 * AC37 attendance (M3.2): one sheet per section, day and period; one mark per student; only the
 * students placed in the section that day (not those on a long break); no attendance on future dates,
 * weekly holidays or listed holidays; draft → submit; a submitted sheet is locked (also in the
 * database); daily vs period-wise per campus; the whole sheet in one request (60 students);
 * simultaneous submits make one sheet; day overview; permissions, campus scope and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS, isWeeklyOff } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let pu: string;
let secA: string;
let secB: string;
let big: string;
let puSec: string;
let reader: Session;
let puMarker: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The n-th working day (Sunday off) on or before today. */
const workday = (n: number) => {
  let d = today;
  let k = -1;
  for (;;) {
    if (!isWeeklyOff(d, 'SUN')) k += 1;
    if (k === n) return d;
    d = shift(d, -1);
  }
};
const lastSunday = () => { let d = today; while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = shift(d, -1); return d; };
const sheet = async (sectionId: string, date: string, periodId?: string, s: Session = A.session) => (await get(`/attendance/sheet?sectionId=${sectionId}&date=${date}${periodId ? `&periodId=${periodId}` : ''}`, s)).body;
const allPresent = (students: { id: string }[], absent: string[] = []) => students.map((x) => ({ studentId: x.id, status: absent.includes(x.id) ? 'ABSENT' : 'PRESENT' }));

async function importStudents(rows: [string, string, string, string, string][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, campus, prog, cls, sec] of rows.map((r) => [...r.slice(0, 4), r[4].split('|')[0], r[4].split('|')[1]])) {
    const r: Record<string, string> = { admissionNo: `T/${n}`, firstName: f, lastName: 'Test', dob: '2018-01-01', gender: 'Girl', admissionDate: '2026-06-01', campusCode: campus, programCode: prog, className: cls, section: sec, fatherName: 'Parent', parentPhone: `9${String(800000000 + Number(n)).padStart(9, '0')}`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  const c = await post(`/imports/jobs/${job.body.id}/commit`, {});
  expect(c.status).toBeLessThan(300);
}

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'AttA');
  B = await createTenant(app, platform, 'AttB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  pu = (await post('/campuses', { code: 'PUC', name: 'PU College', campusType: 'PU' })).body.id;
  const year = (await post('/academic-years', { name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  [secA, secB] = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A', 'B'], capacity: 40 })).body.map((s: { id: string }) => s.id);
  big = (await post('/sections', { academicYearId: year, programLevelId: sbs.levels[1].id, names: ['A'], capacity: 70 })).body[0].id;
  const puc = (await post('/programs', { campusId: pu, name: 'PU Science', code: 'PCMB', programType: 'PU', levelLabel: 'PUC', durationLevels: 2 })).body;
  puSec = (await post('/sections', { academicYearId: year, programLevelId: puc.levels[0].id, names: ['A'], capacity: 60 })).body[0].id;
  const level1 = sbs.levels[0].name;
  const level2 = sbs.levels[1].name;
  const puLevel = puc.levels[0].name;
  const rows: [string, string, string, string, string][] = [
    ['1', 'Asha', 'MAIN', 'SBS', `${level1}|A`], ['2', 'Bala', 'MAIN', 'SBS', `${level1}|A`], ['3', 'Chitra', 'MAIN', 'SBS', `${level1}|A`], ['4', 'Dev', 'MAIN', 'SBS', `${level1}|A`],
    ['5', 'Esha', 'MAIN', 'SBS', `${level1}|B`], ['6', 'Farid', 'PUC', 'PCMB', `${puLevel}|A`], ['7', 'Gauri', 'PUC', 'PCMB', `${puLevel}|A`],
  ];
  for (let i = 0; i < 60; i++) rows.push([String(100 + i), `Kid${i}`, 'MAIN', 'SBS', `${level2}|A`]);
  await importStudents(rows);
  for (const s of (await get('/students?pageSize=100&q=Test')).body.items) ids[s.firstName] = s.id;
  await createRole(A.tenantId, 'ATT_VIEW', [PERMISSIONS.ATT_READ]);
  reader = (await addMember(app, A.session, { label: 'Reader', roleCode: 'ATT_VIEW' })).session;
  await createRole(A.tenantId, 'PU_TEACHER', [PERMISSIONS.ATT_READ, PERMISSIONS.ATT_MARK]);
  puMarker = (await addMember(app, A.session, { label: 'PuTeacher', roleCode: 'PU_TEACHER', campusId: pu })).session;
}, 180_000);
afterAll(() => app?.close());

describe('AC37 daily attendance', () => {
  it('the sheet lists the section in roll order, nothing marked yet', async () => {
    const s = await sheet(secA, workday(0));
    expect(s).toMatchObject({ mode: 'DAILY', closed: null, session: null, canMark: true, period: null });
    expect(s.students.map((x: { firstName: string; status: string | null }) => `${x.firstName}:${x.status}`)).toEqual(['Asha:null', 'Bala:null', 'Chitra:null', 'Dev:null']);
  });

  it('draft, then submit; a submitted sheet is locked', async () => {
    const d = workday(0);
    const s = await sheet(secA, d);
    const draft = await post('/attendance/sheet', { sectionId: secA, date: d, records: allPresent(s.students, [ids.Bala]), submit: false });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ status: 'DRAFT', counts: { PRESENT: 3, ABSENT: 1 } });
    const again = await sheet(secA, d);
    expect(again.session.status).toBe('DRAFT');
    expect(again.students.find((x: { id: string }) => x.id === ids.Bala).status).toBe('ABSENT');
    const recs = allPresent(s.students, [ids.Bala, ids.Dev]).map((r) => (r.studentId === ids.Chitra ? { ...r, status: 'LATE', remarks: 'Bus late' } : r));
    const sub = await post('/attendance/sheet', { sectionId: secA, date: d, records: recs, submit: true });
    expect(sub.body).toMatchObject({ status: 'SUBMITTED', counts: { PRESENT: 1, ABSENT: 2, LATE: 1 }, total: 4 });
    const locked = await post('/attendance/sheet', { sectionId: secA, date: d, records: allPresent(s.students), submit: true });
    expect(locked.status).toBe(409);
    expect(locked.body.type).toBe('attendance-locked');
    const after = await sheet(secA, d);
    expect(after).toMatchObject({ canMark: false, session: { status: 'SUBMITTED' } });
    expect(after.students.find((x: { id: string }) => x.id === ids.Chitra)).toMatchObject({ status: 'LATE', remarks: 'Bus late' });
    // The database refuses too.
    const db = appDb();
    await expect(db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A.tenantId}', true)`),
      db.$executeRawUnsafe(`UPDATE attendance_records SET status = 'PRESENT' WHERE student_id = '${ids.Bala}'`),
    ])).rejects.toThrow(/submitted/);
    await expect(db.$executeRawUnsafe(`DELETE FROM attendance_records`)).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });

  it('every student exactly once', async () => {
    const d = workday(1);
    const s = await sheet(secA, d);
    const missing = await post('/attendance/sheet', { sectionId: secA, date: d, records: allPresent(s.students.slice(1)) });
    expect(missing.status).toBe(422);
    expect(missing.body.type).toBe('roster-changed');
    expect(missing.body.errors[0].message).toMatch(/Asha/);
    const stranger = await post('/attendance/sheet', { sectionId: secA, date: d, records: [...allPresent(s.students), { studentId: ids.Esha, status: 'PRESENT' }] });
    expect(stranger.body.type).toBe('roster-changed');
    const twice = await post('/attendance/sheet', { sectionId: secA, date: d, records: [...allPresent(s.students), { studentId: ids.Asha, status: 'ABSENT' }] });
    expect(twice.status).toBe(422);
  });

  it('no attendance on future dates, weekly holidays or listed holidays', async () => {
    const s = await sheet(secA, workday(1));
    const try_ = async (date: string) => (await post('/attendance/sheet', { sectionId: secA, date, records: allPresent(s.students) })).body.type;
    expect(await try_(shift(today, 1))).toBe('date-in-future');
    expect(await try_(lastSunday())).toBe('weekly-off');
    expect((await sheet(secA, lastSunday())).closed).toMatchObject({ code: 'weekly-off' });
    const hol = workday(2);
    expect((await post('/holidays', { holidayDate: hol, name: 'Local festival', holidayType: 'INSTITUTION' })).status).toBe(201);
    expect(await try_(hol)).toBe('holiday');
    expect(await try_('2026-05-20')).toBe('outside-year');
    // Second and fourth Saturdays off when the campus says so.
    expect((await put('/settings/attendance.weekly_off', { campusId: main, value: 'SUN_2ND_4TH_SAT' })).status).toBe(200);
    expect(await try_('2026-11-14')).toBe('weekly-off'); // 2nd Saturday of November 2026
    expect(await try_('2026-11-07')).not.toBe('weekly-off'); // 1st Saturday
    // Back to Sundays only, so the later tests' working days (counted with Sundays off) are open.
    expect((await put('/settings/attendance.weekly_off', { campusId: main, value: 'SUN' })).status).toBe(200);
  });

  it('a student who moved section today is on the new section’s sheet from today', async () => {
    const d = workday(0);
    const moved = await post(`/students/${ids.Dev}/section`, { sectionId: secB, effectiveDate: d, reason: 'Parents asked for B section' });
    expect(moved.status).toBeLessThan(300);
    expect((await sheet(secB, d)).students.map((x: { firstName: string }) => x.firstName)).toEqual(['Esha', 'Dev']); // no roll number in the new section yet → listed last
    expect((await sheet(secA, workday(1))).students.map((x: { firstName: string }) => x.firstName)).toContain('Dev');
  });

  it('the whole sheet of 60 students is one request', async () => {
    const d = workday(0);
    const s = await sheet(big, d);
    expect(s.students).toHaveLength(60);
    const t0 = Date.now();
    const r = await post('/attendance/sheet', { sectionId: big, date: d, records: allPresent(s.students, s.students.slice(0, 5).map((x: { id: string }) => x.id)) });
    const ms = Date.now() - t0;
    expect(r.body).toMatchObject({ status: 'SUBMITTED', total: 60, counts: { PRESENT: 55, ABSENT: 5 } });
    console.log(`60-student sheet saved in ${ms} ms`);
  });

  it('two teachers submitting at the same moment make one sheet', async () => {
    const d = workday(3);
    const s = await sheet(secB, d);
    const [a, b] = await Promise.all([
      post('/attendance/sheet', { sectionId: secB, date: d, records: allPresent(s.students) }),
      post('/attendance/sheet', { sectionId: secB, date: d, records: allPresent(s.students, [s.students[0].id]) }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const db = appDb();
    const n = await db.$transaction([
      db.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${A.tenantId}', true)`),
      db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM attendance_sessions WHERE section_id = '${secB}' AND attendance_date = '${d}'`),
    ]);
    await db.$disconnect();
    expect((n[1] as { n: number }[])[0].n).toBe(1);
  });

  it('day overview: which sections are done, with counts', async () => {
    const o = (await get(`/attendance/day?date=${workday(0)}&campusId=${main}`)).body;
    const row = (id: string) => o.sections.find((x: { sectionId: string }) => x.sectionId === id);
    expect(row(secA)).toMatchObject({ status: 'SUBMITTED', students: 3, present: 1, absent: 2 }); // Dev moved out today (his mark here was taken before he moved)
    expect(row(big)).toMatchObject({ status: 'SUBMITTED', students: 60, present: 55, absent: 5 });
    expect(row(secB)).toMatchObject({ status: null, students: 2 });
    expect(o.totals).toMatchObject({ sections: 3, submitted: 2, notTaken: 1 });
  });
});

describe('AC37 period-wise attendance', () => {
  let p1: string;
  let p2: string;
  let lunch: string;

  it('bell timings are saved per campus and keep their ids when edited', async () => {
    const bad = await put('/attendance/periods', { campusId: pu, periods: [{ name: 'P1', startTime: '09:00', endTime: '09:50' }, { name: 'P2', startTime: '09:40', endTime: '10:30' }] });
    expect(bad.status).toBe(422);
    const r = await put('/attendance/periods', { campusId: pu, periods: [
      { name: 'P1', startTime: '09:00', endTime: '09:50' }, { name: 'P2', startTime: '09:50', endTime: '10:40' }, { name: 'Lunch', startTime: '12:30', endTime: '13:10', isBreak: true },
    ] });
    expect(r.status).toBe(200);
    [p1, p2, lunch] = r.body.map((p: { id: string }) => p.id);
    const again = await put('/attendance/periods', { campusId: pu, periods: [
      { name: 'P1', startTime: '09:15', endTime: '10:00' }, { name: 'P2', startTime: '10:00', endTime: '10:45' }, { name: 'Lunch', startTime: '12:30', endTime: '13:10', isBreak: true },
    ] });
    expect(again.body.map((p: { id: string }) => p.id)).toEqual([p1, p2, lunch]);
    expect(again.body[0]).toMatchObject({ startTime: '09:15', endTime: '10:00' });
  });

  it('a period-wise campus needs a period (not a break); each period is its own sheet', async () => {
    expect((await put('/settings/attendance.mode', { campusId: pu, value: 'PERIOD' })).status).toBe(200);
    const d = workday(0);
    expect((await get(`/attendance/sheet?sectionId=${puSec}&date=${d}`)).body.type).toBe('period-required');
    expect((await get(`/attendance/sheet?sectionId=${puSec}&date=${d}&periodId=${lunch}`)).body.type).toBe('period-is-break');
    const s1 = await sheet(puSec, d, p1, puMarker);
    expect(s1).toMatchObject({ mode: 'PERIOD', period: { name: 'P1' }, canMark: true });
    expect((await post('/attendance/sheet', { sectionId: puSec, date: d, periodId: p1, records: allPresent(s1.students, [ids.Gauri]) }, puMarker)).body.status).toBe('SUBMITTED');
    expect((await post('/attendance/sheet', { sectionId: puSec, date: d, periodId: p2, records: allPresent(s1.students) }, puMarker)).body.status).toBe('SUBMITTED');
    expect((await sheet(puSec, d, p2)).students.find((x: { id: string }) => x.id === ids.Gauri).status).toBe('PRESENT');
    // The school campus is still daily.
    expect((await post('/attendance/sheet', { sectionId: secB, date: workday(1), periodId: p1, records: [] })).status).toBe(422);
  });
});

describe('AC37 access', () => {
  it('read-only, other campus and other institution', async () => {
    const d = workday(1);
    const s = await sheet(secB, d, undefined, reader);
    expect(s.canMark).toBe(false);
    expect((await post('/attendance/sheet', { sectionId: secB, date: d, records: allPresent(s.students) }, reader)).status).toBe(403);
    expect((await post('/attendance/sheet', { sectionId: secB, date: d, records: allPresent(s.students) }, puMarker)).status).toBe(404);
    expect((await get(`/attendance/sheet?sectionId=${secB}&date=${d}`, puMarker)).status).toBe(404);
    expect((await get(`/attendance/sheet?sectionId=${secB}&date=${d}`, B.session)).status).toBeGreaterThanOrEqual(403);
    expect((await get(`/attendance/day?date=${d}`, puMarker)).body.sections.map((x: { sectionId: string }) => x.sectionId)).toEqual([puSec]);
  });
});
