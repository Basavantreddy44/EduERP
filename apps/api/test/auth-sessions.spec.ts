/** AC3 multi-tenant users, switching, revocation, refresh rotation and reuse detection; login hardening. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { API, PLATFORM_ADMIN, auth, createTenant, login, setPassword, startApp, switchTenant, toSession, Session } from './helpers';

let app: INestApplication;
let platform: Session;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
const X = { email: `multi.${Date.now()}@test.local`, password: 'Multi@Test12345' };

beforeAll(async () => {
  app = await startApp();
  platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'Gamma');
  B = await createTenant(app, platform, 'Delta');
  await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(A.session)).send({ code: 'GA', name: 'Gamma Main', campusType: 'SCHOOL' });
  await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(B.session)).send({ code: 'DB', name: 'Delta Main', campusType: 'PU' });
  for (const t of [A, B]) {
    const r = await request(app.getHttpServer()).post(`${API}/users/invite`).set(auth(t.session)).send({ fullName: 'Multi User', email: X.email, roleCode: 'CAMPUS_VIEWER' });
    expect(r.status).toBe(201);
  }
  await setPassword(X.email, X.password);
});

afterAll(async () => {
  await app.close();
});

const codes = async (s: Session) =>
  (await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(s))).body.map((c: { code: string }) => c.code);

describe('AC3 multi-tenant user', () => {
  it('a user in two institutions must choose one; tenant routes need it', async () => {
    const s = await login(app, X.email, X.password);
    expect(s.tenantId).toBeNull();
    expect(s.memberships.map((m) => m.tenantId).sort()).toEqual([A.tenantId, B.tenantId].sort());
    const res = await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(s));
    expect(res.status).toBe(403);
    expect(res.body.type).toBe('tenant-required');
  });

  it('switching tenant changes visible data and issues a distinct token', async () => {
    const s = await login(app, X.email, X.password);
    const inA = await switchTenant(app, s, A.tenantId);
    const inB = await switchTenant(app, inA, B.tenantId);
    expect(inA.token).not.toEqual(inB.token);
    expect(await codes(inB)).toEqual(['DB']);
    // the previous tenant session was ended by the switch
    expect((await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(inA))).status).toBe(401);
  });

  it('cannot switch to an institution without membership', async () => {
    const s = await login(app, A.admin.email, A.admin.password);
    const res = await request(app.getHttpServer()).post(`${API}/auth/switch-tenant`).set(auth(s)).send({ tenantId: B.tenantId });
    expect(res.status).toBe(403);
  });

  it('removing a membership blocks access immediately, not at token expiry', async () => {
    const email = `temp.${Date.now()}@test.local`;
    await request(app.getHttpServer()).post(`${API}/users/invite`).set(auth(A.session)).send({ fullName: 'Temp', email, roleCode: 'CAMPUS_VIEWER' });
    await setPassword(email, 'Temp@Test123456');
    const t = await login(app, email, 'Temp@Test123456');
    expect(await codes(t)).toEqual(['GA']);

    const userId = (await request(app.getHttpServer()).get(`${API}/me`).set(auth(t))).body.user.id;
    const rm = await request(app.getHttpServer()).post(`${API}/users/${userId}/remove`).set(auth(A.session));
    expect(rm.status).toBe(200);

    const after = await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(t));
    expect(after.status).toBe(403);
    expect(after.body.type).toBe('membership-inactive');
  });
});

describe('refresh tokens', () => {
  const refresh = (cookie: string) => request(app.getHttpServer()).post(`${API}/auth/refresh`).set('Cookie', cookie);

  it('rotates: the new pair works; reusing the old token revokes the whole family', async () => {
    const s0 = await login(app, A.admin.email, A.admin.password);
    const r1 = await refresh(s0.cookie);
    expect(r1.status).toBe(200);
    const s1 = toSession(r1);
    expect(s1.cookie).not.toEqual(s0.cookie);
    expect((await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(s1))).status).toBe(200);

    const reuse = await refresh(s0.cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.type).toBe('refresh-reused');

    expect((await refresh(s1.cookie)).status).toBe(401); // family revoked
    expect((await request(app.getHttpServer()).get(`${API}/campuses`).set(auth(s1))).status).toBe(401); // access token dead too
  });

  it('refresh token is an httpOnly, SameSite=Strict cookie and never in the JSON body', async () => {
    const res = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: A.admin.email, password: A.admin.password });
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('eduerp_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split(';')[0].split('=')[1]);
  });

  it('logout ends the session immediately', async () => {
    const s = await login(app, A.admin.email, A.admin.password);
    expect((await request(app.getHttpServer()).post(`${API}/auth/logout`).set(auth(s))).status).toBe(204);
    expect((await request(app.getHttpServer()).get(`${API}/me`).set(auth(s))).status).toBe(401);
    expect((await refresh(s.cookie)).status).toBe(401);
  });
});

describe('login hardening', () => {
  it('wrong password and unknown user give the same answer', async () => {
    const a = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: A.admin.email, password: 'wrong-password' });
    const b = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: 'nobody@test.local', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.type).toBe(b.body.type);
  });

  it('locks the account after repeated failures', async () => {
    const email = `lock.${Date.now()}@test.local`;
    await request(app.getHttpServer()).post(`${API}/users/invite`).set(auth(A.session)).send({ fullName: 'Lock', email, roleCode: 'CAMPUS_VIEWER' });
    await setPassword(email, 'Lock@Test1234567');
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: email, password: 'bad' });
    const res = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: email, password: 'Lock@Test1234567' });
    expect(res.status).toBe(401);
    expect(res.body.type).toBe('account-locked');
  });

  it('requests without a token are 401; invalid input is 422 problem+json', async () => {
    expect((await request(app.getHttpServer()).get(`${API}/campuses`)).status).toBe(401);
    const bad = await request(app.getHttpServer()).post(`${API}/campuses`).set(auth(A.session)).send({ code: '!', name: '' });
    expect(bad.status).toBe(422);
    expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(bad.body.errors.map((e: { field: string }) => e.field)).toEqual(expect.arrayContaining(['code', 'name', 'campusType']));
  });
});

describe('Screen language preference (M0.4)', () => {
  it('a person saves their language; it comes back at sign-in and only for them', async () => {
    const me = await login(app, A.admin.email, A.admin.password);
    const bad = await request(app.getHttpServer()).patch(`${API}/me/preferences`).set(auth(me)).send({ preferredLanguage: 'fr' });
    expect(bad.status).toBe(422);
    const ok = await request(app.getHttpServer()).patch(`${API}/me/preferences`).set(auth(me)).send({ preferredLanguage: 'kn' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ preferredLanguage: 'kn' });

    const again = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: A.admin.email, password: A.admin.password });
    expect(again.body.user.preferredLanguage).toBe('kn');
    const other = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier: B.admin.email, password: B.admin.password });
    expect(other.body.user.preferredLanguage).toBe('en');
    expect((await request(app.getHttpServer()).patch(`${API}/me/preferences`).send({ preferredLanguage: 'en' })).status).toBe(401);
  });
});
