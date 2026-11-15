import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@eduerp/db';
import { createApp } from '../src/bootstrap';
import { PLATFORM_ADMIN } from './global-setup';

export { PLATFORM_ADMIN };
export const API = '/api/v1';

export async function startApp(): Promise<INestApplication> {
  const app = await createApp();
  await app.init();
  return app;
}

/** Owner connection (bypasses RLS). Only for test arrangement/inspection, never for assertions about isolation. */
export const ownerDb = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_OWNER_URL });
/** Runtime-role connection (RLS applies). */
export const appDb = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

export interface Session {
  token: string;
  cookie: string;
  tenantId: string | null;
  memberships: { tenantId: string; name: string }[];
}

export async function login(app: INestApplication, identifier: string, password: string): Promise<Session> {
  const res = await request(app.getHttpServer()).post(`${API}/auth/login`).send({ identifier, password });
  if (res.status !== 200) throw new Error(`login ${identifier} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toSession(res);
}

export function toSession(res: request.Response): Session {
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('eduerp_rt='))?.split(';')[0] ?? '';
  return { token: res.body.accessToken, cookie, tenantId: res.body.tenantId, memberships: res.body.memberships };
}

export async function switchTenant(app: INestApplication, s: Session, tenantId: string): Promise<Session> {
  const res = await request(app.getHttpServer()).post(`${API}/auth/switch-tenant`).set('Authorization', `Bearer ${s.token}`).send({ tenantId });
  if (res.status !== 200) throw new Error(`switch failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toSession(res);
}

let seq = 0;
/** Creates an institution through the real platform API and returns its admin session. */
export async function createTenant(app: INestApplication, platform: Session, label: string) {
  seq += 1;
  const slug = `${label.toLowerCase()}-${Date.now().toString(36)}-${seq}`;
  const admin = { fullName: `${label} Admin`, email: `admin.${slug}@test.local`, password: 'Admin@Test12345' };
  const res = await request(app.getHttpServer())
    .post(`${API}/platform/tenants`)
    .set('Authorization', `Bearer ${platform.token}`)
    .send({ name: `${label} Institution`, slug, institutionType: 'SCHOOL', admin });
  if (res.status !== 201) throw new Error(`create tenant failed: ${res.status} ${JSON.stringify(res.body)}`);
  const session = await login(app, admin.email, admin.password);
  return { tenantId: res.body.id as string, admin, session };
}

/** Invited users get a password via the (future) email link; tests set it directly. */
export async function setPassword(email: string, password: string): Promise<void> {
  const db = ownerDb();
  await db.user.update({ where: { email }, data: { passwordHash: await hash(password) } });
  await db.$disconnect();
}

export const auth = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

/** Invites a user into the admin's institution with a role, sets a password and returns their session. */
export async function addMember(
  app: INestApplication,
  admin: Session,
  o: { label: string; roleCode: string; campusId?: string | null; language?: 'en' | 'kn' },
): Promise<{ session: Session; email: string; userId: string }> {
  const email = `${o.label.toLowerCase()}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@test.local`;
  const res = await request(app.getHttpServer())
    .post(`${API}/users/invite`)
    .set(auth(admin))
    .send({ fullName: `${o.label} User`, email, roleCode: o.roleCode, campusId: o.campusId ?? null });
  if (res.status !== 201) throw new Error(`invite failed: ${res.status} ${JSON.stringify(res.body)}`);
  const db = ownerDb();
  const user = await db.user.update({ where: { email }, data: { passwordHash: await hash('Member@Test123'), preferredLanguage: o.language ?? 'en' }, select: { id: true } });
  await db.$disconnect();
  const first = await login(app, email, 'Member@Test123');
  const session = first.tenantId ? first : await switchTenant(app, first, first.memberships[0].tenantId);
  return { session, email, userId: user.id };
}

/** Creates a tenant role with the given permission codes (test arrangement through the owner role). */
export async function createRole(tenantId: string, code: string, permissionCodes: string[] = []): Promise<string> {
  const db = ownerDb();
  try {
    const role = await db.role.create({ data: { tenantId, code, name: code } });
    if (permissionCodes.length) {
      const perms = await db.permission.findMany({ where: { code: { in: permissionCodes } } });
      await db.rolePermission.createMany({ data: perms.map((p) => ({ tenantId, roleId: role.id, permissionId: p.id })) });
    }
    return role.id;
  } finally {
    await db.$disconnect();
  }
}

/** Polls until `check` returns a truthy value, or fails after `timeoutMs`. */
export async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 15_000, what = 'condition'): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Plain-text body of one Mailpit message. */
export async function mailText(id: string): Promise<string> {
  const res = await fetch(`http://${process.env.SMTP_HOST || 'localhost'}:8025/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message ${id}: ${res.status}`);
  return ((await res.json()) as { Text: string }).Text;
}

/** Messages Mailpit received for an address (newest first). */
export async function mailsTo(address: string): Promise<{ Subject: string; ID: string }[]> {
  const url = `http://${process.env.SMTP_HOST || 'localhost'}:8025/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mailpit not reachable (${res.status})`);
  const body = (await res.json()) as { messages?: { Subject: string; ID: string }[] };
  return body.messages ?? [];
}
