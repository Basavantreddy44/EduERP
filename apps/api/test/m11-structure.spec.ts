/** AC23 class structure: boards, programmes with generated levels, sections per year, scope and isolation. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { generateLevelNames } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createRole, createTenant, login, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let year: string;
let closedYear: string;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'StrA');
  B = await createTenant(app, platform, 'StrB');
  main = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'NPU', name: 'North PU College', campusType: 'PU' })).body.id;
  closedYear = (await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2025-26', startDate: '2025-06-01', endDate: '2026-03-31', makeCurrent: false })).body.id;
  year = (await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31', makeCurrent: true })).body.id;
  await http().post(`${API}/academic-years/${closedYear}/make-current`).set(auth(A.session));
  await http().post(`${API}/academic-years/${year}/make-current`).set(auth(A.session));
  await http().post(`${API}/academic-years/${closedYear}/close`).set(auth(A.session));
}, 60_000);
afterAll(() => app?.close());

describe('level names (unit)', () => {
  it('generates school, PU and semester names in promotion order', () => {
    expect(generateLevelNames('SCHOOL', 'Class', 3, 8)).toEqual(['Class 8', 'Class 9', 'Class 10']);
    expect(generateLevelNames('PU', 'PUC', 2)).toEqual(['I PUC', 'II PUC']);
    expect(generateLevelNames('UG', 'Semester', 2)).toEqual(['Semester 1', 'Semester 2']);
  });
});

describe('AC23 class structure', () => {
  let school: { id: string; levels: { id: string; name: string; sequence: number; isFinal: boolean }[] };

  it('adds the common boards once', async () => {
    const first = await http().post(`${API}/boards/common`).set(auth(A.session));
    const again = await http().post(`${API}/boards/common`).set(auth(A.session));
    expect(first.status).toBe(201);
    expect(again.body.length).toBe(first.body.length);
    expect(first.body.map((b: { name: string }) => b.name)).toContain('Karnataka PU Board (DPUE)');
  });

  it('a programme gets its levels in promotion order, the last one final', async () => {
    const boards = (await http().get(`${API}/boards`).set(auth(A.session))).body as { id: string; name: string }[];
    const res = await http().post(`${API}/programs`).set(auth(A.session)).send({
      campusId: main, boardId: boards.find((b) => b.name.startsWith('Karnataka State'))!.id, name: 'State Board School', code: 'sbs', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 10,
    });
    expect(res.status).toBe(201);
    school = res.body;
    expect(res.body.code).toBe('SBS');
    expect(school.levels.map((l) => l.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Class ${i + 1}`));
    expect(school.levels.filter((l) => l.isFinal).map((l) => l.name)).toEqual(['Class 10']);

    const pu = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: north, name: 'PU Science (PCMB)', code: 'PUSC', programType: 'PU', stream: 'SCIENCE', levelLabel: 'PUC', durationLevels: 2 });
    expect(pu.body.levels.map((l: { name: string }) => l.name)).toEqual(['I PUC', 'II PUC']);

    const custom = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: main, name: 'Pre-primary', code: 'PRE', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 3, levelNames: ['Nursery', 'LKG', 'UKG'] });
    expect(custom.body.levels.map((l: { name: string }) => l.name)).toEqual(['Nursery', 'LKG', 'UKG']);
    expect((await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: main, name: 'X', code: 'PRE2', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2, levelNames: ['A'] })).status).toBe(422);
  });

  it('programme codes are unique per campus; class names unique per programme', async () => {
    const dup = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: main, name: 'Another', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 5 });
    expect(dup.status).toBe(409);
    const otherCampus = await http().post(`${API}/programs`).set(auth(A.session)).send({ campusId: north, name: 'Same code elsewhere', code: 'SBS', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 2 });
    expect(otherCampus.status).toBe(201);
    const rename = await http().patch(`${API}/program-levels/${school.levels[0].id}`).set(auth(A.session)).send({ name: 'class 2' });
    expect(rename.status).toBe(409);
  });

  it('sections: per year and class, unique names, capacity, not in a closed year (API and database)', async () => {
    const c5 = school.levels.find((l) => l.name === 'Class 5')!;
    const res = await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: c5.id, names: ['a', 'B', 'C'], capacity: 40 });
    expect(res.status).toBe(201);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['A', 'B', 'C']);
    expect((await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: c5.id, names: ['C', 'D'] })).body.type).toBe('section-exists');
    expect((await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: year, programLevelId: c5.id, names: ['E'], capacity: 0 })).status).toBe(422);

    const closed = await http().post(`${API}/sections`).set(auth(A.session)).send({ academicYearId: closedYear, programLevelId: c5.id, names: ['A'] });
    expect(closed.body.type).toBe('academic-year-closed');
    // The database refuses it too, even if the application forgot to check.
    const db = appDb();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.section.create({ data: { tenantId: A.tenantId, campusId: main, academicYearId: closedYear, programLevelId: c5.id, name: 'Z', capacity: 10 } });
      }),
    ).rejects.toThrow(/academic_year_closed/);
    await db.$disconnect();

    const list = (await http().get(`${API}/sections`).set(auth(A.session))).body as { name: string; level: { name: string } }[]; // current year by default
    expect(list.map((s) => `${s.level.name}-${s.name}`)).toEqual(['Class 5-A', 'Class 5-B', 'Class 5-C']);
  });

  it('campus-limited staff manage only their campus; other institutions see nothing', async () => {
    const roleId = await createRole(A.tenantId, 'NORTH_ADMIN', ['org.academic.read', 'org.academic.manage', 'org.campus.read']);
    expect(roleId).toBeTruthy();
    const northAdmin = await addMember(app, A.session, { label: 'NorthAdmin', roleCode: 'NORTH_ADMIN', campusId: north });
    const progs = (await http().get(`${API}/programs`).set(auth(northAdmin.session))).body as { campusId: string }[];
    expect(progs.every((p) => p.campusId === north)).toBe(true);
    const onMain = await http().post(`${API}/programs`).set(auth(northAdmin.session)).send({ campusId: main, name: 'Sneaky', code: 'SNK', programType: 'SCHOOL', levelLabel: 'Class', durationLevels: 1 });
    expect(onMain.status).toBe(404);

    expect((await http().get(`${API}/programs`).set(auth(B.session))).body).toEqual([]);
    expect((await http().get(`${API}/sections?academicYearId=${year}`).set(auth(B.session))).body).toEqual([]);
  });
});
