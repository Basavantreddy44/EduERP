/**
 * AC1 tenant isolation through the API, AC2 fail-closed RLS at the database,
 * AC4 campus scope, AC7 suspended tenant is read-only.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, PLATFORM_ADMIN, appDb, auth, createTenant, login, setPassword, startApp, Session } from './helpers';

let app: INestApplication;
let platform: Session;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campusA1: string;
let campusA2: string;


beforeAll(async () => {
  app = await startApp();
  platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'Alpha');
  B = await createTenant(app, platform, 'Beta');
  const mk = async (s: Session, code: string) => {
    const res = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(s)).send({ code, name: `Campus ${code}`, campusType: 'SCHOOL' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  campusA1 = await mk(A.session, 'A1');
  campusA2 = await mk(A.session, 'A2');
  await mk(B.session, 'B1');
});

afterAll(async () => {
  await app.close();
});

describe('AC1 tenant isolation (API)', () => {
  it('each tenant lists only its own campuses', async () => {
    const a = await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(A.session));
    const b = await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(B.session));
    expect(a.body.map((c: { code: string }) => c.code).sort()).toEqual(['A1', 'A2']);
    expect(b.body.map((c: { code: string }) => c.code)).toEqual(['B1']);
  });

  it('reading or updating another tenant campus by id returns 404', async () => {
    const get = await request(app.getHttpServer()).get(`${API}/campuses/${campusA1}`).set(auth(B.session));
    expect(get.status).toBe(404);
    const patch = await request(app.getHttpServer()).patch(`${API}/campuses/${campusA1}`).set(auth(B.session)).send({ name: 'Hacked' });
    expect(patch.status).toBe(404);
  });

  it('users and audit logs are tenant-scoped', async () => {
    const users = await request(app.getHttpServer()).get(`${API}/users`).set(auth(B.session));
    expect(users.body.map((u: { email: string }) => u.email)).toEqual([B.admin.email]);
    const audit = await request(app.getHttpServer()).get(`${API}/audit-logs?pageSize=100`).set(auth(B.session));
    expect(audit.status).toBe(200);
    expect(audit.body.items.every((r: { tenantId: string }) => r.tenantId === B.tenantId)).toBe(true);
    expect(audit.body.items.some((r: { entityId: string }) => r.entityId === campusA1)).toBe(false);
  });

  it('a tenant id smuggled in the body is ignored (tenant comes from the token)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/campuses`)
      .set(auth(B.session))
      .send({ code: 'SMUGGLE', name: 'Smuggled', campusType: 'SCHOOL', tenantId: A.tenantId });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(B.tenantId);
  });
});

describe('AC2 RLS fails closed at the database (runtime role)', () => {
  const db = appDb();
  afterAll(() => db.$disconnect());

  it('without app.tenant_id the runtime role reads 0 rows from every tenant table', async () => {
    expect(await db.campus.count()).toBe(0);
    expect(await db.role.count()).toBe(0);
    expect(await db.rolePermission.count()).toBe(0);
    expect(await db.userRole.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.userTenant.count()).toBe(0);
    expect(await db.tenant.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it('with tenant A context only A rows are visible, and writing a B row is rejected', async () => {
    const visible = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
      return tx.campus.findMany({ select: { tenantId: true } });
    });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((c) => c.tenantId === A.tenantId)).toBe(true);

    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.campus.create({ data: { tenantId: B.tenantId, code: 'XB', name: 'cross', campusType: 'SCHOOL' } });
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cross-tenant references are impossible (composite FK)', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${B.tenantId}, true)`;
        const role = await tx.role.findFirstOrThrow({ where: { code: 'CAMPUS_VIEWER' } });
        const me = await tx.userTenant.findFirstOrThrow();
        // campus of tenant A referenced from a tenant B row
        await tx.userRole.create({ data: { tenantId: B.tenantId, userId: me.userId, roleId: role.id, campusId: campusA1 } });
      }),
    ).rejects.toThrow();
  });

  it('audit_logs are append-only for the runtime role', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`UPDATE audit_logs SET reason = 'tampered'`;
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${A.tenantId}, true)`;
        await tx.$executeRaw`DELETE FROM audit_logs`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('AC4 campus scope', () => {
  let viewer: Session;
  beforeAll(async () => {
    const email = `viewer.${Date.now()}@test.local`;
    const inv = await request(app.getHttpServer())
      .post(`${API}/users/invite`)
      .set(auth(A.session))
      .send({ fullName: 'Campus Viewer', email, roleCode: 'CAMPUS_VIEWER', campusId: campusA1 });
    expect(inv.status).toBe(201);
    await setPassword(email, 'Viewer@Test12345');
    viewer = await login(app, email, 'Viewer@Test12345');
  });

  it('lists only the assigned campus', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(viewer));
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([campusA1]);
  });

  it('cannot read an unassigned campus of the same tenant (404)', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/campuses/${campusA2}`).set(auth(viewer));
    expect(res.status).toBe(404);
  });

  it('cannot create or update campuses (403)', async () => {
    const c = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(viewer)).send({ code: 'V1', name: 'No', campusType: 'SCHOOL' });
    expect(c.status).toBe(403);
    const u = await request(app.getHttpServer()).patch(`${API}/campuses/${campusA1}`).set(auth(viewer)).send({ name: 'No' });
    expect(u.status).toBe(403);
  });

  it('/me/permissions reports the campus limit for the web menus', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/me/permissions`).set(auth(viewer));
    // CAMPUS_VIEWER: read campuses and academic setup, both limited to the assigned campus.
    expect(res.body.permissions).toEqual([
      { code: 'org.academic.read', allCampuses: false, campusIds: [campusA1] },
      { code: 'org.campus.read', allCampuses: false, campusIds: [campusA1] },
    ]);
  });
});

describe('AC7 suspended tenant is read-only', () => {
  it('reads work, writes are refused, and reactivation restores writes', async () => {
    const s = await request(app.getHttpServer())
      .patch(`${API}/platform/tenants/${B.tenantId}/status`)
      .set(auth(platform))
      .send({ status: 'SUSPENDED', reason: 'Subscription unpaid' });
    expect(s.status).toBe(200);

    expect((await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(B.session))).status).toBe(200);
    const w = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(B.session)).send({ code: 'B9', name: 'Campus Nine', campusType: 'SCHOOL' });
    expect(w.status).toBe(403);
    expect(w.body.type).toBe('tenant-read-only');

    const r = await request(app.getHttpServer()).patch(`${API}/platform/tenants/${B.tenantId}/status`).set(auth(platform)).send({ status: 'ACTIVE', reason: 'Paid' });
    expect(r.status).toBe(200);
    const w2 = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(B.session)).send({ code: 'B9', name: 'Campus Nine', campusType: 'SCHOOL' });
    expect(w2.status).toBe(201);
  });

  it('a tenant admin cannot call platform routes', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/platform/tenants`).set(auth(A.session));
    expect(res.status).toBe(403);
  });
});
