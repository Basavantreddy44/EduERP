/**
 * AC57–AC59 exams & report cards (Phase 9): grade scales and schemes (ready-made patterns as data),
 * exams and their timetable, marks by the subject's teacher (never above the maximum — also in the
 * database), submit → verify by someone else → locked, corrections with a reason; results exactly by
 * the scheme (weights rescaled for missing components, absent = 0, rounding, pass rules), shared
 * ranks, versions, publishing by someone who entered no marks, parents see only published results.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let levels: { id: string; name: string }[];
let secA: string;
let teacher: Session;
let verifier: Session;
let publisher: Session;
let parent: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const patch = (path: string, body: unknown, s: Session = A.session) => http().patch(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const PARENT = `exam.parent.${tag}@test.local`;
type Row = { studentId: string; attendanceCode?: string; marks?: number | null };
const sheet = (paper: string) => `/exams/papers/${paper}/sections/${secA}`;

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'ExA');
  B = await createTenant(app, platform, 'ExB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-120).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const end = e.toISOString().slice(0, 10);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${end.slice(2, 4)}`, startDate: start, endDate: end, makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  levels = sbs.levels;
  const secs = (await post('/sections', { academicYearId: year, programLevelId: levels[0].id, names: ['A', 'B'], capacity: 40 })).body;
  const all = Array.isArray(secs) ? secs : secs.items ?? secs.sections;
  secA = all.find((s: { name: string }) => s.name === 'A').id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, sec] of [['1', 'Asha', 'A'], ['2', 'Bala', 'A'], ['3', 'Chitra', 'A'], ['4', 'Dev', 'A'], ['5', 'Esha', 'B']]) {
    const r: Record<string, string> = { admissionNo: `EX/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: ['1', '3', '5'].includes(n) ? 'Girl' : 'Boy', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: levels[0].name, section: sec, fatherName: `${f} Father`, parentPhone: `98555000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  for (const [k, code, name, lang] of [['eng', 'ENG', 'English', true], ['mat', 'MAT', 'Mathematics', false], ['kan', 'KAN', 'Kannada', true], ['hin', 'HIN', 'Hindi', true]] as const) ids[k] = (await post('/academics/subjects', { code, name, subjectType: 'THEORY', isLanguage: lang })).body.id;
  await put('/academics/syllabus', { programLevelId: levels[0].id, subjects: [{ subjectId: ids.eng, subjectGroup: 'LANGUAGE_1' }, { subjectId: ids.mat, subjectGroup: 'CORE' }, { subjectId: ids.kan, subjectGroup: 'LANGUAGE_2', isOptional: true }, { subjectId: ids.hin, subjectGroup: 'LANGUAGE_2', isOptional: true }] });
  for (const [k, first, g] of [['ravi', 'Ravi', 'MALE'], ['sunita', 'Sunita', 'FEMALE']]) ids[k] = (await post('/staff', { campusId: main, firstName: first, gender: g, employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  await put(`/academics/sections/${secA}/teachers`, { classTeacherId: ids.sunita, subjects: [{ subjectId: ids.mat, employeeIds: [ids.ravi] }, { subjectId: ids.eng, employeeIds: [ids.sunita] }, { subjectId: ids.kan, employeeIds: [ids.sunita] }, { subjectId: ids.hin, employeeIds: [ids.sunita] }] });
  await put(`/academics/students/${ids.Asha}/electives`, { subjectIds: [ids.kan] });
  await put(`/academics/students/${ids.Bala}/electives`, { subjectIds: [ids.hin] });
  await createRole(A.tenantId, 'EX_TEACHER', [PERMISSIONS.EXAM_READ, PERMISSIONS.EXAM_MARKS]);
  const t = await addMember(app, A.session, { label: 'RaviEx', roleCode: 'EX_TEACHER' });
  teacher = t.session;
  await post(`/staff/${ids.ravi}/user`, { userId: t.userId });
  await createRole(A.tenantId, 'EX_VERIFY', [PERMISSIONS.EXAM_READ, PERMISSIONS.EXAM_VERIFY]);
  verifier = (await addMember(app, A.session, { label: 'Verifier', roleCode: 'EX_VERIFY' })).session;
  await createRole(A.tenantId, 'EX_PUBLISH', [PERMISSIONS.EXAM_READ, PERMISSIONS.EXAM_PUBLISH]);
  publisher = (await addMember(app, A.session, { label: 'Publisher', roleCode: 'EX_PUBLISH' })).session;
  const g = (await get(`/students/${ids.Asha}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  await post(`/students/${ids.Asha}/portal/guardians/${g}`, { email: PARENT });
  await setPassword(PARENT, 'Parent@Test123');
  const s = await login(app, PARENT, 'Parent@Test123');
  parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
}, 180_000);
afterAll(() => app?.close());

describe('AC57 grade scales and schemes', () => {
  it('a scale’s bands cannot overlap and must start at 0%', async () => {
    expect((await post('/exams/scales', { name: 'Bad', items: [{ grade: 'A', minPercent: 50 }, { grade: 'B', minPercent: 50 }, { grade: 'C', minPercent: 0 }] })).status).toBe(422);
    expect((await post('/exams/scales', { name: 'Bad', items: [{ grade: 'A', minPercent: 50 }, { grade: 'B', minPercent: 20 }] })).status).toBe(422);
    const ok = await post('/exams/scales', { name: 'Pass / fail', items: [{ grade: 'P', minPercent: 40 }, { grade: 'F', minPercent: 0, isFail: true }] });
    expect(ok.status).toBe(201);
    ids.pfScale = ok.body.id;
  });

  it('a term’s component weights must add up to 100', async () => {
    const r = await post('/exams/schemes', { name: 'Bad scheme', gradeScaleId: ids.pfScale, passPercent: 40, subjectPassPercent: 40, terms: [{ code: 'T1', name: 'Term 1', finalWeight: 100 }], components: [{ termCode: 'T1', code: 'X', name: 'X', maxMarks: 50, weightage: 60 }] });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body.errors)).toMatch(/add up to 100/);
  });

  it('a ready-made pattern is copied as editable data; one scheme per class', async () => {
    const r = await post('/exams/presets/KA_STATE', { programLevelIds: [levels[0].id] });
    expect(r.status).toBe(201);
    ids.scheme = r.body.id;
    const sc = (await get('/exams/schemes')).body.find((s: { id: string }) => s.id === ids.scheme);
    expect(sc.components.map((c: { code: string }) => c.code)).toEqual(['FA1', 'FA2', 'SA1', 'FA3', 'FA4', 'SA2']);
    expect(sc.terms.map((t: { code: string; finalWeight: number }) => [t.code, t.finalWeight])).toEqual([['TERM_1', 50], ['TERM_2', 50]]);
    expect(sc.levels.map((l: { id: string }) => l.id)).toEqual([levels[0].id]);
    ids.fa1 = sc.components.find((c: { code: string }) => c.code === 'FA1').id;
    ids.sa1 = sc.components.find((c: { code: string }) => c.code === 'SA1').id;
    expect((await get('/exams/scales')).body.find((s: { name: string }) => s.name === 'Karnataka State').items.map((i: { grade: string }) => i.grade)).toEqual(['A+', 'A', 'B+', 'B', 'C+', 'C', 'F']);
    expect((await post('/exams/presets/CBSE', { programLevelIds: [levels[0].id] })).body.type).toBe('class-has-scheme');
    const cbse = await post('/exams/presets/CBSE', { programLevelIds: [levels[1].id] });
    expect(cbse.status).toBe(201);
    const c = (await get('/exams/schemes')).body.find((s: { id: string }) => s.id === cbse.body.id);
    expect(c.terms.map((t: { code: string }) => t.code)).toEqual(['TERM_1', 'TERM_2']);
    expect(c.coAreas.map((a: { name: string }) => a.name)).toEqual(['Work Education', 'Art Education', 'Health & Physical Education', 'Discipline']);
  });
});

describe('AC58 exams and marks', () => {
  it('an exam fills one component; its timetable uses the class syllabus and the exam dates', async () => {
    const fa = await post('/exams', { campusId: main, schemeId: ids.scheme, componentId: ids.fa1, name: 'FA 1', startDate: shift(-20), endDate: shift(-18) });
    expect(fa.status).toBe(201);
    ids.examFa = fa.body.id;
    expect((await post('/exams', { campusId: main, schemeId: ids.scheme, componentId: ids.fa1, name: 'FA 1 again', startDate: shift(-20), endDate: shift(-18) })).body.type).toBe('exam-exists');
    ids.examSa = (await post('/exams', { campusId: main, schemeId: ids.scheme, componentId: ids.sa1, name: 'SA 1', startDate: shift(-10), endDate: shift(-5) })).body.id;
    const sched = (subjects: unknown[]) => put(`/exams/${ids.examSa}/schedule`, { programLevelId: levels[0].id, subjects });
    expect((await sched([{ subjectId: ids.mat, examDate: shift(-30), maxMarks: 80 }])).body.type).toBe('date-outside-exam');
    expect((await put(`/exams/${ids.examSa}/schedule`, { programLevelId: levels[1].id, subjects: [] })).body.type).toBe('class-not-in-scheme');
    expect((await sched([{ subjectId: ids.mat, examDate: shift(-10), startTime: '10:00', endTime: '12:30', maxMarks: 80, passMarks: 28 }, { subjectId: ids.eng, examDate: shift(-9), maxMarks: 80 }, { subjectId: ids.kan, examDate: shift(-8), maxMarks: 80 }])).body).toEqual({ saved: 3 });
    await put(`/exams/${ids.examFa}/schedule`, { programLevelId: levels[0].id, subjects: [{ subjectId: ids.mat, examDate: shift(-20), maxMarks: 20 }, { subjectId: ids.eng, examDate: shift(-19), maxMarks: 20 }] });
    const ex = (await get(`/exams/${ids.examSa}`)).body;
    const papers = ex.classes.find((c: { id: string }) => c.id === levels[0].id).papers;
    ids.saMat = papers.find((p: { subjectId: string }) => p.subjectId === ids.mat).id;
    ids.saEng = papers.find((p: { subjectId: string }) => p.subjectId === ids.eng).id;
    ids.saKan = papers.find((p: { subjectId: string }) => p.subjectId === ids.kan).id;
    const fp = (await get(`/exams/${ids.examFa}`)).body.classes.find((c: { id: string }) => c.id === levels[0].id).papers;
    ids.faMat = fp.find((p: { subjectId: string }) => p.subjectId === ids.mat).id;
    ids.faEng = fp.find((p: { subjectId: string }) => p.subjectId === ids.eng).id;
  });

  it('a sheet lists the section’s students — an optional subject only those who chose it', async () => {
    const m = (await get(sheet(ids.saMat), teacher)).body;
    expect(m.students.map((s: { name: string }) => s.name.split(' ')[0])).toEqual(['Asha', 'Bala', 'Chitra', 'Dev']);
    expect(m).toMatchObject({ canEnter: true, canVerify: false, paper: { maxMarks: 80, passMarks: 28 } });
    expect((await get(sheet(ids.saKan))).body.students.map((s: { name: string }) => s.name.split(' ')[0])).toEqual(['Asha']);
    // The Kannada paper is dropped again (no marks yet), leaving Maths and English.
    expect((await put(`/exams/${ids.examSa}/schedule`, { programLevelId: levels[0].id, subjects: [{ subjectId: ids.mat, examDate: shift(-10), maxMarks: 80, passMarks: 28 }, { subjectId: ids.eng, examDate: shift(-9), maxMarks: 80 }] })).body).toEqual({ saved: 2 });
  });

  it('only the subject’s teacher (or set-up staff) enters marks; never above the maximum', async () => {
    const rows = (v: [string, string | number][]): Row[] => v.map(([n, x]) => (typeof x === 'number' ? { studentId: ids[n], marks: x } : { studentId: ids[n], attendanceCode: x, marks: null }));
    expect((await put(sheet(ids.saEng), { marks: rows([['Asha', 60]]) }, teacher)).body.type).toBe('not-your-subject');
    expect((await put(sheet(ids.saMat), { marks: rows([['Asha', 81]]) }, teacher)).body.type).toBe('marks-invalid');
    expect((await put(sheet(ids.saMat), { marks: [{ studentId: ids.Asha }] }, teacher)).status).toBe(422);
    expect((await put(sheet(ids.saMat), { marks: rows([['Esha', 50]]) }, teacher)).body.type).toBe('marks-invalid');
    expect((await put(sheet(ids.saMat), { marks: rows([['Asha', 72], ['Bala', 40]]) }, teacher)).body).toMatchObject({ saved: 2 });
    expect((await post(`${sheet(ids.saMat)}/submit`, {}, teacher)).body.type).toBe('marks-missing');
    await put(sheet(ids.saMat), { marks: rows([['Chitra', 'ABSENT'], ['Dev', 72]]) }, teacher);
    expect((await post(`${sheet(ids.saMat)}/submit`, {}, teacher)).body.status).toBe('SUBMITTED');
    await put(sheet(ids.faMat), { marks: rows([['Asha', 18], ['Bala', 10], ['Chitra', 20], ['Dev', 18]]) }, teacher);
    await post(`${sheet(ids.faMat)}/submit`, {}, teacher);
    // English by set-up staff (the admin).
    await put(sheet(ids.saEng), { marks: rows([['Asha', 60], ['Bala', 20], ['Chitra', 70], ['Dev', 60]]) });
    await post(`${sheet(ids.saEng)}/submit`, {});
    await put(sheet(ids.faEng), { marks: rows([['Asha', 15], ['Bala', 6], ['Chitra', 20], ['Dev', 15]]) });
    await post(`${sheet(ids.faEng)}/submit`, {});
  });

  it('the database refuses marks above the maximum', async () => {
    const db = appDb();
    try {
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`UPDATE exam_marks SET marks = 95 WHERE student_id = ${ids.Asha}::uuid AND sheet_id = (SELECT id FROM exam_mark_sheets WHERE exam_subject_id = ${ids.saMat}::uuid)`;
      })).rejects.toThrow(/above the maximum/);
    } finally { await db.$disconnect(); }
  });

  it('someone else verifies — then the marks are locked; corrections need set-up rights and a reason', async () => {
    expect((await post(`${sheet(ids.saMat)}/verify`, { accept: true }, teacher)).status).toBe(403);
    expect((await post(`${sheet(ids.saEng)}/verify`, { accept: true })).body.type).toBe('own-marks');
    for (const p of [ids.saMat, ids.faMat, ids.saEng, ids.faEng]) expect((await post(`${sheet(p)}/verify`, { accept: true }, verifier)).body.status).toBe('VERIFIED');
    expect((await put(sheet(ids.saMat), { marks: [{ studentId: ids.Bala, marks: 44 }] }, teacher)).body.type).toBe('sheet-locked');
    expect((await put(sheet(ids.saMat), { marks: [{ studentId: ids.Bala, marks: 44 }] })).body.type).toBe('reason-required');
    expect((await put(sheet(ids.saMat), { marks: [{ studentId: ids.Bala, marks: 44 }], reason: 'Totalling error on page 2' })).body).toEqual({ saved: 1, status: 'VERIFIED' });
    const mine = (await get('/exams/my-sheets', teacher)).body;
    expect(mine.map((s: { subject: string; status: string }) => [s.subject, s.status]).sort()).toEqual([['Mathematics', 'VERIFIED'], ['Mathematics', 'VERIFIED']]);
  });
});

describe('AC59 results and report cards', () => {
  it('results follow the scheme: weights rescaled, absent = 0, rounding, pass rules, shared ranks', async () => {
    expect((await post('/exams/results/calculate', { sectionId: secA, termCode: 'TERM_9' }, publisher)).body.type).toBe('term-invalid');
    const r = await post('/exams/results/calculate', { sectionId: secA, termCode: 'TERM_1' }, publisher);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: 1, students: 4, passed: 2 });
    const v = (await get(`/exams/results/sections/${secA}?termCode=TERM_1`, publisher)).body;
    const by = Object.fromEntries(v.draft.results.map((x: { name: string }) => [x.name.split(' ')[0], x]));
    const subj = (n: string, s: string) => by[n].subjects.find((x: { subjectId: string }) => x.subjectId === ids[s]);
    // Asha: Maths (18/20×15 + 72/80×70) / 85 = 90 (FA2 not held: its weight is left out); English (15/20×15 + 60/80×70) / 85 = 75.
    expect([subj('Asha', 'mat').percent, subj('Asha', 'eng').percent]).toEqual([90, 75]);
    expect(by.Asha).toMatchObject({ total: 165, percentage: 82.5, grade: 'A', rank: 1, resultStatus: 'PASS' });
    expect(by.Dev).toMatchObject({ percentage: 82.5, rank: 1 });
    // Chitra was absent in SA1 Maths: (20/20×15 + 0) / 85 = 17.6 → 18, fails Maths; English (15 + 61.25) / 85 = 89.7 → 90.
    expect(subj('Chitra', 'mat')).toMatchObject({ percent: 18, grade: 'F', isPass: false });
    expect(by.Chitra).toMatchObject({ percentage: 54, grade: 'C+', rank: 3, resultStatus: 'FAIL' });
    // Bala's corrected Maths: (10/20×15 + 44/80×70) / 85 = 54; English (6/20×15 + 20/80×70) / 85 = 26 fails.
    expect(by.Bala).toMatchObject({ percentage: 40, grade: 'C', rank: 4, resultStatus: 'FAIL' });
    ids.pub1 = v.draft.id;
    ids.ashaResult = by.Asha.id;
  });

  it('remarks by the class teacher or results staff, on drafts only', async () => {
    expect((await patch(`/exams/results/${ids.ashaResult}`, { remarks: 'x' }, teacher)).status).toBe(403);
    expect((await patch(`/exams/results/${ids.ashaResult}`, { remarks: 'Steady and careful. Read more English stories.' }, publisher)).status).toBe(200);
  });

  it('parents see nothing until published; publishing needs someone who entered no marks', async () => {
    expect((await get(`/portal/children/${ids.Asha}/results`, parent)).body).toEqual([]);
    expect((await post(`/exams/results/publications/${ids.pub1}/publish`, {}, teacher)).status).toBe(403);
    expect((await post(`/exams/results/publications/${ids.pub1}/publish`, {})).body.type).toBe('own-marks');
    const p = await post(`/exams/results/publications/${ids.pub1}/publish`, {}, publisher);
    expect(p.body).toMatchObject({ version: 1, status: 'PUBLISHED', notified: 1 });
    const list = (await get(`/portal/children/${ids.Asha}/results`, parent)).body;
    expect(list).toEqual([expect.objectContaining({ id: ids.ashaResult, term: 'First term', percentage: 82.5, grade: 'A', rank: 1 })]);
    const card = (await get(`/portal/children/${ids.Asha}/results/${ids.ashaResult}`, parent)).body;
    expect(card).toMatchObject({ term: 'First term', resultStatus: 'PASS', remarks: 'Steady and careful. Read more English stories.', student: { admissionNo: 'EX/1' } });
    expect(card.columns.map((c: { code: string }) => c.code)).toEqual(['FA1', 'FA2', 'SA1']);
    expect(card.subjects.find((s: { name: string }) => s.name === 'Mathematics').components).toMatchObject({ FA1: { marks: 18, max: 20 }, SA1: { marks: 72, max: 80 } });
    expect((await get(`/portal/children/${ids.Bala}/results`, parent)).status).toBe(404);
    expect((await patch(`/exams/results/${ids.ashaResult}`, { remarks: 'change' }, publisher)).body.type).toBe('result-published');
  });

  it('a correction makes a new version; the published one stays until the new one is published', async () => {
    expect((await put(sheet(ids.saMat), { marks: [{ studentId: ids.Chitra, attendanceCode: 'EXEMPT', marks: null }], reason: 'Medical exemption approved' })).body.saved).toBe(1);
    const r = await post('/exams/results/calculate', { sectionId: secA, termCode: 'TERM_1' }, publisher);
    expect(r.body).toMatchObject({ version: 2, passed: 3 });
    const v = (await get(`/exams/results/sections/${secA}?termCode=TERM_1`, publisher)).body;
    const chitra = v.draft.results.find((x: { name: string }) => x.name.startsWith('Chitra'));
    // Exempt → only FA1 counts for Maths: 100; with English 90 → 95, first.
    expect(chitra).toMatchObject({ percentage: 95, grade: 'A+', rank: 1, resultStatus: 'PASS' });
    expect(v.draft.results.find((x: { name: string }) => x.name.startsWith('Asha')).remarks).toBe('Steady and careful. Read more English stories.');
    expect((await get(`/portal/children/${ids.Asha}/results`, parent)).body[0].rank).toBe(1);
    await post(`/exams/results/publications/${v.draft.id}/publish`, {}, publisher);
    const list = (await get(`/portal/children/${ids.Asha}/results`, parent)).body;
    expect(list).toHaveLength(1);
    expect(list[0].rank).toBe(2);
    const db = appDb();
    try {
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`DELETE FROM exam_results WHERE id = ${ids.ashaResult}::uuid`;
      })).rejects.toThrow(/cannot be changed/);
    } finally { await db.$disconnect(); }
    const card = (await get(`/exams/results/${ids.ashaResult}/card`)).body;
    expect(card).toMatchObject({ version: 1, status: 'SUPERSEDED' });
  });

  it('co-scholastic areas come from the class’s scheme', async () => {
    const co = (await get(`/exams/co-scholastic/sections/${secA}?termCode=TERM_1`)).body;
    expect(co.areas).toEqual([]);
    expect(co.students).toHaveLength(4);
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get('/exams/schemes', B.session)).body).toEqual([]);
    expect((await get(`/exams/${ids.examSa}`, B.session)).status).toBe(404);
    expect((await get(`/exams/results/${ids.ashaResult}/card`, B.session)).status).toBe(404);
    expect((await post(`/exams/results/publications/${ids.pub1}/publish`, {}, B.session)).status).toBe(404);
  });
});
