import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildOpenApi } from '../src/openapi';
import { startApp } from './helpers';

type Op = { operationId: string; requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown>; required?: string[] } }> }; parameters?: { name: string; in: string }[]; security?: unknown[]; 'x-access'?: { kind: string } | null; responses: Record<string, unknown> };

let app: INestApplication;
let ops: Record<string, Op & { path: string; verb: string }>;

beforeAll(async () => {
  app = await startApp();
  const doc = buildOpenApi(app);
  ops = {};
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [verb, op] of Object.entries(item as Record<string, Op>)) {
      if (op && typeof op === 'object' && 'operationId' in op) ops[op.operationId] = { ...op, path: p, verb };
    }
  }
});
afterAll(() => app.close());

describe('OpenAPI document', () => {
  it('documents every route with its declared access rule', () => {
    expect(Object.keys(ops).length).toBeGreaterThanOrEqual(20);
    for (const op of Object.values(ops)) expect(op['x-access']).toBeTruthy();
  });

  it('request bodies come from the shared Zod schemas', () => {
    const login = ops['AuthController_login'].requestBody!.content['application/json'].schema;
    expect(login.required).toEqual(expect.arrayContaining(['identifier', 'password']));
    const campus = ops['CampusesController_create'].requestBody!.content['application/json'].schema;
    expect(Object.keys(campus.properties!)).toEqual(expect.arrayContaining(['code', 'name', 'campusType']));
    expect(campus.properties).not.toHaveProperty('tenantId'); // the tenant never comes from the body
    expect(ops['AuditController_list'].parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(['page', 'pageSize']));
  });

  it('protected routes require a bearer token; public ones do not', () => {
    expect(ops['CampusesController_list'].security).toEqual([{ bearer: [] }]);
    expect(ops['CampusesController_list'].responses).toHaveProperty('403');
    expect(ops['AuthController_login'].security).toBeUndefined();
  });

  it('is served at /api/docs-json outside production', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('EduERP API');
  });
});
