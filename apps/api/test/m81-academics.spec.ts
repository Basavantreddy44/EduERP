/**
 * AC54–AC56 academics I (Phase 8): subjects, class syllabus, class and subject teachers, electives;
 * timetable drafts on the bell timings, publish refuses clashes (teacher or room in two places — also
 * enforced by the database), versions, substitutes only when free; homework and the class diary with
 * the teacher limited to their own sections, parents submitting and acknowledging in the app;
 * permissions and isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let level: string;
let secA: string;
let secB: string;
let teacher: Session;
let reader: Session;
let parent: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const patch = (path: string, body: unknown, s: Session = A.session) => http().patch(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
/** The next date (from tomorrow) that falls on weekday `w` (1 = Monday). */
const nextOn = (w: number) => { for (let i = 1; i <= 7; i++) if (dow(shift(i)) === w) return shift(i); return today; };
const tag = Date.now().toString(36);
const PARENT = `acad.parent.${tag}@test.local`;
type Lesson = { dayOfWeek: number; periodId: string; subjectId: string; employeeId: string; roomId?: string | null };

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'AcaA');
  B = await createTenant(app, platform, 'AcaB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-90).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const end = e.toISOString().slice(0, 10);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${end.slice(2, 4)}`, startDate: start, endDate: end, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  level = sbs.levels[0].id;
  const secs = (await post('/sections', { academicYearId: year, programLevelId: level, names: ['A', 'B'], capacity: 40 })).body;
  const all = Array.isArray(secs) ? secs : secs.items ?? secs.sections;
  secA = all.find((s: { name: string }) => s.name === 'A').id;
  secB = all.find((s: { name: string }) => s.name === 'B').id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, sec] of [['1', 'Anika', 'A'], ['2', 'Bharat', 'A'], ['3', 'Charan', 'B']]) {
    const r: Record<string, string> = { admissionNo: `AC/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: n === '1' ? 'Girl' : 'Boy', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: sec, fatherName: `${f} Father`, parentPhone: `98666000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const [k, name, g] of [['ravi', 'Ravi', 'MALE'], ['sunita', 'Sunita', 'FEMALE'], ['kiran', 'Kiran', 'MALE']]) {
    ids[k] = (await post('/staff', { campusId: main, firstName: name, gender: g, employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  }
  const periods = (await put('/attendance/periods', { campusId: main, periods: [
    { name: 'P1', startTime: '09:00', endTime: '09:45' }, { name: 'P2', startTime: '09:45', endTime: '10:30' }, { name: 'Break', startTime: '10:30', endTime: '10:45', isBreak: true },
  ] })).body;
  [ids.p1, ids.p2, ids.brk] = periods.map((p: { id: string }) => p.id);
  // Ravi's login (a subject teacher), a read-only office login, and Anika's father.
  await createRole(A.tenantId, 'TEACHER_T', [PERMISSIONS.ACAD_READ, PERMISSIONS.ACAD_TEACH]);
  const t = await addMember(app, A.session, { label: 'Ravi', roleCode: 'TEACHER_T' });
  teacher = t.session;
  expect((await post(`/staff/${ids.ravi}/user`, { userId: t.userId })).status).toBeLessThan(300);
  await createRole(A.tenantId, 'ACAD_VIEW', [PERMISSIONS.ACAD_READ]);
  reader = (await addMember(app, A.session, { label: 'AcadReader', roleCode: 'ACAD_VIEW' })).session;
  const g = (await get(`/students/${ids.Anika}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  await post(`/students/${ids.Anika}/portal/guardians/${g}`, { email: PARENT });
  await setPassword(PARENT, 'Parent@Test123');
  const s = await login(app, PARENT, 'Parent@Test123');
  parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
}, 180_000);
afterAll(() => app?.close());

describe('AC54 subjects, syllabus and teachers', () => {
  it('subjects have unique codes (upper-cased)', async () => {
    for (const [k, code, name, type] of [['eng', 'eng', 'English', 'THEORY'], ['mat', 'MAT', 'Mathematics', 'THEORY'], ['sci', 'SCI', 'Science', 'THEORY_PRACTICAL'], ['kan', 'KAN', 'Kannada', 'THEORY'], ['hin', 'HIN', 'Hindi', 'THEORY'], ['art', 'ART', 'Art', 'ACTIVITY']]) {
      const r = await post('/academics/subjects', { code, name, subjectType: type, isLanguage: ['eng', 'KAN', 'HIN'].includes(code) });
      expect(r.status).toBe(201);
      ids[k] = r.body.id;
    }
    expect((await get('/academics/subjects')).body.find((s: { id: string }) => s.id === ids.eng).code).toBe('ENG');
    expect((await post('/academics/subjects', { code: 'MAT', name: 'Maths again', subjectType: 'THEORY' })).body.type).toBe('subject-code-taken');
    expect((await patch(`/academics/subjects/${ids.art}`, { status: 'INACTIVE' })).body.status).toBe('INACTIVE');
  });

  it('class syllabus: active subjects only; groups and optional subjects', async () => {
    expect((await put('/academics/syllabus', { programLevelId: level, subjects: [{ subjectId: ids.art, subjectGroup: 'CORE' }] })).body.type).toBe('subject-invalid');
    const r = await put('/academics/syllabus', { programLevelId: level, subjects: [
      { subjectId: ids.eng, subjectGroup: 'LANGUAGE_1' }, { subjectId: ids.mat, subjectGroup: 'CORE' }, { subjectId: ids.sci, subjectGroup: 'CORE' },
      { subjectId: ids.kan, subjectGroup: 'LANGUAGE_2', isOptional: true }, { subjectId: ids.hin, subjectGroup: 'LANGUAGE_2', isOptional: true },
    ] });
    expect(r.body).toEqual({ saved: 5 });
    const s = (await get(`/academics/classes/${level}/syllabus`)).body;
    expect(s.subjects.map((x: { subject: { code: string } }) => x.subject.code)).toEqual(['ENG', 'MAT', 'SCI', 'KAN', 'HIN']);
  });

  it('class teacher and subject teachers (staff of the campus, subjects of the syllabus)', async () => {
    expect((await put(`/academics/sections/${secA}/teachers`, { subjects: [{ subjectId: ids.art, employeeIds: [ids.ravi] }] })).body.type).toBe('not-in-syllabus');
    expect((await put(`/academics/sections/${secA}/teachers`, { classTeacherId: ids.sunita, subjects: [
      { subjectId: ids.mat, employeeIds: [ids.ravi] }, { subjectId: ids.eng, employeeIds: [ids.sunita] }, { subjectId: ids.sci, employeeIds: [ids.kiran] },
    ] })).body).toEqual({ saved: 3 });
    // Section B: Ravi also teaches Maths there; Sunita teaches English.
    await put(`/academics/sections/${secB}/teachers`, { classTeacherId: ids.ravi, subjects: [{ subjectId: ids.mat, employeeIds: [ids.ravi] }, { subjectId: ids.eng, employeeIds: [ids.sunita] }] });
    const v = (await get(`/academics/sections/${secA}/teachers`)).body;
    expect(v.classTeacher.name).toBe('Sunita');
    expect(v.subjects.find((x: { subjectId: string }) => x.subjectId === ids.mat).teachers.map((t: { name: string }) => t.name)).toEqual(['Ravi']);
    // A subject with teachers cannot leave the syllabus.
    expect((await put('/academics/syllabus', { programLevelId: level, subjects: [{ subjectId: ids.eng, subjectGroup: 'LANGUAGE_1' }] })).body.type).toBe('subject-in-use');
  });

  it('electives: only the class’s optional subjects', async () => {
    expect((await put(`/academics/students/${ids.Anika}/electives`, { subjectIds: [ids.mat] })).body.type).toBe('not-optional');
    expect((await put(`/academics/students/${ids.Anika}/electives`, { subjectIds: [ids.kan] })).body).toEqual({ saved: 1 });
    expect((await put(`/academics/students/${ids.Anika}/electives`, { subjectIds: [ids.hin] })).body).toEqual({ saved: 1 });
    const db = ownerDb();
    try { expect((await db.studentSubject.findMany({ where: { tenantId: A.tenantId } })).map((x) => x.subjectId)).toEqual([ids.hin]); } finally { await db.$disconnect(); }
  });
});

describe('AC55 timetable and substitution', () => {
  it('rooms per campus with unique names', async () => {
    ids.room1 = (await post('/academics/rooms', { campusId: main, name: 'Room 1', roomType: 'CLASSROOM', capacity: 40 })).body.id;
    ids.lab = (await post('/academics/rooms', { campusId: main, name: 'Science Lab', roomType: 'LAB' })).body.id;
    expect((await post('/academics/rooms', { campusId: main, name: 'Room 1', roomType: 'CLASSROOM' })).body.type).toBe('room-name-taken');
    expect((await get('/academics/rooms')).body.map((r: { name: string }) => r.name).sort()).toEqual(['Room 1', 'Science Lab']);
  });

  it('a draft uses the bell timings (no breaks) and the section’s subject teachers', async () => {
    const base = { sectionId: secA, effectiveFrom: today };
    expect((await put('/academics/timetable', { ...base, entries: [{ dayOfWeek: 1, periodId: ids.brk, subjectId: ids.mat, employeeId: ids.ravi }] })).body.type).toBe('period-invalid');
    expect((await put('/academics/timetable', { ...base, entries: [{ dayOfWeek: 1, periodId: ids.p1, subjectId: ids.mat, employeeId: ids.kiran }] })).body.type).toBe('not-subject-teacher');
    expect((await put('/academics/timetable', { ...base, entries: [{ dayOfWeek: 1, periodId: ids.p1, subjectId: ids.mat, employeeId: ids.ravi }, { dayOfWeek: 1, periodId: ids.p1, subjectId: ids.eng, employeeId: ids.sunita }] })).status).toBe(422);
    const week: Lesson[] = [];
    for (let d = 1; d <= 6; d++) week.push({ dayOfWeek: d, periodId: ids.p1, subjectId: ids.mat, employeeId: ids.ravi, roomId: ids.room1 }, { dayOfWeek: d, periodId: ids.p2, subjectId: ids.sci, employeeId: ids.kiran, roomId: ids.lab });
    const r = await put('/academics/timetable', { ...base, entries: week });
    expect(r.body).toMatchObject({ version: 1, lessons: 12 });
    // Saving again replaces the draft (same version).
    expect((await put('/academics/timetable', { ...base, entries: week })).body).toMatchObject({ id: r.body.id, version: 1, lessons: 12 });
    expect((await post(`/academics/sections/${secA}/timetable/publish`, {})).body).toMatchObject({ version: 1, status: 'PUBLISHED' });
    const v = (await get(`/academics/sections/${secA}/timetable`)).body;
    expect(v.published.entries).toHaveLength(12);
    expect(v.draft).toBeNull();
    expect(v.periods.map((p: { name: string }) => p.name)).toEqual(['P1', 'P2', 'Break']);
  });

  it('publishing refuses a clash with another section (teacher, room) and says where', async () => {
    // Ravi is with A in P1 on Monday; B puts him there too.
    await put('/academics/timetable', { sectionId: secB, effectiveFrom: today, entries: [{ dayOfWeek: 1, periodId: ids.p1, subjectId: ids.mat, employeeId: ids.ravi }] });
    const c = await post(`/academics/sections/${secB}/timetable/publish`, {});
    expect(c.status).toBe(409);
    expect(c.body.type).toBe('timetable-clash');
    expect(c.body.errors[0].message).toMatch(/^Mon P1: teacher Ravi is with .* – A$/);
    // Room 1 is A's room in P1 too.
    await put('/academics/timetable', { sectionId: secB, effectiveFrom: today, entries: [{ dayOfWeek: 1, periodId: ids.p1, subjectId: ids.eng, employeeId: ids.sunita, roomId: ids.room1 }] });
    expect((await post(`/academics/sections/${secB}/timetable/publish`, {})).body.errors[0].message).toMatch(/room Room 1/);
    await put('/academics/timetable', { sectionId: secB, effectiveFrom: today, entries: [{ dayOfWeek: 1, periodId: ids.p1, subjectId: ids.eng, employeeId: ids.sunita }, { dayOfWeek: 1, periodId: ids.p2, subjectId: ids.mat, employeeId: ids.ravi }] });
    expect((await post(`/academics/sections/${secB}/timetable/publish`, {})).body.status).toBe('PUBLISHED');
  });

  it('the database itself refuses a live clash and deleting a live lesson', async () => {
    const db = appDb();
    try {
      const bLive = (await get('/academics/sections/' + secB + '/timetable')).body.published.id;
      const [x] = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        return tx.$queryRaw<{ id: string; timetable_id: string }[]>`SELECT id, timetable_id FROM timetable_entries WHERE is_live AND employee_id = ${ids.ravi}::uuid AND day_of_week = 1 AND period_id = ${ids.p1}::uuid`;
      });
      expect(x).toBeTruthy();
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`INSERT INTO timetable_entries (id, tenant_id, timetable_id, day_of_week, period_id, subject_id, employee_id, is_live) VALUES (gen_random_uuid(), ${A.tenantId}::uuid, ${bLive}::uuid, 3, ${ids.p1}::uuid, ${ids.mat}::uuid, ${ids.ravi}::uuid, true)`;
      })).rejects.toThrow(/23505/);
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`DELETE FROM timetable_entries WHERE id = ${x.id}::uuid`;
      })).rejects.toThrow(/published lesson cannot be deleted/);
    } finally { await db.$disconnect(); }
  });

  it('a new version archives the old one; teachers see their own week', async () => {
    const week: Lesson[] = [];
    for (let d = 1; d <= 6; d++) week.push({ dayOfWeek: d, periodId: ids.p1, subjectId: ids.mat, employeeId: ids.ravi, roomId: ids.room1 }, { dayOfWeek: d, periodId: ids.p2, subjectId: ids.eng, employeeId: ids.sunita });
    week[1] = { dayOfWeek: 1, periodId: ids.p2, subjectId: ids.sci, employeeId: ids.kiran, roomId: ids.lab };
    // Monday P2: Sunita is with B (English P1) — no clash; Ravi with B in P2 on Monday — A keeps P1 only.
    expect((await put('/academics/timetable', { sectionId: secA, effectiveFrom: today, entries: week })).body.version).toBe(2);
    expect((await post(`/academics/sections/${secA}/timetable/publish`, {})).body).toMatchObject({ version: 2, status: 'PUBLISHED' });
    const db = ownerDb();
    try { expect((await db.timetable.findMany({ where: { sectionId: secA }, orderBy: { version: 'asc' } })).map((t) => t.status)).toEqual(['ARCHIVED', 'PUBLISHED']); } finally { await db.$disconnect(); }
    const mine = (await get('/academics/me/timetable', teacher)).body;
    expect(mine.teacher.name).toBe('Ravi');
    expect(mine.entries).toHaveLength(7); // 6 in A (P1) + Monday P2 in B
    expect(mine.entries.filter((e: { section: string }) => /– B$/.test(e.section))).toHaveLength(1);
    expect((await get(`/academics/teachers/${ids.kiran}/timetable`)).body.entries).toHaveLength(1);
  });

  it('substitutes: only on the lesson’s weekday, only teachers free that period, once per lesson and day', async () => {
    const tt = (await get(`/academics/sections/${secA}/timetable`)).body.published;
    const tue = tt.entries.find((e: { dayOfWeek: number; periodId: string }) => e.dayOfWeek === 2 && e.periodId === ids.p1); // Ravi, Maths
    ids.lesson = tue.id;
    const date = nextOn(2);
    expect((await get(`/academics/lessons/${tue.id}/free-teachers?date=${nextOn(3)}`)).body.type).toBe('wrong-day');
    const free = (await get(`/academics/lessons/${tue.id}/free-teachers?date=${date}`)).body.map((t: { name: string }) => t.name);
    expect(free).toEqual(['Kiran', 'Sunita']);
    expect((await post('/academics/substitutions', { timetableEntryId: tue.id, date, substituteEmployeeId: ids.ravi, reason: 'Ravi on training' })).body.type).toBe('teacher-busy');
    const s = await post('/academics/substitutions', { timetableEntryId: tue.id, date, substituteEmployeeId: ids.kiran, reason: 'Ravi on training' });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ date, absent: 'Ravi', substitute: 'Kiran', subject: 'Mathematics', period: 'P1', status: 'ASSIGNED' });
    ids.sub = s.body.id;
    expect((await post('/academics/substitutions', { timetableEntryId: tue.id, date, substituteEmployeeId: ids.sunita, reason: 'Twice' })).body.type).toBe('already-substituted');
    // Kiran is now busy that period on that date.
    expect((await get('/academics/lessons/' + tue.id + '/free-teachers?date=' + date)).body.map((t: { name: string }) => t.name)).toEqual(['Sunita']);
    expect((await get(`/academics/substitutions?campusId=${main}&date=${date}`)).body.map((x: { id: string }) => x.id)).toEqual([ids.sub]);
    expect((await get('/academics/teachers/' + ids.kiran + '/timetable')).body.substitutions.map((x: { id: string }) => x.id)).toEqual([ids.sub]);
    expect((await post(`/academics/substitutions/${ids.sub}/cancel`, {})).body.status).toBe('CANCELLED');
    expect((await post(`/academics/substitutions/${ids.sub}/cancel`, {})).body.type).toBe('substitution-closed');
    ids.sub = (await post('/academics/substitutions', { timetableEntryId: tue.id, date, substituteEmployeeId: ids.kiran, reason: 'Ravi on training' })).body.id;
    expect(ids.sub).toBeTruthy();
  });
});

describe('AC56 homework and class diary', () => {
  it('a teacher posts only to sections they teach; subjects of the syllabus; due date not past', async () => {
    const hw = { sectionId: secA, subjectId: ids.mat, title: 'Exercise 4.2, sums 1–10', dueDate: shift(2) };
    expect((await post('/academics/homework', { ...hw, dueDate: shift(-1) }, teacher)).body.type).toBe('due-past');
    expect((await post('/academics/homework', { ...hw, subjectId: ids.art }, teacher)).body.type).toBe('not-in-syllabus');
    // Ravi teaches in A and B; remove him from B and he can no longer post there.
    await put(`/academics/sections/${secB}/teachers`, { classTeacherId: null, subjects: [{ subjectId: ids.mat, employeeIds: [ids.sunita] }, { subjectId: ids.eng, employeeIds: [ids.sunita] }] });
    expect((await post('/academics/homework', { ...hw, sectionId: secB }, teacher)).status).toBe(403);
    const r = await post('/academics/homework', hw, teacher);
    expect(r.status).toBe(201);
    expect(r.body.notified).toBe(1); // Anika's father
    ids.hw = r.body.id;
    ids.hwRead = (await post('/academics/homework', { ...hw, title: 'Learn the 12 times table', allowSubmission: false })).body.id;
    expect((await post('/academics/homework', hw, reader)).status).toBe(403);
    const list = (await get(`/academics/sections/${secA}/homework`, teacher)).body;
    expect(list).toMatchObject({ students: 2, canPost: true });
    expect(list.items.find((h: { id: string }) => h.id === ids.hw)).toMatchObject({ subject: 'Mathematics', submitted: 0, marked: 0 });
    expect((await get(`/academics/sections/${secA}/homework`, reader)).body.canPost).toBe(false);
  });

  it('parents see their child’s homework, submit (replace until marked); the teacher marks', async () => {
    const mine = (await get(`/portal/children/${ids.Anika}/homework`, parent)).body;
    expect(mine.items.map((h: { id: string }) => h.id).sort()).toEqual([ids.hw, ids.hwRead].sort());
    expect((await post(`/portal/children/${ids.Anika}/homework/${ids.hwRead}/submit`, { text: 'Done' }, parent)).body.type).toBe('no-submission');
    expect((await post(`/portal/children/${ids.Anika}/homework/${ids.hw}/submit`, {}, parent)).status).toBe(422);
    expect((await post(`/portal/children/${ids.Anika}/homework/${ids.hw}/submit`, { text: 'First try' }, parent)).status).toBe(200);
    expect((await post(`/portal/children/${ids.Anika}/homework/${ids.hw}/submit`, { text: 'All ten sums done' }, parent)).status).toBe(200);
    // Not another child's homework, nor a child that is not theirs.
    expect((await post(`/portal/children/${ids.Bharat}/homework/${ids.hw}/submit`, { text: 'x' }, parent)).status).toBe(404);
    const subs = (await get(`/academics/homework/${ids.hw}/submissions`, teacher)).body;
    expect(subs.canMark).toBe(true);
    const row = subs.students.find((x: { studentId: string }) => x.studentId === ids.Anika);
    expect(row.submission).toMatchObject({ text: 'All ten sums done', late: false, status: 'SUBMITTED' });
    expect(subs.students.find((x: { studentId: string }) => x.studentId === ids.Bharat).submission).toBeNull();
    expect((await post(`/academics/submissions/${row.submission.id}/mark`, { grade: 'A', feedback: 'Neat work' }, reader)).status).toBe(403);
    expect((await post(`/academics/submissions/${row.submission.id}/mark`, { grade: 'A', feedback: 'Neat work' }, teacher)).body.status).toBe('MARKED');
    expect((await post(`/portal/children/${ids.Anika}/homework/${ids.hw}/submit`, { text: 'Change' }, parent)).body.type).toBe('already-marked');
    const after = (await get(`/portal/children/${ids.Anika}/homework`, parent)).body.items.find((h: { id: string }) => h.id === ids.hw);
    expect(after.submission).toMatchObject({ grade: 'A', feedback: 'Neat work', status: 'MARKED' });
  });

  it('diary: class notes and notes to one student; parents acknowledge once', async () => {
    expect((await post('/academics/diary', { sectionId: secA, studentId: ids.Charan, noteDate: today, note: 'Wrong section' }, teacher)).body.type).toBe('not-in-section');
    const cls = await post('/academics/diary', { sectionId: secA, noteDate: today, note: 'Bring your geometry box tomorrow.' }, teacher);
    expect(cls.body.notified).toBe(1);
    const one = await post('/academics/diary', { sectionId: secA, studentId: ids.Bharat, noteDate: today, note: 'Bharat did not bring his notebook.' }, teacher);
    expect(one.body.notified).toBe(0);
    const forAnika = (await post('/academics/diary', { sectionId: secA, studentId: ids.Anika, noteDate: today, note: 'Anika read very well today.' }, teacher)).body.id;
    const seen = (await get(`/portal/children/${ids.Anika}/homework`, parent)).body.diary;
    expect(seen.map((n: { id: string }) => n.id).sort()).toEqual([cls.body.id, forAnika].sort());
    expect((await post(`/portal/children/${ids.Anika}/diary/${one.body.id}/seen`, {}, parent)).status).toBe(404);
    expect((await post(`/portal/children/${ids.Anika}/diary/${cls.body.id}/seen`, {}, parent)).body.acknowledged).toBe(true);
    expect((await post(`/portal/children/${ids.Anika}/diary/${cls.body.id}/seen`, {}, parent)).body.acknowledged).toBe(true);
    const d = (await get(`/academics/sections/${secA}/diary`, teacher)).body.items.find((n: { id: string }) => n.id === cls.body.id);
    expect(d).toMatchObject({ acks: 1, expected: 2 });
  });

  it('the parent app shows the week with the coming substitute', async () => {
    const t = (await get(`/portal/children/${ids.Anika}/timetable`, parent)).body.timetable;
    expect(t.entries).toHaveLength(12);
    expect(t.substitutions.map((x: { id: string; substitute: string }) => [x.id, x.substitute])).toEqual([[ids.sub, 'Kiran']]);
  });
});

describe('screens: sections and staff pickers', () => {
  it('a teacher sees only their own sections; office staff see all with their own marked', async () => {
    // With 'view academics' a teacher sees every class; their own are marked.
    expect((await get('/academics/sections', teacher)).body.map((s: { id: string; mine: boolean }) => [s.id, s.mine])).toEqual([[secA, true], [secB, false]]);
    // A teacher-only role sees just the classes they teach.
    await createRole(A.tenantId, 'TEACH_ONLY', [PERMISSIONS.ACAD_TEACH]);
    const only = await addMember(app, A.session, { label: 'Kiran', roleCode: 'TEACH_ONLY' });
    await post('/staff/' + ids.kiran + '/user', { userId: only.userId });
    expect((await get('/academics/sections', only.session)).body.map((s: { id: string }) => s.id)).toEqual([secA]);
    expect((await get('/academics/sections', reader)).body.map((s: { name: string; mine: boolean }) => [s.name.slice(-1), s.mine])).toEqual([['A', false], ['B', false]]);
    expect((await get(`/academics/staff?campusId=${main}`, reader)).body.map((s: { name: string }) => s.name)).toEqual(['Kiran', 'Ravi', 'Sunita']);
    expect((await get('/academics/sections', B.session)).body).toEqual([]);
  });
});

describe('permissions and isolation', () => {
  it('read-only staff cannot set up; teachers cannot publish; parents cannot reach office routes', async () => {
    expect((await post('/academics/subjects', { code: 'X1', name: 'Nope', subjectType: 'THEORY' }, reader)).status).toBe(403);
    expect((await post(`/academics/sections/${secA}/timetable/publish`, {}, teacher)).status).toBe(403);
    expect((await get('/academics/subjects', parent)).status).toBe(403);
    expect((await get(`/portal/children/${ids.Bharat}/timetable`, parent)).status).toBe(404);
  });

  it('another institution sees none of it', async () => {
    expect((await get('/academics/subjects', B.session)).body).toEqual([]);
    expect((await get(`/academics/sections/${secA}/timetable`, B.session)).status).toBe(404);
    expect((await get(`/academics/homework/${ids.hw}/submissions`, B.session)).status).toBe(404);
    expect((await post('/academics/substitutions', { timetableEntryId: ids.lesson, date: nextOn(2), substituteEmployeeId: ids.sunita, reason: 'cross tenant' }, B.session)).status).toBe(404);
  });
});
