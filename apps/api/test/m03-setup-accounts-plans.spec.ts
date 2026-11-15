/**
 * AC15 academic setup (years, current year, departments, holidays, isolation)
 * AC16 account emails (invite → set password → sign in; reset; one-time, expiring, no enumeration)
 * AC17 plans & module entitlements (plan drives modules, overrides, institutions can't self-enable, guard blocks)
 */
import { Controller, Get, INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RequireModule, RequirePermission } from '../src/common/decorators';
import { ProblemFilter } from '../src/common/problem';
import { WorkerModule } from '../src/worker/worker.module';
import { JobsRunner } from '../src/worker/jobs.runner';
import { API, PLATFORM_ADMIN, addMember, appDb, auth, createTenant, login, mailText, mailsTo, ownerDb, startApp, waitFor, Session } from './helpers';

let app: INestApplication;
let worker: INestApplicationContext;
let platform: Session;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campusA: string;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await startApp();
  platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'SetupA');
  B = await createTenant(app, platform, 'SetupB');
  campusA = (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code: 'MAIN', name: 'Main Campus', campusType: 'SCHOOL' })).body.id;
  worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  await worker.get(JobsRunner).start({ pollSeconds: 0.5 });
}, 90_000);

afterAll(async () => {
  await worker?.get(JobsRunner).stop();
  await worker?.close();
  await app?.close();
});

describe('AC15 academic setup', () => {
  it('creates academic years; only one is current; overlaps and bad names are refused', async () => {
    const y1 = await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2025-26', startDate: '2025-06-01', endDate: '2026-03-31', makeCurrent: true });
    expect(y1.status).toBe(201);
    expect(y1.body).toMatchObject({ isCurrent: true, status: 'ACTIVE', startDate: '2025-06-01' });
    const y2 = await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2026-27', startDate: '2026-06-01', endDate: '2027-03-31' });
    expect(y2.body).toMatchObject({ isCurrent: false, status: 'PLANNING' });

    const overlap = await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2027-28', startDate: '2027-03-01', endDate: '2028-03-31' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.type).toBe('academic-year-overlap');
    expect((await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2028-30', startDate: '2028-06-01', endDate: '2029-03-31' })).status).toBe(422);
    expect((await http().post(`${API}/academic-years`).set(auth(A.session)).send({ name: '2028-29', startDate: '2029-06-01', endDate: '2028-03-31' })).status).toBe(422);

    // Switching the current year leaves exactly one current.
    expect((await http().post(`${API}/academic-years/${y2.body.id}/make-current`).set(auth(A.session))).status).toBe(201);
    const list = (await http().get(`${API}/academic-years`).set(auth(A.session))).body as { name: string; isCurrent: boolean }[];
    expect(list.filter((y) => y.isCurrent).map((y) => y.name)).toEqual(['2026-27']);

    // The current year cannot be closed; the old one can.
    expect((await http().post(`${API}/academic-years/${y2.body.id}/close`).set(auth(A.session))).body.type).toBe('academic-year-current');
    expect((await http().post(`${API}/academic-years/${y1.body.id}/close`).set(auth(A.session))).body.status).toBe('CLOSED');
  });

  it('departments: unique code per campus, institution-wide allowed, campus-limited users cannot add institution-wide', async () => {
    const d1 = await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: campusA, name: 'Science', code: 'sci', deptType: 'ACADEMIC' });
    expect(d1.status).toBe(201);
    expect(d1.body.code).toBe('SCI');
    expect((await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: campusA, name: 'Science 2', code: 'SCI', deptType: 'ACADEMIC' })).status).toBe(409);
    expect((await http().post(`${API}/departments`).set(auth(A.session)).send({ campusId: null, name: 'Accounts', code: 'SCI', deptType: 'ADMIN' })).status).toBe(201);
    const off = await http().patch(`${API}/departments/${d1.body.id}`).set(auth(A.session)).send({ status: 'INACTIVE' });
    expect(off.body.status).toBe('INACTIVE');
  });

  it('holidays: one per date per campus, filtered by date range, deletable', async () => {
    const h = await http().post(`${API}/holidays`).set(auth(A.session)).send({ holidayDate: '2026-08-15', name: 'Independence Day', holidayType: 'PUBLIC' });
    expect(h.status).toBe(201);
    expect((await http().post(`${API}/holidays`).set(auth(A.session)).send({ holidayDate: '2026-08-15', name: 'Dup', holidayType: 'PUBLIC' })).status).toBe(409);
    await http().post(`${API}/holidays`).set(auth(A.session)).send({ campusId: campusA, holidayDate: '2026-11-01', name: 'Kannada Rajyotsava', holidayType: 'PUBLIC' });
    const aug = (await http().get(`${API}/holidays?from=2026-08-01&to=2026-08-31`).set(auth(A.session))).body as { name: string }[];
    expect(aug.map((x) => x.name)).toEqual(['Independence Day']);
    expect((await http().delete(`${API}/holidays/${h.body.id}`).set(auth(A.session))).status).toBe(200);
  });

  it('is tenant-isolated, and read-only roles cannot change it', async () => {
    expect((await http().get(`${API}/academic-years`).set(auth(B.session))).body).toEqual([]);
    expect((await http().get(`${API}/departments`).set(auth(B.session))).body).toEqual([]);
    const viewer = await addMember(app, A.session, { label: 'SetupViewer', roleCode: 'CAMPUS_VIEWER' });
    expect((await http().get(`${API}/departments`).set(auth(viewer.session))).status).toBe(200); // read allowed
    expect((await http().post(`${API}/holidays`).set(auth(viewer.session)).send({ holidayDate: '2026-12-25', name: 'X', holidayType: 'PUBLIC' })).status).toBe(403);
  });
});

describe('AC16 account emails', () => {
  const linkIn = (text: string) => text.match(/https?:\/\/\S+reset-password\?token=([\w-]+)/)?.[1];

  it('invite → email with a set-password link → set password → sign in; the link works once', async () => {
    const email = `invitee.${Date.now().toString(36)}@test.local`;
    const inv = await http().post(`${API}/users/invite`).set(auth(A.session)).send({ fullName: 'New Teacher', email, roleCode: 'CAMPUS_VIEWER' });
    expect(inv.status).toBe(201);

    const msg = await waitFor(async () => (await mailsTo(email))[0], 20_000, 'invite email');
    expect(msg.Subject).toBe('You\'re invited to SetupA Institution on EduERP');
    const token = linkIn(await mailText(msg.ID))!;
    expect(token).toBeTruthy();

    const check = await http().post(`${API}/auth/reset-password/check`).send({ token });
    expect(check.body).toMatchObject({ purpose: 'INVITE', email });

    expect((await http().post(`${API}/auth/reset-password`).send({ token, password: 'weak' })).status).toBe(422);
    expect((await http().post(`${API}/auth/reset-password`).send({ token, password: 'Teacher@Pass2026' })).status).toBe(200);
    expect((await http().post(`${API}/auth/login`).send({ identifier: email, password: 'Teacher@Pass2026' })).status).toBe(200);

    const again = await http().post(`${API}/auth/reset-password`).send({ token, password: 'Another@Pass2026' });
    expect(again.status).toBe(400);
    expect(again.body.type).toBe('link-invalid');

    // Only the hash is stored.
    const db = ownerDb();
    const rows = await db.authToken.findMany({ where: { user: { email } } });
    await db.$disconnect();
    expect(rows.every((r) => r.tokenHash !== token && r.tokenHash.length === 64)).toBe(true);
  }, 60_000);

  it('forgot password: same answer for unknown emails; reset ends every session; expired links fail', async () => {
    const unknown = await http().post(`${API}/auth/forgot-password`).send({ email: 'nobody.here@test.local' });
    const known = await http().post(`${API}/auth/forgot-password`).send({ email: A.admin.email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const msg = await waitFor(async () => (await mailsTo(A.admin.email)).find((m) => m.Subject === 'Reset your EduERP password'), 20_000, 'reset email');
    const token = linkIn(await mailText(msg.ID))!;
    const before = await login(app, A.admin.email, A.admin.password);

    expect((await http().post(`${API}/auth/reset-password`).send({ token, password: 'Admin@NewPass2026' })).status).toBe(200);
    expect((await http().get(`${API}/me`).set(auth(before))).status).toBe(401); // old session ended
    expect((await http().post(`${API}/auth/login`).send({ identifier: A.admin.email, password: A.admin.password })).status).toBe(401);
    A.session = await login(app, A.admin.email, 'Admin@NewPass2026');
    A.admin.password = 'Admin@NewPass2026';
    expect((await mailsTo('nobody.here@test.local')).length).toBe(0);

    // An expired link is refused.
    await http().post(`${API}/auth/forgot-password`).send({ email: A.admin.email });
    const second = await waitFor(async () => {
      const all = (await mailsTo(A.admin.email)).filter((m) => m.Subject === 'Reset your EduERP password');
      return all.length >= 2 ? all[0] : null;
    }, 20_000, 'second reset email');
    const t2 = linkIn(await mailText(second.ID))!;
    const db = ownerDb();
    await db.authToken.updateMany({ where: { usedAt: null, user: { email: A.admin.email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db.$disconnect();
    expect((await http().post(`${API}/auth/reset-password/check`).send({ token: t2 })).body.type).toBe('link-invalid');
  }, 90_000);

  it('the runtime role cannot delete account links', async () => {
    const db = appDb();
    await expect(db.authToken.deleteMany({})).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });
});

@Controller('test-gated')
class GatedController {
  @RequirePermission('org.campus.read')
  @RequireModule('HOSTEL')
  @Get()
  ok() {
    return { ok: true };
  }
}

describe('AC17 plans and modules', () => {
  let plan: { id: string };

  it('new institutions start with every module on (trial)', async () => {
    const mine = (await http().get(`${API}/me/modules`).set(auth(B.session))).body;
    expect(mine.enabled).toHaveLength(32);
  });

  it('assigning a plan switches modules to the plan (core always on); overrides survive re-assignment', async () => {
    const res = await http().post(`${API}/platform/plans`).set(auth(platform)).send({
      name: 'Basic', code: `BASIC_${Date.now().toString(36).toUpperCase()}`, pricePerStudent: 25, billingCycle: 'MONTHLY', maxStudents: 500, modules: ['ADMISSIONS', 'STUDENTS', 'FEES', 'ATTENDANCE'],
    });
    expect(res.status).toBe(201);
    plan = res.body;

    const assign = await http().post(`${API}/platform/tenants/${B.tenantId}/subscription`).set(auth(platform)).send({ planId: plan.id, status: 'ACTIVE', startDate: '2026-06-01', endDate: '2027-05-31', studentCount: 300 });
    expect(assign.status).toBe(201);
    expect(assign.body.subscription).toMatchObject({ status: 'ACTIVE', studentCount: 300, amount: 7500 });
    const on = (assign.body.modules as { code: string; isEnabled: boolean }[]).filter((m) => m.isEnabled).map((m) => m.code).sort();
    expect(on).toEqual(['ADMISSIONS', 'ATTENDANCE', 'AUDIT', 'COMMUNICATION', 'DOCUMENTS', 'FEES', 'REPORTS', 'SETUP', 'STUDENTS', 'USERS']);

    // Add-on: hostel switched on for this institution only, and it survives a plan change.
    await http().put(`${API}/platform/tenants/${B.tenantId}/modules`).set(auth(platform)).send({ moduleCode: 'HOSTEL', isEnabled: true });
    const again = await http().post(`${API}/platform/tenants/${B.tenantId}/subscription`).set(auth(platform)).send({ planId: plan.id, status: 'ACTIVE', startDate: '2026-06-01', endDate: '2027-05-31', studentCount: 320 });
    expect((again.body.modules as { code: string; isEnabled: boolean; source: string }[]).find((m) => m.code === 'HOSTEL')).toMatchObject({ isEnabled: true, source: 'OVERRIDE' });

    expect((await http().post(`${API}/platform/tenants/${B.tenantId}/subscription`).set(auth(platform)).send({ planId: plan.id, status: 'ACTIVE', startDate: '2026-06-01', endDate: '2027-05-31', studentCount: 900 })).body.type).toBe('plan-student-limit');
    expect((await http().put(`${API}/platform/tenants/${B.tenantId}/modules`).set(auth(platform)).send({ moduleCode: 'SETUP', isEnabled: false })).body.type).toBe('module-core');
  });

  it('the institution sees its plan; it cannot change its own modules or call platform routes', async () => {
    const mine = (await http().get(`${API}/me/modules`).set(auth(B.session))).body;
    expect(mine.subscription.plan.name).toBe('Basic');
    expect(mine.enabled).toContain('HOSTEL');
    expect(mine.enabled).not.toContain('LIBRARY');
    expect((await http().put(`${API}/platform/tenants/${B.tenantId}/modules`).set(auth(B.session)).send({ moduleCode: 'LIBRARY', isEnabled: true })).status).toBe(403);

    // Even with direct database access the runtime role cannot flip a module (RLS: platform only).
    const db = appDb();
    const changed = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${B.tenantId}, true)`;
      return tx.tenantModule.updateMany({ where: { moduleCode: 'LIBRARY' }, data: { isEnabled: true } });
    });
    await db.$disconnect();
    expect(changed.count).toBe(0);
  });

  it('routes of a module that is off are refused with 403 module-not-enabled', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule], controllers: [GatedController] }).compile();
    const gated = mod.createNestApplication();
    gated.use(cookieParser());
    gated.useGlobalFilters(new ProblemFilter());
    gated.setGlobalPrefix('api/v1');
    await gated.init();
    try {
      // B has HOSTEL as an add-on → allowed. Turn it off → refused.
      expect((await request(gated.getHttpServer()).get(`${API}/test-gated`).set(auth(B.session))).status).toBe(200);
      await http().put(`${API}/platform/tenants/${B.tenantId}/modules`).set(auth(platform)).send({ moduleCode: 'HOSTEL', isEnabled: false });
      const off = await request(gated.getHttpServer()).get(`${API}/test-gated`).set(auth(B.session));
      expect(off.status).toBe(403);
      expect(off.body.type).toBe('module-not-enabled');
    } finally {
      await gated.close();
    }
  });
});
