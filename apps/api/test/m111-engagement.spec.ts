/**
 * AC63–AC65 engagement I (Phase 11): news feed (audience, approval, one reaction each, hidden
 * comments, reports, media only for those who can see the post); events (audience, limit even when
 * two answer at once, consent, a paid event billed once, calendar); parent-teacher meetings (slots,
 * one family per slot and one meeting per teacher per child — also at the same moment, booking
 * window, own child only, only the slot's teacher records); isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let levels: { id: string }[];
let secA: string;
let secB: string;
let teacher: Session;
let parent: Session;
let parent2: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const tag = Date.now().toString(36);
/** The next Monday–Saturday date at least `n` days ahead (Sundays are the default weekly holiday). */
const workday = (n: number) => { let d = shift(n); while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); return d; };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
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
  A = await createTenant(app, platform, 'EngA');
  B = await createTenant(app, platform, 'EngB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3 })).body;
  levels = sbs.levels;
  const s0 = (await post('/sections', { academicYearId: year, programLevelId: levels[0].id, names: ['A', 'B'], capacity: 40 })).body;
  const l0 = Array.isArray(s0) ? s0 : s0.items ?? s0.sections;
  secA = l0.find((s: { name: string }) => s.name === 'A').id;
  secB = l0.find((s: { name: string }) => s.name === 'B').id;
  await post('/sections', { academicYearId: year, programLevelId: levels[1].id, names: ['A'], capacity: 40 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f, lvl, sec] of [['1', 'Asha', 0, 'A'], ['2', 'Bala', 0, 'B'], ['3', 'Chitra', 1, 'A']] as const) {
    const r: Record<string, string> = { admissionNo: `EN/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: n === '2' ? 'Boy' : 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[lvl].name, section: sec, fatherName: `${f} Father`, parentPhone: `98333000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  ids.mat = (await post('/academics/subjects', { code: 'MAT', name: 'Mathematics', subjectType: 'THEORY' })).body.id;
  ids.eng = (await post('/academics/subjects', { code: 'ENG', name: 'English', subjectType: 'THEORY' })).body.id;
  await put('/academics/syllabus', { programLevelId: levels[0].id, subjects: [{ subjectId: ids.eng, subjectGroup: 'LANGUAGE_1' }, { subjectId: ids.mat, subjectGroup: 'CORE' }] });
  for (const [k, first, g] of [['ravi', 'Ravi', 'MALE'], ['sunita', 'Sunita', 'FEMALE']]) ids[k] = (await post('/staff', { campusId: main, firstName: first, gender: g, employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400) })).body.id;
  await put(`/academics/sections/${secA}/teachers`, { classTeacherId: ids.ravi, subjects: [{ subjectId: ids.mat, employeeIds: [ids.ravi] }, { subjectId: ids.eng, employeeIds: [ids.sunita] }] });
  await put(`/academics/sections/${secB}/teachers`, { subjects: [{ subjectId: ids.eng, employeeIds: [ids.sunita] }] });
  await createRole(A.tenantId, 'ENG_TEACHER', [PERMISSIONS.FEED_READ, PERMISSIONS.FEED_POST, PERMISSIONS.EVENT_READ, PERMISSIONS.PTM_TEACH]);
  const t = await addMember(app, A.session, { label: 'RaviEng', roleCode: 'ENG_TEACHER' });
  teacher = t.session;
  await post(`/staff/${ids.ravi}/user`, { userId: t.userId });
  ids.trip = (await post('/fees/heads', { name: 'Trips', code: 'TRIP', feeType: 'OTHER' })).body.id;
  parent = await parentOf(ids.Asha, `eng.parent.${tag}@test.local`);
  parent2 = await parentOf(ids.Bala, `eng.parent2.${tag}@test.local`);
}, 180_000);
afterAll(() => app?.close());

describe('AC63 news feed', () => {
  it('a teacher’s post waits for approval; parents see only posts for their child', async () => {
    const p = await post('/engagement/feed', { postType: 'NEWS', title: 'Science fair winners', body: 'Our class 1 A won the science fair!', targets: [{ targetType: 'SECTION', targetId: secA }] }, teacher);
    expect(p.body).toMatchObject({ status: 'PENDING_APPROVAL' });
    ids.post = p.body.id;
    expect((await get('/portal/feed', parent)).body.map((x: { id: string }) => x.id)).not.toContain(ids.post);
    expect((await post(`/engagement/feed/${ids.post}/moderate`, { action: 'APPROVE' }, teacher)).status).toBe(403);
    expect((await post(`/engagement/feed/${ids.post}/moderate`, { action: 'APPROVE' })).body.status).toBe('PUBLISHED');
    ids.other = (await post('/engagement/feed', { postType: 'CIRCULAR', title: 'Class 2 picnic', body: 'Class 2 goes to Lalbagh.', targets: [{ targetType: 'LEVEL', targetId: levels[1].id }] })).body.id;
    ids.all = (await post('/engagement/feed', { postType: 'CIRCULAR', title: 'Holiday on Monday', body: 'School is closed on Monday.', targets: [{ targetType: 'ALL' }] })).body.id;
    const seen = (await get('/portal/feed', parent)).body.map((x: { id: string }) => x.id);
    expect(seen).toEqual(expect.arrayContaining([ids.post, ids.all]));
    expect(seen).not.toContain(ids.other);
    expect((await get('/portal/feed', parent2)).body.map((x: { id: string }) => x.id)).toEqual([ids.all]);
    expect((await post('/engagement/feed', { postType: 'NEWS', body: 'No audience', targets: [] })).status).toBe(422);
  });

  it('one reaction per person; comments can be hidden; reports reach moderators', async () => {
    await post(`/portal/feed/${ids.post}/react`, { reaction: 'LIKE' }, parent);
    expect((await post(`/portal/feed/${ids.post}/react`, { reaction: 'LOVE' }, parent)).body).toEqual({ myReaction: 'LOVE', reactionTotal: 1 });
    expect((await post(`/portal/feed/${ids.other}/react`, { reaction: 'LIKE' }, parent)).status).toBe(404);
    const c = (await post(`/portal/feed/${ids.post}/comments`, { comment: 'Well done, children!' }, parent)).body.id;
    const rude = (await post(`/portal/feed/${ids.post}/comments`, { comment: 'Something rude', parentCommentId: c }, parent2)).status;
    expect(rude).toBe(404); // Bala's parent cannot see the section A post
    const r2 = (await post(`/engagement/feed/${ids.post}/comments`, { comment: 'Thank you!', parentCommentId: c }, teacher)).body.id;
    expect((await post(`/engagement/feed/comments/${r2}/hide`, { hide: true })).body.status).toBe('HIDDEN');
    expect((await get(`/portal/feed/${ids.post}/comments`, parent)).body.map((x: { comment: string }) => x.comment)).toEqual(['Well done, children!']);
    expect((await post('/portal/feed/reports', { commentId: c, reason: 'OTHER', details: 'Posted by mistake' }, parent)).status).toBe(201);
    const reps = (await get('/engagement/feed/reports')).body;
    expect(reps).toEqual([expect.objectContaining({ kind: 'COMMENT', text: 'Well done, children!', reason: 'OTHER' })]);
    expect((await post(`/engagement/feed/reports/${reps[0].id}`, { action: 'DISMISS' })).body.status).toBe('DISMISSED');
    expect((await get('/engagement/feed/reports')).body).toEqual([]);
  });

  it('photos and PDFs are served only to those who can see the post', async () => {
    const up = await http().post(`${API}/engagement/feed/files`).set(auth(A.session)).attach('file', PDF, 'circular.pdf');
    expect(up.status).toBe(201);
    const other = await http().post(`${API}/engagement/feed/files`).set(auth(teacher)).attach('file', PDF, 'mine.pdf');
    expect((await post('/engagement/feed', { postType: 'CIRCULAR', body: 'Not my file', fileIds: [other.body.id], targets: [{ targetType: 'ALL' }] })).status).toBe(404);
    const p = (await post('/engagement/feed', { postType: 'CIRCULAR', title: 'Fee circular', body: 'See the attached circular.', fileIds: [up.body.id], targets: [{ targetType: 'LEVEL', targetId: levels[1].id }] })).body.id;
    expect((await http().get(`${API}/portal/feed/${p}/files/${up.body.id}`).set(auth(parent))).status).toBe(404);
    const q = (await post('/engagement/feed', { postType: 'CIRCULAR', title: 'Fee circular', body: 'See the attached circular.', fileIds: [up.body.id], targets: [{ targetType: 'ALL' }] })).body.id;
    const f = await http().get(`${API}/portal/feed/${q}/files/${up.body.id}`).set(auth(parent)).buffer(true);
    expect(f.status).toBe(200);
    expect(f.headers['content-type']).toMatch(/pdf/);
    // Hidden after a report → gone from the feed.
    await post('/portal/feed/reports', { postId: q, reason: 'SPAM' }, parent);
    const rep = (await get('/engagement/feed/reports')).body[0];
    expect((await post(`/engagement/feed/reports/${rep.id}`, { action: 'HIDE' })).body.status).toBe('ACTION_TAKEN');
    expect((await get('/portal/feed', parent)).body.map((x: { id: string }) => x.id)).not.toContain(q);
  });
});

describe('AC64 events and calendar', () => {
  it('a paid trip needs consent and bills the student once', async () => {
    const e = await post('/engagement/events', { campusId: main, title: 'Trip to the planetarium', eventType: 'TRIP', startDate: shift(5), endDate: shift(5), startTime: '09:00', endTime: '14:00', requiresConsent: true, feeHeadId: ids.trip, feeAmount: '250', targets: [{ targetType: 'SECTION', targetId: secA }] });
    expect(e.status).toBe(201);
    ids.trip1 = e.body.id;
    expect((await post('/engagement/events', { title: 'Bad', eventType: 'OTHER', startDate: shift(2), endDate: shift(1), targets: [{ targetType: 'ALL' }] })).status).toBe(422);
    const list = (await get(`/portal/children/${ids.Asha}/events`, parent)).body;
    expect(list.find((x: { id: string }) => x.id === ids.trip1)).toMatchObject({ requiresConsent: true, feeAmount: '250.00', response: null });
    expect((await get(`/portal/children/${ids.Bala}/events`, parent2)).body.map((x: { id: string }) => x.id)).not.toContain(ids.trip1);
    expect((await post(`/portal/children/${ids.Bala}/events/${ids.trip1}`, { going: true }, parent2)).status).toBe(404);
    const r = await post(`/portal/children/${ids.Asha}/events/${ids.trip1}`, { going: true }, parent);
    expect(r.body).toMatchObject({ response: 'GOING', billed: '250.00' });
    expect((await post(`/portal/children/${ids.Asha}/events/${ids.trip1}`, { going: true }, parent)).body.billed).toBeNull();
    expect((await post(`/portal/children/${ids.Asha}/events/${ids.trip1}`, { going: false }, parent)).body.type).toBe('already-billed');
    const acct = (await get(`/fees/students/${ids.Asha}`)).body;
    expect(acct.invoices.filter((i: { description: string }) => i.description.startsWith('Trip to the planetarium'))).toHaveLength(1);
  });

  it('registration never passes the limit, also when two answer at once', async () => {
    const e = (await post('/engagement/events', { campusId: main, title: 'Chess workshop', eventType: 'WORKSHOP', startDate: shift(3), endDate: shift(3), registrationRequired: true, maxParticipants: 1, targets: [{ targetType: 'LEVEL', targetId: levels[0].id }] })).body.id;
    const both = await Promise.all([post(`/engagement/events/${e}/students/${ids.Asha}`, { going: true }), post(`/engagement/events/${e}/students/${ids.Bala}`, { going: true })]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(both.find((x) => x.status === 409)!.body.type).toBe('event-full');
    const v = (await get(`/engagement/events/${e}`)).body;
    expect(v.students.filter((s: { response: string }) => s.response === 'GOING')).toHaveLength(1);
    expect((await post(`/engagement/events/${e}/attendance`, { rows: [{ studentId: ids.Asha, attended: true }] })).body.type).toBe('event-future');
  });

  it('the child’s calendar shows only what reaches the child', async () => {
    const level2 = (await post('/engagement/events', { campusId: main, title: 'Class 2 sports day', eventType: 'SPORTS', startDate: shift(4), endDate: shift(4), targets: [{ targetType: 'LEVEL', targetId: levels[1].id }] })).body.id;
    const cal = (await get(`/portal/children/${ids.Asha}/calendar?from=${today}&to=${shift(30)}`, parent)).body;
    expect(cal.filter((x: { kind: string }) => x.kind === 'EVENT').map((x: { title: string }) => x.title)).toEqual(['Chess workshop', 'Trip to the planetarium']);
    const staff = (await get(`/engagement/calendar?from=${today}&to=${shift(30)}`)).body;
    expect(staff.map((x: { id?: string }) => x.id)).toContain(level2);
    expect((await get(`/engagement/calendar?from=${today}&to=${shift(300)}`)).status).toBe(422);
  });
});

describe('AC65 parent-teacher meetings', () => {
  const opens = new Date(Date.now() - 3600_000).toISOString();
  it('a PTM day makes slots for each class and subject teacher — never on a weekly holiday', async () => {
    const sunday = [...Array(7).keys()].map((i) => shift(i + 2)).find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0)!;
    expect((await post('/engagement/ptm', { campusId: main, title: 'Sunday PTM', ptmDate: sunday, startTime: '10:00', endTime: '11:00', slotMinutes: 10, bookingOpens: opens, bookingCloses: `${shift(1)}T18:00:00+05:30`, programLevelIds: [levels[0].id] })).body.type).toBe('school-closed');
    expect((await post('/engagement/ptm', { campusId: main, title: 'Term 1 PTM', ptmDate: workday(2), startTime: '10:00', endTime: '11:00', slotMinutes: 10, bookingOpens: opens, bookingCloses: `${shift(1)}T18:00:00+05:30`, programLevelIds: [levels[0].id] }, teacher)).status).toBe(403);
    const r = await post('/engagement/ptm', { campusId: main, title: 'Term 1 PTM', ptmDate: workday(2), startTime: '10:00', endTime: '11:00', slotMinutes: 10, bookingOpens: opens, bookingCloses: `${shift(1)}T18:00:00+05:30`, programLevelIds: [levels[0].id] });
    expect(r.body).toMatchObject({ teachers: 2, slots: 12 });
    ids.ptm = r.body.id;
    const v = (await get(`/portal/children/${ids.Asha}/ptm`, parent)).body;
    expect(v).toHaveLength(1);
    expect(v[0].open).toBe(true);
    expect(v[0].teachers.map((x: { name: string; roles: string[]; free: unknown[] }) => [x.name, x.roles, x.free.length]).sort()).toEqual([['Ravi', ['CLASS_TEACHER', 'Mathematics'], 6], ['Sunita', ['English'], 6]]);
  });

  it('one meeting per teacher per child and one family per slot — also at the same moment', async () => {
    const v = (await get(`/portal/children/${ids.Asha}/ptm`, parent)).body[0];
    const ravi = v.teachers.find((x: { name: string }) => x.name === 'Ravi').free;
    const sunita = v.teachers.find((x: { name: string }) => x.name === 'Sunita').free;
    const b = await post(`/portal/children/${ids.Asha}/ptm/book`, { slotId: ravi[0].id }, parent);
    expect(b.status).toBe(201);
    ids.booking = b.body.id;
    expect((await post(`/portal/children/${ids.Asha}/ptm/book`, { slotId: ravi[1].id }, parent)).body.type).toBe('already-booked');
    const two = await Promise.all([post(`/portal/children/${ids.Asha}/ptm/book`, { slotId: sunita[0].id }, parent), post(`/portal/children/${ids.Asha}/ptm/book`, { slotId: sunita[1].id }, parent)]);
    expect(two.map((x) => x.status).sort()).toEqual([201, 409]);
    const taken = two.find((x) => x.status === 201)!;
    const slotTaken = sunita.find((s: { start: string }) => s.start === taken.body.start).id;
    expect((await post(`/portal/children/${ids.Bala}/ptm/book`, { slotId: slotTaken }, parent2)).body.type).toBe('slot-taken');
    // Bala's class teacher is not Ravi: his slots are not Bala's to book.
    expect((await post(`/portal/children/${ids.Bala}/ptm/book`, { slotId: ravi[3].id }, parent2)).status).toBe(404);
    expect((await post(`/portal/children/${ids.Bala}/ptm/book`, { slotId: ravi[3].id }, parent)).status).toBe(404);
  });

  it('booking only inside the window; only the slot’s teacher records; cancelling frees the slot', async () => {
    const later = (await post('/engagement/ptm', { campusId: main, title: 'Term 2 PTM', ptmDate: workday(20), startTime: '10:00', endTime: '10:30', slotMinutes: 15, bookingOpens: `${shift(10)}T09:00:00+05:30`, bookingCloses: `${shift(19)}T18:00:00+05:30`, programLevelIds: [levels[0].id] })).body.id;
    const t2 = (await get(`/portal/children/${ids.Asha}/ptm`, parent)).body.find((x: { id: string }) => x.id === later);
    expect(t2.open).toBe(false);
    expect((await post(`/portal/children/${ids.Asha}/ptm/book`, { slotId: t2.teachers[0].free[0].id }, parent)).body.type).toBe('booking-closed');
    const mine = (await get(`/engagement/ptm/${ids.ptm}`, teacher)).body;
    expect(mine.own).toBe(true);
    expect(mine.teachers.map((x: { name: string; slots: unknown[] }) => [x.name, x.slots.length])).toEqual([['Ravi', 6]]);
    expect((await post(`/engagement/ptm/bookings/${ids.booking}/outcome`, { status: 'ATTENDED' }, teacher)).body.type).toBe('ptm-future');
    const sunitaBooking = (await get(`/engagement/ptm/${ids.ptm}`)).body.teachers.find((x: { name: string }) => x.name === 'Sunita').slots.find((s: { booking: unknown }) => s.booking).booking.id;
    expect((await post(`/engagement/ptm/bookings/${sunitaBooking}/outcome`, { status: 'ATTENDED' }, teacher)).status).toBe(403);
    expect((await post(`/portal/children/${ids.Asha}/ptm/bookings/${ids.booking}/cancel`, {}, parent)).body.status).toBe('CANCELLED');
    const v = (await get(`/portal/children/${ids.Asha}/ptm`, parent)).body.find((x: { id: string }) => x.id === ids.ptm);
    expect(v.teachers.find((x: { name: string }) => x.name === 'Ravi')).toMatchObject({ booking: null });
    expect(v.teachers.find((x: { name: string }) => x.name === 'Ravi').free).toHaveLength(6);
  });
});

describe('isolation', () => {
  it('another institution sees none of it', async () => {
    expect((await get('/engagement/feed', B.session)).body).toEqual([]);
    expect((await get(`/engagement/events/${ids.trip1}`, B.session)).status).toBe(404);
    expect((await get(`/engagement/ptm/${ids.ptm}`, B.session)).status).toBe(404);
    expect((await post(`/engagement/feed/${ids.post}/moderate`, { action: 'HIDE' }, B.session)).status).toBe(404);
  });
});
