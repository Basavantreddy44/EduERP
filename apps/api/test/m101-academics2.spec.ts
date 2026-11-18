/**
 * AC60–AC62 academics II (Phase 10): syllabus units and topics, lesson plans by the subject's
 * teacher (taught / postponed), completion %; study material (notes, links, files) seen by parents
 * only when published and for their child's class, files only through that check, views counted;
 * certificates from templates — gapless numbers, frozen text, approval when the template asks,
 * a public check page showing only the certificate's face, cancellation; isolation.
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
let level: string;
let secA: string;
let secB: string;
let teacher: Session;
let parent: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
const PARENT = `acad2.parent.${tag}@test.local`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'Ac2A');
  B = await createTenant(app, platform, 'Ac2B');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  level = sbs.levels[0].id;
  const secs = (await post('/sections', { academicYearId: year, programLevelId: level, names: ['A', 'B'], capacity: 40 })).body;
  const all = Array.isArray(secs) ? secs : secs.items ?? secs.sections;
  secA = all.find((s: { name: string }) => s.name === 'A').id;
  secB = all.find((s: { name: string }) => s.name === 'B').id;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, g, sec] of [['1', 'Asha', 'Girl', 'A'], ['2', 'Bala', 'Boy', 'A'], ['3', 'Esha', 'Girl', 'B']]) {
    const r: Record<string, string> = { admissionNo: `AT/${n}`, firstName: f, lastName: 'Test', dob: '2014-05-09', gender: g, admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: sec, fatherName: `${f} Father`, parentPhone: `98444000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  ids.mat = (await post('/academics/subjects', { code: 'MAT', name: 'Mathematics', subjectType: 'THEORY' })).body.id;
  ids.eng = (await post('/academics/subjects', { code: 'ENG', name: 'English', subjectType: 'THEORY', isLanguage: true })).body.id;
  await put('/academics/syllabus', { programLevelId: level, subjects: [{ subjectId: ids.eng, subjectGroup: 'LANGUAGE_1' }, { subjectId: ids.mat, subjectGroup: 'CORE' }] });
  ids.ravi = (await post('/staff', { campusId: main, firstName: 'Ravi', gender: 'MALE', employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  await put(`/academics/sections/${secA}/teachers`, { subjects: [{ subjectId: ids.mat, employeeIds: [ids.ravi] }] });
  await createRole(A.tenantId, 'AC2_TEACHER', [PERMISSIONS.ACAD_READ, PERMISSIONS.ACAD_TEACH]);
  const t = await addMember(app, A.session, { label: 'RaviAc2', roleCode: 'AC2_TEACHER' });
  teacher = t.session;
  await post(`/staff/${ids.ravi}/user`, { userId: t.userId });
  const g = (await get(`/students/${ids.Asha}/portal`)).body.find((r: { kind: string }) => r.kind === 'GUARDIAN').id;
  await post(`/students/${ids.Asha}/portal/guardians/${g}`, { email: PARENT });
  await setPassword(PARENT, 'Parent@Test123');
  const s = await login(app, PARENT, 'Parent@Test123');
  parent = s.tenantId ? s : await switchTenant(app, s, A.tenantId);
}, 180_000);
afterAll(() => app?.close());

describe('AC60 syllabus units, lesson plans and completion', () => {
  it('the office sets units and topics of a class and subject', async () => {
    const body = { programLevelId: level, subjectId: ids.mat, units: [
      { title: 'Numbers', plannedHours: 12, topics: [{ title: 'Place value' }, { title: 'Roman numerals' }, { title: 'Rounding off' }] },
      { title: 'Fractions', plannedHours: 10, topics: [{ title: 'Equivalent fractions' }] },
    ] };
    expect((await put('/academics/units', body, teacher)).status).toBe(403);
    const r = await put('/academics/units', body);
    expect(r.status).toBe(200);
    expect(r.body.units.map((u: { topics: unknown[] }) => u.topics.length)).toEqual([3, 1]);
    ids.unit1 = r.body.units[0].id;
    [ids.t1, ids.t2, ids.t3] = r.body.units[0].topics.map((t: { id: string }) => t.id);
    ids.t4 = r.body.units[1].topics[0].id;
    ids.unit2 = r.body.units[1].id;
    const eng = await put('/academics/units', { programLevelId: level, subjectId: ids.eng, units: [{ title: 'Reading', topics: [{ title: 'Poem: The Rain' }] }] });
    ids.engTopic = eng.body.units[0].topics[0].id;
  });

  it('only the subject’s teacher plans, on topics of that class and subject', async () => {
    const v = (await get(`/academics/sections/${secA}/subjects/${ids.mat}/lessons`, teacher)).body;
    expect(v).toMatchObject({ canPlan: true, completion: { taught: 0, total: 4, percent: 0 } });
    expect((await post('/academics/lesson-plans', { sectionId: secB, subjectId: ids.mat, topicId: ids.t1, plannedDate: today }, teacher)).status).toBe(403);
    expect((await post('/academics/lesson-plans', { sectionId: secA, subjectId: ids.mat, topicId: ids.engTopic, plannedDate: today }, teacher)).body.type).toBe('topic-invalid');
    ids.p1 = (await post('/academics/lesson-plans', { sectionId: secA, subjectId: ids.mat, topicId: ids.t1, plannedDate: today, objectives: 'Read and write 6-digit numbers', teachingMethod: 'Place-value chart' }, teacher)).body.id;
    ids.p2 = (await post('/academics/lesson-plans', { sectionId: secA, subjectId: ids.mat, topicId: ids.t2, plannedDate: shift(1) }, teacher)).body.id;
  });

  it('taught marks the topic done once; a future lesson cannot be taught yet; postponing makes a new plan', async () => {
    expect((await post(`/academics/lesson-plans/${ids.p1}/status`, { status: 'COMPLETED', notes: 'Went well' }, teacher)).body.status).toBe('COMPLETED');
    expect((await post(`/academics/lesson-plans/${ids.p1}/status`, { status: 'COMPLETED' }, teacher)).body.type).toBe('lesson-done');
    expect((await post(`/academics/lesson-plans/${ids.p2}/status`, { status: 'COMPLETED' }, teacher)).body.type).toBe('lesson-future');
    expect((await post(`/academics/lesson-plans/${ids.p2}/status`, { status: 'POSTPONED' }, teacher)).status).toBe(422);
    expect((await post(`/academics/lesson-plans/${ids.p2}/status`, { status: 'POSTPONED', newDate: shift(3), notes: 'Sports day' }, teacher)).body.status).toBe('POSTPONED');
    const v = (await get(`/academics/sections/${secA}/subjects/${ids.mat}/lessons`, teacher)).body;
    expect(v.completion).toEqual({ taught: 1, total: 4, percent: 25 });
    expect(v.plans.map((p: { status: string }) => p.status)).toEqual(['COMPLETED', 'POSTPONED', 'PLANNED']);
    expect(v.units[0].topics[0].taughtOn).toBe(today);
  });

  it('a removed topic leaves the count; the office sees every subject’s progress', async () => {
    await put('/academics/units', { programLevelId: level, subjectId: ids.mat, units: [
      { id: ids.unit1, title: 'Numbers', plannedHours: 12, topics: [{ id: ids.t1, title: 'Place value' }, { id: ids.t2, title: 'Roman numerals' }] },
      { id: ids.unit2, title: 'Fractions', plannedHours: 10, topics: [{ id: ids.t4, title: 'Equivalent fractions' }] },
    ] });
    const p = (await get(`/academics/sections/${secA}/progress`)).body;
    expect(p.subjects.map((x: { subject: { code: string }; taught: number; total: number; upcoming: number; percent: number | null }) => [x.subject.code, x.taught, x.total, x.upcoming, x.percent])).toEqual([['ENG', 0, 1, 0, 0], ['MAT', 1, 3, 1, 33.3]]);
  });
});

describe('AC61 study material', () => {
  it('a teacher adds material for their class; links must be https; a section they do not teach is refused', async () => {
    const base = { programLevelId: level, subjectId: ids.mat, title: 'Place value chart notes' };
    const note = await post('/academics/materials', { ...base, materialType: 'NOTE', body: 'Ones, tens, hundreds, thousands…', topicId: ids.t1 }, teacher);
    expect(note.status).toBe(201);
    ids.note = note.body.id;
    expect((await post('/academics/materials', { ...base, materialType: 'LINK', url: 'http://example.com' }, teacher)).status).toBe(422);
    expect((await post('/academics/materials', { ...base, sectionId: secB, materialType: 'LINK', url: 'https://example.com' }, teacher)).status).toBe(403);
    ids.draft = (await post('/academics/materials', { ...base, title: 'Unfinished worksheet', materialType: 'NOTE', body: 'draft', publish: false }, teacher)).body.id;
    // The office adds a video for section B only.
    ids.forB = (await post('/academics/materials', { ...base, sectionId: secB, title: 'Fractions video', materialType: 'VIDEO', url: 'https://videos.example.org/fractions' })).body.id;
  });

  it('files are uploaded by the teacher and attached; someone else’s file cannot be attached', async () => {
    const up = await http().post(`${API}/academics/materials/files`).set(auth(teacher)).field('programLevelId', level).field('subjectId', ids.mat).attach('file', PDF, 'worksheet.pdf');
    expect(up.status).toBe(201);
    ids.file = up.body.id;
    const adminFile = await http().post(`${API}/academics/materials/files`).set(auth(A.session)).field('programLevelId', level).field('subjectId', ids.mat).attach('file', PDF, 'other.pdf');
    expect((await post('/academics/materials', { programLevelId: level, subjectId: ids.mat, title: 'Not mine', materialType: 'FILE', fileId: adminFile.body.id }, teacher)).status).toBe(404);
    ids.fileMat = (await post('/academics/materials', { programLevelId: level, subjectId: ids.mat, title: 'Worksheet 1 (PDF)', materialType: 'FILE', fileId: ids.file }, teacher)).body.id;
  });

  it('parents see only published material of their child’s class; opening counts once per student', async () => {
    const list = (await get(`/portal/children/${ids.Asha}/materials`, parent)).body.items;
    expect(list.map((m: { id: string }) => m.id).sort()).toEqual([ids.note, ids.fileMat].sort());
    expect((await post(`/portal/children/${ids.Asha}/materials/${ids.forB}/open`, {}, parent)).status).toBe(404);
    expect((await post(`/portal/children/${ids.Asha}/materials/${ids.draft}/open`, {}, parent)).status).toBe(404);
    const o = await post(`/portal/children/${ids.Asha}/materials/${ids.note}/open`, {}, parent);
    expect(o.body).toMatchObject({ materialType: 'NOTE', body: 'Ones, tens, hundreds, thousands…' });
    await post(`/portal/children/${ids.Asha}/materials/${ids.note}/open`, {}, parent);
    const f = await http().get(`${API}/portal/children/${ids.Asha}/materials/${ids.fileMat}/file`).set(auth(parent)).buffer(true);
    expect(f.status).toBe(200);
    expect(f.headers['content-type']).toMatch(/pdf/);
    expect((await http().get(`${API}/portal/children/${ids.Bala}/materials/${ids.fileMat}/file`).set(auth(parent))).status).toBe(404);
    const staff = (await get(`/academics/sections/${secA}/subjects/${ids.mat}/materials`, teacher)).body;
    expect(staff.items.find((m: { id: string }) => m.id === ids.note)).toMatchObject({ viewed: 1, topic: 'Place value' });
    expect(staff.items.find((m: { id: string }) => m.id === ids.fileMat).viewed).toBe(1);
    expect((await get(`/portal/children/${ids.Asha}/materials`, parent)).body.items.find((m: { id: string }) => m.id === ids.note).opened).toBe(true);
    // Taken back to draft → gone from the app.
    await post(`/academics/materials/${ids.fileMat}/state`, { state: 'UNPUBLISH' }, teacher);
    expect((await http().get(`${API}/portal/children/${ids.Asha}/materials/${ids.fileMat}/file`).set(auth(parent))).status).toBe(404);
  });
});

describe('AC62 certificates', () => {
  it('ready-made templates are added once; placeholders are checked', async () => {
    expect((await post('/certificates/templates/defaults', {})).body).toEqual({ added: 6 });
    expect((await post('/certificates/templates/defaults', {})).body).toEqual({ added: 0 });
    expect((await post('/certificates/templates', { certificateType: 'BONAFIDE', name: 'Bad', language: 'en', title: 'Bad', body: 'This certifies {{studentNme}} is a student.' })).status).toBe(422);
    const tpl = (await get('/certificates/templates')).body;
    ids.bonafide = tpl.find((t: { name: string }) => t.name === 'Bonafide certificate').id;
    ids.studyKn = tpl.find((t: { name: string }) => t.name === 'ವ್ಯಾಸಂಗ ಪ್ರಮಾಣಪತ್ರ').id;
  });

  it('issuing fills the template from the record, numbers it gaplessly and gives a code', async () => {
    const a = await post('/certificates', { studentId: ids.Asha, templateId: ids.bonafide, purpose: 'opening a bank account' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'ISSUED' });
    expect(a.body.verificationCode).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    ids.certA = a.body.id;
    ids.codeA = a.body.verificationCode;
    const c = (await get(`/certificates/${ids.certA}`)).body;
    expect(c.body).toMatch(/Asha Test, daughter of Asha Father, is a bonafide student/);
    expect(c.body).toMatch(/purpose of opening a bank account/);
    expect(c.body).not.toMatch(/\{\{/);
    const b = await post('/certificates', { studentId: ids.Bala, templateId: ids.studyKn, purpose: 'ವಿದ್ಯಾರ್ಥಿ ವೇತನ' });
    const n = (x: string) => Number(x.match(/(\d+)$/)![1]);
    expect(n(b.body.certificateNo)).toBe(n(a.body.certificateNo) + 1);
    expect((await get(`/certificates/${b.body.id}`)).body.body).toMatch(/Bala Test ಅವರು/);
  });

  it('the public page confirms a code and shows only the certificate’s face', async () => {
    const v = await http().get(`${API}/public/verify/${ids.codeA}`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ valid: true, status: 'ISSUED', student: 'Asha Test', title: 'Bonafide Certificate', school: 'Ac2A Institution' });
    expect(Object.keys(v.body).sort()).toEqual(['campus', 'cancelledAt', 'certificateNo', 'certificateType', 'issueDate', 'school', 'status', 'student', 'title', 'valid']);
    expect((await http().get(`${API}/public/verify/ABCD-EFGH-JKMN`)).body).toEqual({ valid: false });
    expect((await http().get(`${API}/public/verify/not-a-code`)).body).toEqual({ valid: false });
  });

  it('a template that asks for approval issues only after approval', async () => {
    const tpl = (await get('/certificates/templates')).body.find((t: { name: string }) => t.name === 'Character certificate');
    await put(`/certificates/templates/${tpl.id}`, { certificateType: tpl.certificateType, name: tpl.name, language: tpl.language, title: tpl.title, body: tpl.body, requiresApproval: true });
    const role = await createRole(A.tenantId, 'PRINCIPAL_C', [PERMISSIONS.CERT_READ]);
    const head = await addMember(app, A.session, { label: 'PrincipalC', roleCode: 'PRINCIPAL_C' });
    expect((await post('/approvals/rules', { entityType: 'CERTIFICATE', levelNo: 1, approverRoleId: role })).status).toBe(201);
    const r = await post('/certificates', { studentId: ids.Esha, templateId: tpl.id, purpose: 'sports trials' });
    expect(r.body).toEqual({ id: expect.any(String), status: 'REQUESTED' });
    expect((await get(`/certificates/${r.body.id}`)).body).toMatchObject({ status: 'REQUESTED', certificateNo: null, verificationCode: null });
    const req = (await get('/approvals/inbox', head.session)).body.find((x: { entityType: string }) => x.entityType === 'CERTIFICATE');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, head.session)).status).toBeLessThan(300);
    const after = (await get(`/certificates/${r.body.id}`)).body;
    expect(after.status).toBe('ISSUED');
    expect(after.body).toMatch(/Esha Test, daughter of Esha Father/);
  });

  it('cancelling shows on the public page; issued text can never change', async () => {
    expect((await post(`/certificates/${ids.certA}/cancel`, { reason: 'x' })).status).toBe(422);
    expect((await post(`/certificates/${ids.certA}/cancel`, { reason: 'Issued with the wrong purpose' })).body.status).toBe('CANCELLED');
    expect((await post(`/certificates/${ids.certA}/cancel`, { reason: 'Issued with the wrong purpose' })).body.type).toBe('not-issued');
    expect((await http().get(`${API}/public/verify/${ids.codeA}`)).body).toMatchObject({ valid: true, status: 'CANCELLED', cancelledAt: today });
    const db = appDb();
    try {
      await expect(db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`UPDATE certificates SET body = 'changed' WHERE id = ${ids.certA}::uuid`;
      })).rejects.toThrow(/cannot be changed/);
    } finally { await db.$disconnect(); }
    expect((await get(`/certificates?studentId=${ids.Asha}`)).body.map((c: { status: string }) => c.status)).toEqual(['CANCELLED']);
  });
});

describe('permissions and isolation', () => {
  it('parents and other institutions cannot reach it', async () => {
    expect((await get('/certificates', parent)).status).toBe(403);
    expect((await get(`/certificates/${ids.certA}`, B.session)).status).toBe(404);
    expect((await get(`/academics/sections/${secA}/progress`, B.session)).status).toBe(404);
    expect((await post(`/academics/materials/${ids.note}/state`, { state: 'ARCHIVE' }, B.session)).status).toBe(404);
    expect((await post('/certificates', { studentId: ids.Asha, templateId: ids.bonafide, purpose: 'cross tenant' }, B.session)).status).toBe(404);
  });
});
