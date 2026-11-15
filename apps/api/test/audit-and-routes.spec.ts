/** AC5 audit row in the same transaction (rollback test); AC6 every route declares an access rule. */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ACCESS_KEY } from '../src/common/decorators';
import { Db } from '../src/common/prisma.service';
import { AuditService } from '../src/common/audit.service';
import { API, PLATFORM_ADMIN, auth, createTenant, login, ownerDb, startApp } from './helpers';

describe('AC6 route access rules', () => {
  it('every controller handler carries @Public/@Authenticated/@PlatformRoute/@TenantMember/@RequirePermission', () => {
    const controllers: (new (...a: never[]) => unknown)[] = Reflect.getMetadata('controllers', AppModule);
    const missing: string[] = [];
    let routes = 0;
    for (const ctrl of controllers) {
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = (ctrl.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes += 1;
        if (!Reflect.getMetadata(ACCESS_KEY, handler) && !Reflect.getMetadata(ACCESS_KEY, ctrl)) missing.push(`${ctrl.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});

describe('AC5 audit is transactional', () => {
  let app: INestApplication;
  let tenant: Awaited<ReturnType<typeof createTenant>>;

  beforeAll(async () => {
    app = await startApp();
    const platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
    tenant = await createTenant(app, platform, 'Epsilon');
  });
  afterAll(() => app.close());

  const counts = async () => {
    const db = ownerDb();
    const r = { campuses: await db.campus.count({ where: { tenantId: tenant.tenantId } }), audits: await db.auditLog.count({ where: { tenantId: tenant.tenantId } }) };
    await db.$disconnect();
    return r;
  };

  it('a successful create writes exactly one audit row with the new values', async () => {
    const before = await counts();
    const res = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(tenant.session)).send({ code: 'E1', name: 'Epsilon One', campusType: 'DEGREE' });
    expect(res.status).toBe(201);
    const after = await counts();
    expect(after.campuses - before.campuses).toBe(1);
    expect(after.audits - before.audits).toBe(1);
    const db = ownerDb();
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: res.body.id } });
    await db.$disconnect();
    expect(row).toMatchObject({ action: 'CREATE', entityType: 'CAMPUS', campusId: res.body.id });
    expect((row.newValues as { code: string }).code).toBe('E1');
    expect(row.requestId).toBeTruthy();
  });

  it('a failure after the audit write rolls back BOTH the change and the audit row', async () => {
    const db = app.get(Db);
    const audit = app.get(AuditService);
    const before = await counts();
    await expect(
      db.run({ tenantId: tenant.tenantId }, async (tx) => {
        const c = await tx.campus.create({ data: { tenantId: tenant.tenantId, code: 'ROLLBACK', name: 'x', campusType: 'OTHER' } });
        await audit.log(tx, { tenantId: tenant.tenantId, userId: null, action: 'CREATE', entityType: 'CAMPUS', entityId: c.id });
        throw new Error('forced failure');
      }),
    ).rejects.toThrow('forced failure');
    expect(await counts()).toEqual(before);
  });

  it('a rejected request (duplicate code) leaves no audit row', async () => {
    const before = await counts();
    const dup = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(tenant.session)).send({ code: 'E1', name: 'dup', campusType: 'DEGREE' });
    expect(dup.status).toBe(409);
    expect(await counts()).toEqual(before);
  });
});
