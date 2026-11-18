/**
 * AC66–AC69 engagement II (Phase 12): staff meetings & committees (only invitees answer and see the
 * minutes, approved minutes never change, action owners update their items); complaints (a parent sees
 * only their own and never internal notes, sensitive ones only for those allowed, gapless numbers,
 * escalated once); front office (a child leaves early only with a guardian on record or after someone
 * else approves, out once and back once, only the last 4 of an ID kept); department requests (approval
 * first when needed, assignment inside the handling department, only the requester closes); isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { IMPORT_TYPES, PERMISSIONS } from '@eduerp/shared';
import { ComplaintsService } from '../src/modules/engagement/complaints.service';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, setPassword, startApp, switchTenant, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let ravi: Session;
let sunita: Session;
let kiran: Session;
let parent: Session;
let parent2: Session;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const tag = Date.now().toString(36);
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
  A = await createTenant(app, platform, 'Eng2A');
  B = await createTenant(app, platform, 'Eng2B');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  const start = `${shift(-100).slice(0, 7)}-01`;
  const e = new Date(Date.parse(`${start}T00:00:00Z`)); e.setUTCMonth(e.getUTCMonth() + 12); e.setUTCDate(0);
  const year = (await post('/academic-years', { name: `${start.slice(0, 4)}-${e.toISOString().slice(2, 4)}`, startDate: start, endDate: e.toISOString().slice(0, 10), makeCurrent: true })).body.id;
  const sbs = (await post('/programs', { campusId: main, name: 'State Board School', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2 })).body;
  await post('/sections', { academicYearId: year, programLevelId: sbs.levels[0].id, names: ['A'], capacity: 40 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => c.header));
  for (const [n, f] of [['1', 'Asha'], ['2', 'Bala']] as const) {
    const r: Record<string, string> = { admissionNo: `EN2/${n}`, firstName: f, lastName: 'Test', dob: '2014-01-01', gender: n === '2' ? 'Boy' : 'Girl', admissionDate: start, campusCode: 'MAIN', programCode: 'SBS', className: sbs.levels[0].name, section: 'A', fatherName: `${f} Father`, parentPhone: `98444000${n}0`, rollNo: n };
    ws.addRow(IMPORT_TYPES.STUDENTS.columns.map((c) => r[c.key] ?? ''));
  }
  const job = await http().post(`${API}/imports/STUDENTS`).set(auth(A.session)).attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 's.xlsx');
  await post(`/imports/jobs/${job.body.id}/commit`, {});
  for (const s of (await get('/students?pageSize=100')).body.items) ids[s.firstName] = s.id;
  ids.acad = (await post('/departments', { campusId: main, name: 'Academics', code: 'ACAD', deptType: 'ACADEMIC' })).body.id;
  ids.office = (await post('/departments', { campusId: main, name: 'Office', code: 'OFF', deptType: 'ADMIN' })).body.id;
  await createRole(A.tenantId, 'P12_STAFF', [PERMISSIONS.MEETING_ATTEND, PERMISSIONS.GRIEVANCE_RAISE, PERMISSIONS.GRIEVANCE_HANDLE, PERMISSIONS.DEPT_REQ_RAISE, PERMISSIONS.DEPT_REQ_HANDLE, PERMISSIONS.FRONT_DESK]);
  const people: [string, string, string][] = [['ravi', 'Ravi', ids.acad], ['kiran', 'Kiran', ids.acad], ['sunita', 'Sunita', ids.office]];
  const sessions: Record<string, Session> = {};
  for (const [k, first, dept] of people) {
    ids[k] = (await post('/staff', { campusId: main, firstName: first, gender: k === 'sunita' ? 'FEMALE' : 'MALE', employeeType: 'TEACHING', designation: 'Teacher', joiningDate: shift(-400), departmentId: dept })).body.id;
    const m = await addMember(app, A.session, { label: `${first}P12`, roleCode: 'P12_STAFF' });
    expect((await post(`/staff/${ids[k]}/user`, { userId: m.userId })).status).toBeLessThan(300);
    sessions[k] = m.session;
  }
  ({ ravi, kiran, sunita } = sessions as { ravi: Session; kiran: Session; sunita: Session });
  parent = await parentOf(ids.Asha, `eng2.parent.${tag}@test.local`);
  parent2 = await parentOf(ids.Bala, `eng2.parent2.${tag}@test.local`);
}, 180_000);
afterAll(() => app?.close());

describe('AC66 meetings', () => {
  it('only invitees answer; others do not even see the meeting', async () => {
    const m = await post('/meetings', { meetingType: 'STAFF', title: 'Sports day planning', startAt: at(48), endAt: at(49), employeeIds: [ids.ravi, ids.sunita], agenda: ['Events list', 'Volunteers'] });
    expect(m.body).toEqual({ id: expect.any(String), invitees: 2 });
    ids.future = m.body.id;
    expect((await post(`/meetings/${ids.future}/rsvp`, { accept: true }, ravi)).body).toEqual({ rsvp: 'ACCEPTED' });
    expect((await post(`/meetings/${ids.future}/rsvp`, { accept: true }, kiran)).status).toBe(404);
    expect((await get(`/meetings/${ids.future}`, kiran)).status).toBe(404);
    expect((await get('/meetings', kiran)).body).toEqual([]);
    expect((await post('/meetings', { meetingType: 'STAFF', title: 'Not allowed', startAt: at(48), endAt: at(49), employeeIds: [ids.ravi] }, ravi)).status).toBe(403);
    expect((await get('/meetings', ravi)).body[0]).toMatchObject({ title: 'Sports day planning', invited: 2, accepted: 1, myRsvp: 'ACCEPTED' });
  });

  it('the secretary writes the minutes, the chair approves them, then they never change', async () => {
    ids.committee = (await post('/meetings/committees', { name: 'Discipline committee', members: [{ employeeId: ids.ravi, memberRole: 'CHAIR' }, { employeeId: ids.sunita, memberRole: 'SECRETARY' }] })).body.id;
    expect((await post('/meetings/committees', { name: 'Two chairs', members: [{ employeeId: ids.ravi, memberRole: 'CHAIR' }, { employeeId: ids.sunita, memberRole: 'CHAIR' }] })).status).toBe(422);
    ids.past = (await post('/meetings', { meetingType: 'COMMITTEE', committeeId: ids.committee, title: 'Term review', startAt: at(-3), endAt: at(-2) })).body.id;
    expect((await post(`/meetings/${ids.past}/minutes`, { minutesText: 'Ravi tried to write these.' }, ravi)).status).toBe(403);
    expect((await post(`/meetings/${ids.past}/minutes`, { minutesText: 'Discussed late coming; agreed on a reminder letter.' }, sunita)).status).toBe(200);
    expect((await get(`/meetings/${ids.past}`, ravi)).body.minutes).toBeNull(); // draft: only the writers see it
    expect((await post(`/meetings/${ids.past}/minutes/approve`, {}, ravi)).status).toBe(409); // not circulated yet
    expect((await post(`/meetings/${ids.past}/minutes/circulate`, {}, sunita)).status).toBe(200);
    expect((await post(`/meetings/${ids.past}/minutes/approve`, {}, sunita)).status).toBe(403); // the chair approves
    expect((await post(`/meetings/${ids.past}/minutes/approve`, {}, ravi)).status).toBe(200);
    expect((await get(`/meetings/${ids.past}`, ravi)).body.minutes).toMatchObject({ status: 'APPROVED', text: 'Discussed late coming; agreed on a reminder letter.' });
    expect((await post(`/meetings/${ids.past}/minutes`, { minutesText: 'Changed afterwards — must fail.' }, sunita)).status).toBe(409);
    expect((await post(`/meetings/${ids.past}/minutes`, { minutesText: 'Changed afterwards — must fail.' })).status).toBe(409);
    expect((await get(`/meetings/${ids.past}`, kiran)).status).toBe(404);
  });

  it('an action’s owner (or the organiser) updates it; only the organiser cancels', async () => {
    ids.action = (await post(`/meetings/${ids.past}/actions`, { description: 'Send the reminder letter', ownerEmployeeId: ids.ravi, dueDate: shift(5) }, sunita)).body.id;
    expect((await get('/meetings/my-actions', ravi)).body).toEqual([expect.objectContaining({ description: 'Send the reminder letter', status: 'OPEN', overdue: false })]);
    expect((await post(`/meetings/actions/${ids.action}/status`, { status: 'DONE' }, kiran)).status).toBe(403);
    expect((await post(`/meetings/actions/${ids.action}/status`, { status: 'CANCELLED' }, ravi)).status).toBe(403);
    expect((await post(`/meetings/actions/${ids.action}/status`, { status: 'DONE', note: 'Posted on Monday' }, ravi)).body).toEqual({ id: ids.action, status: 'DONE' });
    expect((await get('/meetings/my-actions', ravi)).body).toEqual([]);
  });

  it('isolation: another institution sees nothing', async () => {
    expect((await get(`/meetings/${ids.past}`, B.session)).status).toBe(404);
    expect((await get('/meetings', B.session)).body).toEqual([]);
    expect((await get('/meetings/committees', B.session)).body).toEqual([]);
  });
});

describe('AC67 complaints', () => {
  it('a parent complains only about their own child and follows only their own complaints', async () => {
    ids.catT = (await post('/complaints/categories', { name: 'Transport', defaultEmployeeId: ids.sunita, slaHours: 24 })).body.id;
    ids.catH = (await post('/complaints/categories', { name: 'Harassment', slaHours: 12, isSensitive: true })).body.id;
    expect((await get('/portal/complaints/categories', parent)).body.map((c: { name: string }) => c.name)).toEqual(['Harassment', 'Transport']);
    const c = await post('/portal/complaints', { categoryId: ids.catT, studentId: ids.Asha, subject: 'Bus comes late', description: 'The bus has been 20 minutes late all week.' }, parent);
    expect(c.status).toBe(201);
    ids.cT = c.body.id;
    expect((await post('/portal/complaints', { categoryId: ids.catT, studentId: ids.Bala, subject: 'Not my child', description: 'This should never be accepted.' }, parent)).status).toBe(404);
    expect((await get(`/portal/complaints/${ids.cT}`, parent2)).status).toBe(404);
    expect((await get('/portal/complaints', parent2)).body).toEqual([]);
    expect((await get('/portal/complaints', parent)).body).toEqual([expect.objectContaining({ id: ids.cT, status: 'OPEN', subject: 'Bus comes late' })]);
  });

  it('internal notes never reach the parent; the parent closes with a rating', async () => {
    expect((await get('/complaints', sunita)).body.map((x: { id: string }) => x.id)).toEqual([ids.cT]);
    expect((await get(`/complaints/${ids.cT}`, kiran)).status).toBe(404);
    expect((await post(`/complaints/${ids.cT}/updates`, { message: 'Driver says traffic at the junction', isInternal: true, status: 'IN_PROGRESS' }, sunita)).body.status).toBe('IN_PROGRESS');
    expect((await post(`/complaints/${ids.cT}/updates`, { message: 'Bus timing moved 15 minutes earlier', status: 'RESOLVED' }, sunita)).body.status).toBe('RESOLVED');
    expect((await post(`/complaints/${ids.cT}/updates`, { message: 'Reassign', assignToEmployeeId: ids.kiran }, sunita)).status).toBe(403);
    const seen = (await get(`/portal/complaints/${ids.cT}`, parent)).body;
    expect(JSON.stringify(seen)).not.toMatch(/Driver says traffic/);
    expect(seen.updates.map((u: { message: string | null }) => u.message)).toContain('Bus timing moved 15 minutes earlier');
    expect((await get(`/complaints/${ids.cT}`, sunita)).body.updates.map((u: { message: string | null }) => u.message)).toContain('Driver says traffic at the junction');
    expect((await post(`/portal/complaints/${ids.cT}/close`, { close: true }, parent)).status).toBe(422); // a rating is needed
    expect((await post(`/portal/complaints/${ids.cT}/close`, { close: true, rating: 4 }, parent2)).status).toBe(404);
    expect((await post(`/portal/complaints/${ids.cT}/close`, { close: true, rating: 4 }, parent)).body).toEqual({ id: ids.cT, status: 'CLOSED' });
    expect((await post(`/complaints/${ids.cT}/updates`, { message: 'Too late' }, sunita)).status).toBe(409);
  });

  it('sensitive complaints are seen only by those allowed', async () => {
    ids.cH = (await post('/portal/complaints', { categoryId: ids.catH, studentId: ids.Asha, subject: 'Teasing in class', description: 'Older children tease my daughter daily.' }, parent)).body.id;
    await createRole(A.tenantId, 'P12_GMGR', [PERMISSIONS.GRIEVANCE_MANAGE]);
    const mgr = (await addMember(app, A.session, { label: 'GrievMgr', roleCode: 'P12_GMGR' })).session;
    expect((await get('/complaints?filter=ALL', mgr)).body.map((x: { id: string }) => x.id)).toEqual([ids.cT]);
    expect((await get(`/complaints/${ids.cH}`, mgr)).status).toBe(404);
    expect((await get(`/complaints/${ids.cH}`)).body.complaint).toMatchObject({ subject: 'Teasing in class', status: 'OPEN' });
  });

  it('numbers are gapless even when raised at the same moment', async () => {
    const r = await Promise.all([1, 2, 3].map((n) => post('/complaints', { categoryId: ids.catT, subject: `Staff room fan ${n}`, description: 'The fan in the staff room is broken.' }, ravi)));
    expect(r.map((x) => x.status)).toEqual([201, 201, 201]);
    const all = [...(await get('/complaints?filter=ALL')).body].map((x: { complaintNo: string }) => Number(x.complaintNo.split('/').pop()));
    expect(all.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect((await get('/complaints?filter=MINE', ravi)).body).toHaveLength(3);
  });

  it('an overdue complaint is escalated once, and the note stays internal', async () => {
    const db = ownerDb();
    await db.complaint.update({ where: { id: ids.cH }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await db.$disconnect();
    const svc = app.get(ComplaintsService);
    await svc.escalateAll();
    await svc.escalateAll();
    const v = (await get(`/complaints/${ids.cH}`)).body;
    expect(v.complaint.escalated).toBe(true);
    expect(v.updates.filter((u: { type: string }) => u.type === 'ESCALATION')).toHaveLength(1);
    expect((await get(`/portal/complaints/${ids.cH}`, parent)).body.updates.some((u: { type: string }) => u.type === 'ESCALATION')).toBe(false);
  });

  it('isolation', async () => {
    expect((await get(`/complaints/${ids.cT}`, B.session)).status).toBe(404);
    expect((await get('/complaints?filter=ALL', B.session)).body).toEqual([]);
  });
});

describe('AC68 front office', () => {
  it('visitors: only the last 4 of an ID; out once', async () => {
    expect((await get('/front-office/campuses', sunita)).body).toEqual([{ id: main, name: 'Main School' }]); // desk staff need no campus-admin rights
    expect((await get('/front-office/staff', sunita)).body.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['Ravi', 'Sunita']));
    const find = async (q: string) => (await get(`/front-office/students?campusId=${main}&q=${encodeURIComponent(q)}`, sunita)).body.map((s: { name: string }) => s.name);
    expect(await find('Ash')).toEqual(['Asha Test']);
    expect(await find('test bala')).toEqual(['Bala Test']); // every word must match
    expect(await find('EN2/2')).toEqual(['Bala Test']);
    expect((await post('/front-office/visitors', { campusId: main, visitorName: 'Meena Rao', phone: '9845012345', idProofType: 'AADHAAR', idProofLast4: '123456789012', purpose: 'PARENT_VISIT' }, sunita)).status).toBe(422);
    const v = await post('/front-office/visitors', { campusId: main, visitorName: 'Meena Rao', phone: '9845012345', idProofType: 'AADHAAR', idProofLast4: '9012', purpose: 'PARENT_VISIT', studentId: ids.Asha }, sunita);
    expect(v.body).toEqual({ id: expect.any(String), passNo: expect.stringMatching(/^VP\//) });
    const list = (await get(`/front-office/visitors?campusId=${main}&date=${today}`, sunita)).body;
    expect(list).toEqual([expect.objectContaining({ visitorName: 'Meena Rao', idProofLast4: '9012', student: 'Asha Test', outTime: null })]);
    expect((await post(`/front-office/visitors/${v.body.id}/out`, {}, sunita)).status).toBe(200);
    expect((await post(`/front-office/visitors/${v.body.id}/out`, {}, sunita)).status).toBe(409);
    expect((await post(`/front-office/visitors/${v.body.id}/out`, {}, B.session)).status).toBe(404);
    expect((await get(`/front-office/visitors?campusId=${main}&date=${today}`, ravi)).status).toBe(200); // desk role
    expect((await get(`/front-office/visitors?campusId=${main}&date=${today}`, parent)).status).toBe(403);
  });

  it('a guardian on record collects at once; the pass goes out once and back once', async () => {
    const gs = (await get(`/front-office/students/${ids.Asha}/guardians`, sunita)).body;
    expect(gs).toEqual([expect.objectContaining({ name: 'Asha Father' })]);
    const other = (await get(`/front-office/students/${ids.Bala}/guardians`, sunita)).body[0].id;
    expect((await post('/front-office/gate-passes', { campusId: main, passType: 'STUDENT', studentId: ids.Asha, reason: 'Doctor visit', pickupGuardianId: other }, sunita)).status).toBe(422);
    const g = await post('/front-office/gate-passes', { campusId: main, passType: 'STUDENT', studentId: ids.Asha, reason: 'Doctor visit', pickupGuardianId: gs[0].id }, sunita);
    expect(g.body).toMatchObject({ status: 'APPROVED', passNo: expect.stringMatching(/^GP\//) });
    expect((await post(`/front-office/gate-passes/${g.body.id}/return`, {}, sunita)).status).toBe(409);
    expect((await post(`/front-office/gate-passes/${g.body.id}/out`, {}, sunita)).body.status).toBe('OUT');
    expect((await post(`/front-office/gate-passes/${g.body.id}/out`, {}, sunita)).status).toBe(409);
    expect((await post(`/front-office/gate-passes/${g.body.id}/return`, {}, sunita)).body.status).toBe('RETURNED');
    expect((await post(`/front-office/gate-passes/${g.body.id}/return`, {}, sunita)).status).toBe(409);
  });

  it('anyone else needs approval — by someone other than the requester', async () => {
    const g = (await post('/front-office/gate-passes', { campusId: main, passType: 'STUDENT', studentId: ids.Asha, reason: 'Family function', pickupPersonName: 'Uncle Mohan', pickupPersonPhone: '9845099999' }, sunita)).body;
    expect(g.status).toBe('REQUESTED');
    expect((await post(`/front-office/gate-passes/${g.id}/out`, {}, sunita)).status).toBe(409);
    expect((await post(`/front-office/gate-passes/${g.id}/decide`, { approve: true }, sunita)).status).toBe(403);
    expect((await post(`/front-office/gate-passes/${g.id}/decide`, { approve: true })).body.status).toBe('APPROVED');
    expect((await post(`/front-office/gate-passes/${g.id}/decide`, { approve: false })).status).toBe(409);
    expect((await post(`/front-office/gate-passes/${g.id}/out`, {}, sunita)).body.status).toBe('OUT');
    const own = (await post('/front-office/gate-passes', { campusId: main, passType: 'STAFF', employeeId: ids.kiran, reason: 'Bank work' })).body;
    expect(own.status).toBe('REQUESTED');
    expect((await post(`/front-office/gate-passes/${own.id}/decide`, { approve: true })).status).toBe(403);
    expect((await post('/front-office/gate-passes', { campusId: main, passType: 'STUDENT', studentId: ids.Asha, reason: 'Nobody named' }, sunita)).status).toBe(422);
  });

  it('calls and post; isolation', async () => {
    const c = (await post('/front-office/calls', { campusId: main, callType: 'INCOMING', callerName: 'Ramesh', phone: '9845011111', purpose: 'Admission enquiry for Class 1', followUpDate: shift(1) }, sunita)).body.id;
    expect((await post(`/front-office/calls/${c}/done`, {}, sunita)).body.followUpDone).toBe(true);
    const p = (await post('/front-office/postal', { campusId: main, direction: 'INWARD', fromParty: 'Education Department', toParty: 'Principal', courierName: 'India Post', addressedToEmployeeId: ids.ravi }, sunita)).body.id;
    expect((await get(`/front-office/postal?campusId=${main}`, sunita)).body).toEqual([expect.objectContaining({ id: p, addressedTo: 'Ravi', handedOverAt: null })]);
    expect((await post(`/front-office/postal/${p}/handed-over`, {}, sunita)).status).toBe(200);
    expect((await post(`/front-office/postal/${p}/handed-over`, {}, sunita)).status).toBe(409);
    expect((await post(`/front-office/postal/${p}/handed-over`, {}, B.session)).status).toBe(404);
    expect((await get(`/front-office/calls?campusId=${main}`, B.session)).body).toEqual([]);
  });
});

describe('AC69 department requests', () => {
  it('assignment only inside the handling department; only the requester closes', async () => {
    ids.rcRepair = (await post('/dept-requests/categories', { name: 'Projector repair', toDepartmentId: ids.office, slaHours: 48 })).body.id;
    expect((await post('/dept-requests', { campusId: main, fromDepartmentId: ids.office, categoryId: ids.rcRepair, title: 'Own department', description: 'Office to office is not allowed.' }, sunita)).status).toBe(422);
    const r = await post('/dept-requests', { campusId: main, fromDepartmentId: ids.acad, categoryId: ids.rcRepair, title: 'Projector in 1 A', description: 'The projector in Class 1 A does not switch on.', priority: 'HIGH' }, ravi);
    expect(r.body).toMatchObject({ status: 'OPEN', requestNo: expect.stringMatching(/^REQ\//) });
    ids.req = r.body.id;
    expect((await get('/dept-requests?box=dept', sunita)).body.map((x: { id: string }) => x.id)).toEqual([ids.req]);
    expect((await get('/dept-requests?box=dept', ravi)).body).toEqual([]);
    expect((await get(`/dept-requests/${ids.req}`, kiran)).status).toBe(404);
    expect((await post(`/dept-requests/${ids.req}/updates`, { message: 'I will fix it myself' }, ravi)).status).toBe(403);
    expect((await post(`/dept-requests/${ids.req}/updates`, { message: 'Over to Kiran', assignToEmployeeId: ids.kiran }, sunita)).status).toBe(422);
    expect((await post(`/dept-requests/${ids.req}/updates`, { message: 'Taking this', assignToEmployeeId: ids.sunita }, sunita)).body.status).toBe('IN_PROGRESS');
    expect((await post(`/dept-requests/${ids.req}/close`, { accept: true }, ravi)).status).toBe(409);
    expect((await post(`/dept-requests/${ids.req}/updates`, { message: 'Lamp replaced', status: 'COMPLETED' }, sunita)).body.status).toBe('COMPLETED');
    expect((await post(`/dept-requests/${ids.req}/close`, { accept: true }, sunita)).status).toBe(403);
    expect((await post(`/dept-requests/${ids.req}/close`, { accept: false }, ravi)).status).toBe(422); // say what is still needed
    expect((await post(`/dept-requests/${ids.req}/close`, { accept: true }, ravi)).body.status).toBe('CLOSED');
    const d = (await get(`/dept-requests/${ids.req}`, ravi)).body;
    expect(d).toMatchObject({ status: 'CLOSED', assignedTo: 'Sunita', fromDepartment: 'Academics', toDepartment: 'Office' });
    expect(d.updates.map((u: { newStatus: string | null }) => u.newStatus)).toEqual(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']);
  });

  it('a request needing approval is not worked on before approval', async () => {
    const role = await createRole(A.tenantId, 'P12_REQ_APPROVER', [PERMISSIONS.DEPT_REQ_RAISE]);
    const head = await addMember(app, A.session, { label: 'ReqHead', roleCode: 'P12_REQ_APPROVER' });
    expect((await post('/approvals/rules', { entityType: 'DEPT_REQUEST', levelNo: 1, approverRoleId: role })).status).toBe(201);
    const cat = (await post('/dept-requests/categories', { name: 'New furniture', toDepartmentId: ids.office, requiresApproval: true, slaHours: 120 })).body.id;
    const r = (await post('/dept-requests', { campusId: main, fromDepartmentId: ids.acad, categoryId: cat, title: '10 desks for 1 A', description: 'Ten more desks are needed for new admissions.' }, ravi)).body;
    expect(r.status).toBe('PENDING_APPROVAL');
    expect((await post(`/dept-requests/${r.id}/updates`, { message: 'Ordering now', status: 'IN_PROGRESS' }, sunita)).status).toBe(409);
    const req = (await get('/approvals/inbox', head.session)).body.find((x: { entityType: string }) => x.entityType === 'DEPT_REQUEST');
    expect((await post(`/approvals/requests/${req.id}/act`, { action: 'APPROVE' }, head.session)).status).toBeLessThan(300);
    expect((await get(`/dept-requests/${r.id}`, ravi)).body.status).toBe('OPEN');
    expect((await post(`/dept-requests/${r.id}/updates`, { message: 'Ordering now', status: 'IN_PROGRESS' }, sunita)).body.status).toBe('IN_PROGRESS');
  });

  it('isolation', async () => {
    expect((await get(`/dept-requests/${ids.req}`, B.session)).status).toBe(404);
    expect((await get('/dept-requests/categories', B.session)).body).toEqual([]);
  });
});
