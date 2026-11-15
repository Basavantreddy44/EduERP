/** AC9 settings registry with campus override; AC10 gapless, duplicate-free numbering under concurrency. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Db } from '../src/common/prisma.service';
import { NumberingService } from '../src/modules/numbering/numbering.service';
import { API, PLATFORM_ADMIN, auth, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let campus1: string;
let campus2: string;
const http = () => request(app.getHttpServer());
const KEY = 'attendance.late_after_minutes';

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'SetA');
  B = await createTenant(app, platform, 'SetB');
  const mk = async (code: string) => (await http().post(`${API}/campuses`).set(auth(A.session)).send({ code, name: `Campus ${code}`, campusType: 'SCHOOL' })).body.id as string;
  campus1 = await mk('S1');
  campus2 = await mk('S2');
});
afterAll(() => app.close());

const effective = async (s: Session, campusId?: string) => {
  const res = await http().get(`${API}/settings${campusId ? `?campusId=${campusId}` : ''}`).set(auth(s));
  expect(res.status).toBe(200);
  return (res.body as { key: string; value: unknown; source: string }[]).find((x) => x.key === KEY)!;
};

describe('AC9 settings', () => {
  it('starts at the registry default', async () => {
    expect(await effective(A.session)).toMatchObject({ value: 10, source: 'DEFAULT' });
  });

  it('resolves campus override → institution value → default', async () => {
    expect((await http().put(`${API}/settings/${KEY}`).set(auth(A.session)).send({ value: 15 })).status).toBe(200);
    expect((await http().put(`${API}/settings/${KEY}`).set(auth(A.session)).send({ campusId: campus1, value: 20 })).status).toBe(200);

    expect(await effective(A.session)).toMatchObject({ value: 15, source: 'INSTITUTION' });
    expect(await effective(A.session, campus1)).toMatchObject({ value: 20, source: 'CAMPUS' });
    expect(await effective(A.session, campus2)).toMatchObject({ value: 15, source: 'INSTITUTION' });

    // Removing the override falls back to the institution value.
    expect((await http().delete(`${API}/settings/${KEY}?campusId=${campus1}`).set(auth(A.session))).status).toBe(200);
    expect(await effective(A.session, campus1)).toMatchObject({ value: 15, source: 'INSTITUTION' });
  });

  it('rejects unknown keys, invalid values and campus overrides of institution-only settings (422)', async () => {
    const unknown = await http().put(`${API}/settings/no.such.key`).set(auth(A.session)).send({ value: 1 });
    expect(unknown.status).toBe(422);
    expect(unknown.body.type).toBe('setting-unknown');

    const invalid = await http().put(`${API}/settings/${KEY}`).set(auth(A.session)).send({ value: 'soon' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.errors[0].field).toBe('value');

    const tooBig = await http().put(`${API}/settings/${KEY}`).set(auth(A.session)).send({ value: 999 });
    expect(tooBig.status).toBe(422);

    const perCampus = await http().put(`${API}/settings/files.max_upload_mb`).set(auth(A.session)).send({ campusId: campus1, value: 5 });
    expect(perCampus.status).toBe(422);
    expect(perCampus.body.type).toBe('setting-not-per-campus');
  });

  it('changes are audited', async () => {
    const db = ownerDb();
    const rows = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: 'SETTING' } });
    await db.$disconnect();
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['UPDATE', 'DELETE']));
  });

  it('is tenant-isolated', async () => {
    expect(await effective(B.session)).toMatchObject({ value: 10, source: 'DEFAULT' });
    const other = await http().get(`${API}/settings?campusId=${campus1}`).set(auth(B.session));
    expect(other.status).toBe(404); // A's campus does not exist for B
  });
});

describe('AC10 numbering', () => {
  const ctxA = () => ({ tenantId: A.tenantId, userId: null });

  beforeAll(async () => {
    const res = await http().post(`${API}/numbering/sequences`).set(auth(A.session)).send({ docType: 'TEST', prefix: 'T/26-27/', yearLabel: '2026-27', padding: 4 });
    expect(res.status).toBe(201);
  });

  it('50 concurrent allocations give 50 distinct consecutive numbers', async () => {
    const db = app.get(Db);
    const numbering = app.get(NumberingService);
    const got = await Promise.all(
      Array.from({ length: 50 }, () => db.run(ctxA(), (tx) => numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27' }))),
    );
    expect(new Set(got).size).toBe(50);
    expect([...got].sort()).toEqual(Array.from({ length: 50 }, (_, i) => `T/26-27/${String(i + 1).padStart(4, '0')}`));
  });

  it('a rolled-back transaction does not consume a number (gapless)', async () => {
    const db = app.get(Db);
    const numbering = app.get(NumberingService);
    await expect(
      db.run(ctxA(), async (tx) => {
        await numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27' });
        throw new Error('business rule failed after numbering');
      }),
    ).rejects.toThrow('business rule failed');
    const next = await db.run(ctxA(), (tx) => numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27' }));
    expect(next).toBe('T/26-27/0051');
  });

  it('a campus series takes precedence over the institution series', async () => {
    const res = await http().post(`${API}/numbering/sequences`).set(auth(A.session)).send({ campusId: campus1, docType: 'TEST', prefix: 'S1/', yearLabel: '2026-27', padding: 3 });
    expect(res.status).toBe(201);
    const db = app.get(Db);
    const numbering = app.get(NumberingService);
    expect(await db.run(ctxA(), (tx) => numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27', campusId: campus1 }))).toBe('S1/001');
    expect(await db.run(ctxA(), (tx) => numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27', campusId: campus2 }))).toBe('T/26-27/0052');
  });

  it('missing series and duplicate series are clear errors; other tenants cannot use A’s series', async () => {
    const db = app.get(Db);
    const numbering = app.get(NumberingService);
    await expect(db.run(ctxA(), (tx) => numbering.allocate(tx, { docType: 'RECEIPT' }))).rejects.toMatchObject({ code: 'numbering-not-configured' });
    await expect(db.run({ tenantId: B.tenantId }, (tx) => numbering.allocate(tx, { docType: 'TEST', yearLabel: '2026-27' }))).rejects.toMatchObject({ code: 'numbering-not-configured' });
    const dup = await http().post(`${API}/numbering/sequences`).set(auth(A.session)).send({ docType: 'TEST', prefix: 'X/', yearLabel: '2026-27' });
    expect(dup.status).toBe(409);
  });
});
