/**
 * AC99–AC100 Access control (improvement round A1–A3): the roles master — built-in roles are fixed
 * templates (no change, no delete), a copy holds the same rights and can be edited, names unique, a role
 * in use cannot be deleted, only rights of the school's modules; each person's access — a role for all
 * campuses or one campus, effective on the next request, no duplicates, widening replaces campus grants;
 * nobody grants (or invites into) rights they do not hold or a campus they cannot reach; the last
 * all-campus Institution Admin stays; the effective-rights view; every change audited; isolation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CORE_MODULES, PERMISSIONS, PERMISSION_CATALOGUE } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createRole, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let A: Awaited<ReturnType<typeof createTenant>>;
let B: Awaited<ReturnType<typeof createTenant>>;
let main: string;
let north: string;
let adminId: string;
const ids: Record<string, string> = {};
const http = () => request(app.getHttpServer());
const post = (path: string, body: unknown, s: Session = A.session) => http().post(`${API}${path}`).set(auth(s)).send(body as object);
const put = (path: string, body: unknown, s: Session = A.session) => http().put(`${API}${path}`).set(auth(s)).send(body as object);
const get = (path: string, s: Session = A.session) => http().get(`${API}${path}`).set(auth(s));
const roleId = async (code: string) => ((await get('/users/roles')).body as { id: string; code: string }[]).find((r) => r.code === code)!.id;

beforeAll(async () => {
  app = await startApp();
  const platform: Session = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  A = await createTenant(app, platform, 'AccA');
  B = await createTenant(app, platform, 'AccB');
  main = (await post('/campuses', { code: 'MAIN', name: 'Main School', campusType: 'SCHOOL' })).body.id;
  north = (await post('/campuses', { code: 'NORTH', name: 'North School', campusType: 'SCHOOL' })).body.id;
  adminId = ((await get('/users')).body as { id: string; email: string }[]).find((u) => u.email === A.admin.email)!.id;
  ids.reader = await createRole(A.tenantId, 'READ_R', [PERMISSIONS.STU_STUDENT_READ]);
  ids.usersRead = await createRole(A.tenantId, 'USERS_R', [PERMISSIONS.IAM_USER_READ]);
  await createRole(A.tenantId, 'MGR_R', [PERMISSIONS.IAM_USER_READ, PERMISSIONS.IAM_USER_INVITE, PERMISSIONS.STU_STUDENT_READ]);
  await createRole(A.tenantId, 'NONE_R', [PERMISSIONS.ORG_CAMPUS_READ]);
}, 120_000);
afterAll(() => app?.close());

describe('AC99 roles master', () => {
  it('lists only the rights of switched-on modules, grouped by module', async () => {
    const res = await get('/users/permissions');
    expect(res.status).toBe(200);
    const groups = res.body as { module: string; permissions: { code: string }[] }[];
    const users = groups.find((g) => g.module === 'USERS')!;
    expect(users.permissions.map((p) => p.code)).toEqual(expect.arrayContaining([PERMISSIONS.IAM_USER_READ, PERMISSIONS.IAM_ROLE_MANAGE]));
    const all = groups.flatMap((g) => g.permissions.map((p) => p.code));
    expect(new Set(all).size).toBe(all.length);
    for (const c of all) expect(PERMISSION_CATALOGUE.some((p) => p.code === c)).toBe(true);
    // A module switched off for the institution drops out of the catalogue and cannot be granted.
    const db = ownerDb();
    const off = groups.find((g) => !(CORE_MODULES as string[]).includes(g.module) && g.module !== 'STUDENTS')!;
    await db.tenantModule.upsert({ where: { tenantId_moduleCode: { tenantId: A.tenantId, moduleCode: off.module } }, create: { tenantId: A.tenantId, moduleCode: off.module, isEnabled: false }, update: { isEnabled: false } });
    try {
      const after = (await get('/users/permissions')).body as { module: string }[];
      expect(after.some((g) => g.module === off.module)).toBe(false);
      const bad = await post('/users/roles', { name: 'Off module role', permissionCodes: [off.permissions[0].code] });
      expect([403, 409]).toContain(bad.status);
    } finally {
      await db.tenantModule.update({ where: { tenantId_moduleCode: { tenantId: A.tenantId, moduleCode: off.module } }, data: { isEnabled: true } });
      await db.$disconnect();
    }
  });

  it('built-in roles are fixed; a copy holds the same rights and can be edited; names unique; unknown rights refused', async () => {
    const admin = await roleId('INSTITUTION_ADMIN');
    const teacher = (await get(`/users/roles/${await roleId('TEACHING_STAFF')}`)).body;
    expect(teacher.isSystem).toBe(true);
    expect(teacher.can.edit).toBe(false);
    expect((await put(`/users/roles/${teacher.id}`, { name: 'Teacher', permissionCodes: [PERMISSIONS.STU_STUDENT_READ] })).body.type).toMatch(/built-in-role/);
    expect((await post(`/users/roles/${admin}/delete`, {})).status).toBe(409);

    const copy = await post('/users/roles', { name: 'Senior Teacher', permissionCodes: teacher.permissionCodes });
    expect(copy.status).toBe(201);
    expect(copy.body.code).toBe('CUSTOM_SENIOR_TEACHER');
    ids.senior = copy.body.id;
    const got = (await get(`/users/roles/${ids.senior}`)).body;
    expect(got).toMatchObject({ name: 'Senior Teacher', isSystem: false, permissionCodes: [...teacher.permissionCodes].sort(), can: { edit: true } });

    expect((await post('/users/roles', { name: 'senior teacher', permissionCodes: [PERMISSIONS.STU_STUDENT_READ] })).status).toBe(409);
    expect((await post('/users/roles', { name: 'Odd', permissionCodes: ['no.such.right'] })).body.type).toMatch(/unknown-right/);
    expect((await post('/users/roles', { name: 'Empty', permissionCodes: [] })).status).toBe(422);

    const fewer = teacher.permissionCodes.slice(0, 2);
    expect((await put(`/users/roles/${ids.senior}`, { name: 'Senior Teacher (Main)', permissionCodes: fewer })).status).toBe(200);
    expect((await get(`/users/roles/${ids.senior}`)).body).toMatchObject({ name: 'Senior Teacher (Main)', permissionCodes: [...fewer].sort() });
    // The built-in role itself is unchanged.
    expect((await get(`/users/roles/${teacher.id}`)).body.permissionCodes).toEqual(teacher.permissionCodes);
  });

  it('a role held by anyone cannot be deleted; only role managers change roles; isolation', async () => {
    const holder = await addMember(app, A.session, { label: 'Holder', roleCode: 'NONE_R', campusId: main });
    const g = await post(`/users/${holder.userId}/roles`, { roleId: ids.senior, campusId: main });
    expect(g.status).toBe(201);
    const del = await post(`/users/roles/${ids.senior}/delete`, {});
    expect(del.status).toBe(409);
    expect(del.body.type).toMatch(/role-in-use/);
    expect((await get(`/users/roles/${ids.senior}`)).body.holders).toEqual([expect.objectContaining({ userId: holder.userId, campus: 'Main School' })]);
    expect((await post(`/users/${holder.userId}/roles/${g.body.id}/remove`, {})).status).toBe(200);
    expect((await post(`/users/roles/${ids.senior}/delete`, {})).status).toBe(200);
    expect((await get(`/users/roles/${ids.senior}`)).status).toBe(404);

    const mgr = await addMember(app, A.session, { label: 'Mgr0', roleCode: 'MGR_R', campusId: null });
    expect((await post('/users/roles', { name: 'Sneaky', permissionCodes: [PERMISSIONS.STU_STUDENT_READ] }, mgr.session)).status).toBe(403);
    expect((await get(`/users/roles/${ids.reader}`, B.session)).status).toBe(404);
    expect((await put(`/users/roles/${ids.reader}`, { name: 'Other school', permissionCodes: [PERMISSIONS.STU_STUDENT_READ] }, B.session)).status).toBe(404);
  });
});

describe('AC100 user access', () => {
  it('a role for one campus, then another, then all campuses; takes effect on the next request; duplicates refused', async () => {
    const p = await addMember(app, A.session, { label: 'Person', roleCode: 'NONE_R', campusId: main });
    ids.person = p.userId;
    expect((await get('/users', p.session)).status).toBe(403);
    const g1 = await post(`/users/${p.userId}/roles`, { roleId: ids.usersRead, campusId: main });
    expect(g1.status).toBe(201);
    expect((await get('/users', p.session)).status).toBe(200); // same token, new right
    expect((await post(`/users/${p.userId}/roles`, { roleId: ids.usersRead, campusId: main })).body.type).toMatch(/already-held/);
    expect((await post(`/users/${p.userId}/roles`, { roleId: ids.usersRead, campusId: north })).status).toBe(201);

    let view = (await get(`/users/${p.userId}`)).body;
    const right = () => view.rights.flatMap((m: { permissions: { code: string; campuses: string[] | null }[] }) => m.permissions).find((x: { code: string }) => x.code === PERMISSIONS.IAM_USER_READ);
    expect(right().campuses.sort()).toEqual(['Main School', 'North School']);
    expect(view.roles.filter((r: { roleId: string }) => r.roleId === ids.usersRead)).toHaveLength(2);

    // All campuses replaces the two campus grants.
    expect((await post(`/users/${p.userId}/roles`, { roleId: ids.usersRead, campusId: null })).status).toBe(201);
    view = (await get(`/users/${p.userId}`)).body;
    expect(view.roles.filter((r: { roleId: string }) => r.roleId === ids.usersRead)).toEqual([expect.objectContaining({ campusId: null, campus: null })]);
    expect(right().campuses).toBeNull();
    expect((await post(`/users/${p.userId}/roles`, { roleId: ids.usersRead, campusId: north })).body.type).toMatch(/already-held/);

    // Taking it away also takes effect at once.
    const ur = view.roles.find((r: { roleId: string }) => r.roleId === ids.usersRead).id;
    expect((await post(`/users/${p.userId}/roles/${ur}/remove`, {})).status).toBe(200);
    expect((await get('/users', p.session)).status).toBe(403);
    expect((await post(`/users/${p.userId}/password-link`, {})).body).toEqual({ sent: true });
  });

  it('a campus manager gives only rights they hold, only at their campus — also when inviting', async () => {
    const mgr = await addMember(app, A.session, { label: 'Mgr', roleCode: 'MGR_R', campusId: main });
    expect((await post(`/users/${ids.person}/roles`, { roleId: ids.reader, campusId: main }, mgr.session)).status).toBe(201);
    expect((await post(`/users/${ids.person}/roles`, { roleId: ids.reader, campusId: north }, mgr.session)).body.type).toMatch(/scope-insufficient/);
    expect((await post(`/users/${ids.person}/roles`, { roleId: ids.reader, campusId: null }, mgr.session)).body.type).toMatch(/scope-insufficient/);
    const adm = await roleId('INSTITUTION_ADMIN');
    const esc = await post(`/users/${ids.person}/roles`, { roleId: adm, campusId: main }, mgr.session);
    expect(esc.status).toBe(403);
    expect(esc.body.type).toMatch(/cannot-grant/);
    const inv = await post('/users/invite', { fullName: 'Shadow Admin', email: `shadow.${Date.now()}@test.local`, roleCode: 'INSTITUTION_ADMIN', campusId: main }, mgr.session);
    expect(inv.status).toBe(403);
    expect(inv.body.type).toMatch(/cannot-grant/);
    // A campus manager cannot take away an all-campus grant either.
    const all = await post(`/users/${ids.person}/roles`, { roleId: ids.usersRead, campusId: null });
    expect((await post(`/users/${ids.person}/roles/${all.body.id}/remove`, {}, mgr.session)).status).toBe(403);
  });

  it('the last all-campus Institution Admin stays; nobody removes their own admin access', async () => {
    const adm = await roleId('INSTITUTION_ADMIN');
    const mine = (await get(`/users/${adminId}`)).body.roles.find((r: { roleId: string; campusId: string | null }) => r.roleId === adm && r.campusId === null);
    expect((await post(`/users/${adminId}/roles/${mine.id}/remove`, {})).body.type).toMatch(/self-admin/);

    // Someone with every right but not the admin role tries to remove the only admin.
    const groupsOn = ((await get('/users/permissions')).body as { permissions: { code: string }[] }[]).flatMap((g) => g.permissions.map((p) => p.code));
    const full = await post('/users/roles', { name: 'Everything', permissionCodes: groupsOn });
    expect(full.status).toBe(201);
    const sup = await addMember(app, A.session, { label: 'Super', roleCode: full.body.code, campusId: null });
    const last = await post(`/users/${adminId}/roles/${mine.id}/remove`, {}, sup.session);
    expect(last.status).toBe(409);
    expect(last.body.type).toMatch(/last-admin/);
    expect((await post(`/users/${adminId}/remove`, {}, sup.session)).body.type).toMatch(/last-admin/);

    // With a second admin, one admin grant can go.
    const second = await addMember(app, A.session, { label: 'Admin2', roleCode: 'INSTITUTION_ADMIN', campusId: null });
    const theirs = (await get(`/users/${second.userId}`)).body.roles.find((r: { roleId: string }) => r.roleId === adm);
    expect((await post(`/users/${second.userId}/roles/${theirs.id}/remove`, {}, sup.session)).status).toBe(200);
    // Removing a non-admin person is not affected by the rule.
    expect((await post(`/users/${ids.person}/remove`, {}, sup.session)).status).toBe(200);
  });

  it('every change is audited; isolation', async () => {
    const db = ownerDb();
    try {
      const rows = await db.auditLog.findMany({ where: { tenantId: A.tenantId, entityType: { in: ['ROLE', 'USER_ROLE'] } }, select: { action: true, entityType: true } });
      expect(rows.filter((r) => r.entityType === 'ROLE').map((r) => r.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE']));
      expect(rows.filter((r) => r.entityType === 'USER_ROLE').length).toBeGreaterThanOrEqual(8);
    } finally {
      await db.$disconnect();
    }
    expect((await get(`/users/${adminId}`, B.session)).status).toBe(404);
    const bAdm = ((await get('/users/roles', B.session)).body as { id: string; code: string }[]).find((r) => r.code === 'INSTITUTION_ADMIN')!.id;
    expect((await post(`/users/${adminId}/roles`, { roleId: bAdm, campusId: null }, B.session)).status).toBe(404);
    expect((await post(`/users/${adminId}/roles`, { roleId: ids.reader, campusId: null }, B.session)).status).toBe(404);
  });
});
