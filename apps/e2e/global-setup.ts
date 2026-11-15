/**
 * Arranges AC8 data through the real API, with unique names per run:
 *  - two institutions sharing one admin (so login must ask which institution),
 *  - a CAMPUS_VIEWER user in institution A (read-only on campuses).
 * Invited users have no password until invite emails exist (M0.2), so the viewer's
 * password is set with the owner DB connection, the same arrangement the API tests use.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@eduerp/db';

const API = `${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api/v1`;
export const DATA_FILE = path.join(__dirname, '.e2e-data.json');

export interface E2EData {
  runId: string;
  admin: { email: string; password: string };
  tenantA: { id: string; name: string };
  tenantB: { id: string; name: string };
  viewer: { email: string; password: string };
}

async function call<T>(method: string, url: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

type Login = { accessToken: string; tenantId: string | null };

export default async function globalSetup() {
  const need = ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'DATABASE_OWNER_URL'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`E2E setup needs env: ${missing.join(', ')}`);

  const runId = Date.now().toString(36);
  const platform = await call<Login>('POST', '/auth/login', { identifier: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD });

  const admin = { fullName: 'E2E Admin', email: `e2e.admin.${runId}@test.local`, password: 'E2e@Admin12345' };
  const mk = (label: string) =>
    call<{ id: string; name: string }>('POST', '/platform/tenants', { name: `E2E ${label} ${runId}`, slug: `e2e-${label.toLowerCase()}-${runId}`, institutionType: 'SCHOOL', admin }, platform.accessToken);
  const tenantA = await mk('Alpha');
  const tenantB = await mk('Beta'); // same admin email → second membership for the existing user

  // Admin acts in A to invite a read-only viewer.
  const adminLogin = await call<Login>('POST', '/auth/login', { identifier: admin.email, password: admin.password });
  const inA = await call<Login>('POST', '/auth/switch-tenant', { tenantId: tenantA.id }, adminLogin.accessToken);
  const viewer = { email: `e2e.viewer.${runId}@test.local`, password: 'E2e@Viewer12345' };
  await call('POST', '/users/invite', { fullName: 'E2E Viewer', email: viewer.email, roleCode: 'CAMPUS_VIEWER', campusId: null }, inA.accessToken);

  const owner = new PrismaClient({ datasourceUrl: process.env.DATABASE_OWNER_URL });
  try {
    await owner.user.update({ where: { email: viewer.email }, data: { passwordHash: await hash(viewer.password) } });
  } finally {
    await owner.$disconnect();
  }

  const data: E2EData = {
    runId,
    admin: { email: admin.email, password: admin.password },
    tenantA: { id: tenantA.id, name: tenantA.name },
    tenantB: { id: tenantB.id, name: tenantB.name },
    viewer,
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
