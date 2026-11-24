/**
 * AC105–AC108 Editions (Phase 20): a new institution gets its edition's modules and roles; changing the
 * edition switches modules as previewed (only while no plan decides), keeps overrides, data and roles,
 * and is audited; the institution profile and logo save with checks; the public branding answer holds
 * nothing but the name and logo. Existing (Standard) institutions are unchanged.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EDITIONS, MODULES } from '@eduerp/shared';
import { API, PLATFORM_ADMIN, addMember, auth, createTenant, login, ownerDb, startApp, Session } from './helpers';

let app: INestApplication;
let platform: Session;
let S: Awaited<ReturnType<typeof createTenant>>; // Standard
let R: { tenantId: string; slug: string; session: Session }; // Residential
const http = () => request(app.getHttpServer());
const get = (path: string, s: Session) => http().get(`${API}${path}`).set(auth(s));
const png = (bytes: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(bytes - 8, 7)]);
const roleCodes = async (s: Session) => ((await get('/users/roles', s)).body as { code: string }[] | { items: { code: string }[] });

async function createResidential(label: string) {
  const slug = `${label.toLowerCase()}-${Date.now().toString(36)}`;
  const admin = { fullName: `${label} Head Office`, email: `ho.${slug}@test.local`, password: 'Admin@Test12345' };
  const res = await http().post(`${API}/platform/tenants`).set(auth(platform))
    .send({ name: `${label} Residential Schools`, slug, institutionType: 'GROUP', edition: 'RESIDENTIAL', admin });
  expect(res.status).toBe(201);
  expect(res.body.edition).toBe('RESIDENTIAL');
  return { tenantId: res.body.id as string, slug, session: await login(app, admin.email, admin.password) };
}
const codesOf = (body: unknown): string[] => (Array.isArray(body) ? body : (body as { items: { code: string }[] }).items).map((r: { code: string }) => r.code);

beforeAll(async () => {
  app = await startApp();
  platform = await login(app, PLATFORM_ADMIN.email, PLATFORM_ADMIN.password);
  S = await createTenant(app, platform, 'EdStd');
  R = await createResidential('EdRes');
}, 120_000);
afterAll(() => app?.close());

describe('AC105 a new institution starts with its edition', () => {
  it('Standard: every module on, no edition roles, edition STANDARD', async () => {
    const m = (await get('/me/modules', S.session)).body;
    expect(m.edition).toBe('STANDARD');
    expect(m.enabled).toHaveLength(MODULES.length);
    expect(m.institution).toMatchObject({ name: 'EdStd Institution', logoVersion: null });
    const codes = codesOf((await roleCodes(S.session)));
    expect(codes).not.toContain('PRINCIPAL');
    expect(codes).toContain('INSTITUTION_ADMIN');
  });

  it('Residential: admissions, fees, transport, placements off; principal, warden, kitchen and head office roles created', async () => {
    const m = (await get('/me/modules', R.session)).body;
    expect(m.edition).toBe('RESIDENTIAL');
    for (const off of EDITIONS.RESIDENTIAL.modulesOff) expect(m.enabled).not.toContain(off);
    for (const on of ['HOSTEL', 'HEALTH', 'INVENTORY', 'STUDENTS', 'EXAMS', 'HR_PAYROLL']) expect(m.enabled).toContain(on);
    const codes = codesOf(await roleCodes(R.session));
    for (const r of ['PRINCIPAL', 'WARDEN', 'KITCHEN_INCHARGE', 'HEAD_OFFICE_OFFICER', 'INSTITUTION_ADMIN', 'TEACHING_STAFF']) expect(codes).toContain(r);
    // A switched-off module is refused by the API as before.
    expect((await get('/fees/billing/runs', R.session)).status).toBe(403);
    // The platform list shows and filters by edition.
    const list = (await get('/platform/tenants?edition=RESIDENTIAL', platform)).body as { id: string; edition: string }[];
    expect(list.every((t) => t.edition === 'RESIDENTIAL')).toBe(true);
    expect(list.map((t) => t.id)).toContain(R.tenantId);
    expect(list.map((t) => t.id)).not.toContain(S.tenantId);
  });

  it('a warden assigned to one school gets the warden rights there', async () => {
    const campus = (await http().post(`${API}/campuses`).set(auth(R.session)).send({ code: 'HNS', name: 'MDRS Hunsur', campusType: 'SCHOOL', district: 'Mysuru' })).body.id;
    const w = await addMember(app, R.session, { label: 'Warden', roleCode: 'WARDEN', campusId: campus });
    const perms = (await get('/me/permissions', w.session)).body.permissions as { code: string; allCampuses: boolean; campusIds: string[] }[];
    const meals = perms.find((p) => p.code === 'hostel.meals.record');
    expect(meals).toMatchObject({ allCampuses: false, campusIds: [campus] });
    expect(perms.find((p) => p.code === 'fees.collect')).toBeUndefined();
  });
});

describe('AC106 changing the edition', () => {
  it('preview shows the changes; the change applies them, keeps overrides and is audited', async () => {
    // Platform override: Transport switched on for the Standard school stays on whatever the edition.
    expect((await http().put(`${API}/platform/tenants/${S.tenantId}/modules`).set(auth(platform)).send({ moduleCode: 'TRANSPORT', isEnabled: true })).status).toBe(200);
    const pv = (await get(`/platform/tenants/${S.tenantId}/edition-preview?edition=RESIDENTIAL`, platform)).body;
    expect(pv).toMatchObject({ from: 'STANDARD', to: 'RESIDENTIAL', followsPlan: false });
    expect(pv.switchOff.map((m: { code: string }) => m.code).sort()).toEqual(['ADMISSIONS', 'FEES', 'PLACEMENTS']);
    expect(pv.switchOn).toEqual([]);
    expect(pv.rolesAdded.map((r: { code: string }) => r.code).sort()).toEqual(['HEAD_OFFICE_OFFICER', 'KITCHEN_INCHARGE', 'PRINCIPAL', 'WARDEN']);

    // Reason required; only the super admin; another tenant's admin cannot reach it.
    expect((await http().patch(`${API}/platform/tenants/${S.tenantId}/edition`).set(auth(platform)).send({ edition: 'RESIDENTIAL' })).status).toBe(422);
    expect((await http().patch(`${API}/platform/tenants/${S.tenantId}/edition`).set(auth(R.session)).send({ edition: 'RESIDENTIAL', reason: 'try' })).status).toBe(403);
    const ch = await http().patch(`${API}/platform/tenants/${S.tenantId}/edition`).set(auth(platform)).send({ edition: 'RESIDENTIAL', reason: 'Moved to the residential set-up' });
    expect(ch.status).toBe(200);
    expect(ch.body.edition).toBe('RESIDENTIAL');
    expect((await http().patch(`${API}/platform/tenants/${S.tenantId}/edition`).set(auth(platform)).send({ edition: 'RESIDENTIAL', reason: 'again' })).status).toBe(409);

    const s = await login(app, S.admin.email, S.admin.password);
    const m = (await get('/me/modules', s)).body;
    expect(m.edition).toBe('RESIDENTIAL');
    expect(m.enabled).toContain('TRANSPORT'); // override kept
    expect(m.enabled).not.toContain('FEES');
    expect(codesOf(await roleCodes(s))).toContain('PRINCIPAL');

    const db = ownerDb();
    const a = await db.auditLog.findFirst({ where: { tenantId: S.tenantId, entityType: 'TENANT_EDITION' }, orderBy: { createdAt: 'desc' } });
    await db.$disconnect();
    expect(a).toMatchObject({ action: 'UPDATE', reason: 'Moved to the residential set-up' });
    expect(a?.oldValues).toEqual({ edition: 'STANDARD' });

    // Back to Standard: modules on again, roles are not removed.
    const back = await http().patch(`${API}/platform/tenants/${S.tenantId}/edition`).set(auth(platform)).send({ edition: 'STANDARD', reason: 'Back to standard' });
    expect(back.status).toBe(200);
    const m2 = (await get('/me/modules', await login(app, S.admin.email, S.admin.password))).body;
    expect(m2.enabled).toEqual(expect.arrayContaining(['FEES', 'ADMISSIONS', 'PLACEMENTS', 'TRANSPORT']));
    expect(codesOf(await roleCodes(s))).toContain('WARDEN');
  });

  it('with a plan, modules follow the plan and the edition change does not touch them', async () => {
    const code = `ED${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    const plan = (await http().post(`${API}/platform/plans`).set(auth(platform)).send({ name: 'Edition test plan', code, pricePerStudent: 10, billingCycle: 'YEARLY', modules: ['STUDENTS', 'HOSTEL', 'FEES'] })).body;
    expect((await http().post(`${API}/platform/tenants/${R.tenantId}/subscription`).set(auth(platform)).send({ planId: plan.id, status: 'ACTIVE', startDate: '2026-06-01', endDate: '2027-05-31', studentCount: 10 })).status).toBe(201);
    const pv = (await get(`/platform/tenants/${R.tenantId}/edition-preview?edition=STANDARD`, platform)).body;
    expect(pv).toMatchObject({ followsPlan: true, switchOn: [], switchOff: [], rolesAdded: [] });
  });
});

describe('AC108 institution profile and logo', () => {
  it('profile is validated, saved, audited; staff without the right cannot change it', async () => {
    expect((await http().put(`${API}/institution/profile`).set(auth(S.session)).send({ name: 'X' })).status).toBe(422);
    expect((await http().put(`${API}/institution/profile`).set(auth(S.session)).send({ name: 'EdStd School', pincode: '12' })).status).toBe(422);
    const ok = await http().put(`${API}/institution/profile`).set(auth(S.session)).send({ name: 'EdStd Public School', nameLocal: 'ಎಡ್‌ಸ್ಟ್ಯಾಂಡ್ ಶಾಲೆ', phone: '9876500011', email: '', pincode: '570001', city: 'Mysuru' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'EdStd Public School', email: null, pincode: '570001' });
    const t = await addMember(app, S.session, { label: 'Teacher', roleCode: 'TEACHING_STAFF' });
    expect((await http().put(`${API}/institution/profile`).set(auth(t.session)).send({ name: 'Hacked' })).status).toBe(403);
    expect((await http().post(`${API}/institution/logo`).set(auth(t.session)).attach('file', png(200), 'l.png')).status).toBe(403);
  });

  it('logo: images only, at most 1 MB; public branding shows only name and logo', async () => {
    expect((await http().post(`${API}/institution/logo`).set(auth(S.session)).attach('file', Buffer.from('%PDF-1.4 hello'), 'l.pdf')).status).toBe(415);
    expect((await http().post(`${API}/institution/logo`).set(auth(S.session)).attach('file', png(1024 * 1024 + 100), 'big.png')).status).toBeGreaterThanOrEqual(413);
    const up = await http().post(`${API}/institution/logo`).set(auth(S.session)).attach('file', png(500), 'logo.png');
    expect(up.status).toBe(201);
    expect(up.body.logoFileId).toBeTruthy();

    const slug = (await get('/institution/profile', S.session)).body.slug as string;
    const b = await http().get(`${API}/public/branding/${slug}`);
    expect(b.status).toBe(200);
    expect(Object.keys(b.body).sort()).toEqual(['logoVersion', 'name', 'nameLocal', 'slug']);
    expect(b.body.logoVersion).toBe(up.body.logoFileId.slice(0, 8));
    const logo = await http().get(`${API}/public/branding/${slug}/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(logo.headers['x-content-type-options']).toBe('nosniff');
    expect((await get('/me/modules', S.session)).body.institution.logoVersion).toBe(b.body.logoVersion);

    // Replacing keeps one live logo; removing makes the public logo 404.
    const up2 = await http().post(`${API}/institution/logo`).set(auth(S.session)).attach('file', png(600), 'logo2.png');
    expect(up2.body.logoFileId).not.toBe(up.body.logoFileId);
    expect((await http().delete(`${API}/institution/logo`).set(auth(S.session))).status).toBe(200);
    expect((await http().get(`${API}/public/branding/${slug}/logo`)).status).toBe(404);
    expect((await http().get(`${API}/public/branding/no-such-school-x`)).status).toBe(404);
    expect((await http().get(`${API}/public/branding/BAD..slug`)).status).toBeGreaterThanOrEqual(400);
  });

  it('one institution cannot read another institution\x27s profile', async () => {
    const mine = (await get('/institution/profile', R.session)).body;
    expect(mine.slug).toBe(R.slug);
    expect(mine.name).not.toBe('EdStd Public School');
  });
});
