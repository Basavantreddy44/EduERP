import type { INestApplication, Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { ACCESS_KEY, AccessRule } from './common/decorators';
import { ZodPipe } from './common/zod.pipe';

type Json = Record<string, unknown>;
type Operation = {
  operationId?: string;
  description?: string;
  parameters?: Json[];
  requestBody?: Json;
  responses: Record<string, Json>;
  security?: Record<string, string[]>[];
  [k: `x-${string}`]: unknown;
};

const problem = (description: string) => ({ description, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } });

function describeAccess(rule: AccessRule | undefined): string {
  switch (rule?.kind) {
    case 'public': return 'Access: public (no login).';
    case 'authenticated': return 'Access: any signed-in user; no institution required.';
    case 'platform': return `Access: platform staff (${rule.roles.join(', ')}).`;
    case 'member': return 'Access: any active member of the institution in the token.';
    case 'permission': return `Access: permission \`${rule.code}\` in the institution of the token (campus scope applies).`;
    default: return 'Access: NONE DECLARED — the guard refuses this route.';
  }
}

// Cast avoids TS2589 (zod-to-json-schema generics on ZodTypeAny).
const toSchema = (schema: ZodTypeAny): Json =>
  (zodToJsonSchema as (s: unknown, o: unknown) => unknown)(schema, { target: 'openApi3', $refStrategy: 'none' }) as Json;

/**
 * Builds the OpenAPI 3 document. Request bodies and query parameters come from the same Zod
 * schemas that validate requests (via ZodPipe), and each operation states its access rule
 * (from the ACCESS_KEY decorator) — so the document cannot drift from the real behaviour.
 */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('EduERP API')
      .setDescription(
        'Multi-tenant School & College ERP. The institution comes from the access token, never from the request body. ' +
          'Errors use RFC 9457 `application/problem+json` with a stable `type` code.',
      )
      .setVersion('v1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .addCookieAuth('eduerp_rt', { type: 'apiKey', in: 'cookie', name: 'eduerp_rt', description: 'Refresh token (httpOnly, path /api/v1/auth)' }, 'refreshCookie')
      .build(),
    { operationIdFactory: (controllerKey, methodKey) => `${controllerKey}_${methodKey}` },
  );

  doc.components ??= {};
  doc.components.schemas = {
    ...doc.components.schemas,
    Problem: {
      type: 'object',
      required: ['type', 'title', 'status'],
      properties: {
        type: { type: 'string', example: 'validation-failed' },
        title: { type: 'string', example: 'UNPROCESSABLE_ENTITY' },
        status: { type: 'integer', example: 422 },
        detail: { type: 'string' },
        instance: { type: 'string' },
        requestId: { type: 'string' },
        errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
      },
    },
  };

  // operationId -> controller handler
  const handlers = new Map<string, { ctrl: Type<unknown>; method: string; fn: (...a: unknown[]) => unknown }>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as Type<unknown> | null;
      if (!ctrl) continue;
      for (const method of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (method === 'constructor') continue;
        handlers.set(`${ctrl.name}_${method}`, { ctrl, method, fn: ctrl.prototype[method] });
      }
    }
  }

  for (const pathItem of Object.values(doc.paths)) {
    for (const [verb, raw] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) continue;
      const op = raw as Operation;
      const h = op.operationId ? handlers.get(op.operationId) : undefined;
      if (!h) continue;

      const rule = Reflect.getMetadata(ACCESS_KEY, h.fn) as AccessRule | undefined;
      op['x-access'] = rule ?? null;
      op.description = [describeAccess(rule), op.description].filter(Boolean).join('\n\n');
      if (rule && rule.kind !== 'public') {
        op.security = [{ bearer: [] }];
        op.responses['401'] ??= problem('Not signed in, or the session has ended');
        op.responses['403'] ??= problem('Signed in but not allowed (permission, scope, or read-only institution)');
      }

      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, h.ctrl, h.method) ?? {}) as Record<string, { pipes?: unknown[] }>;
      for (const [key, arg] of Object.entries(args)) {
        const pipe = arg.pipes?.find((p): p is ZodPipe<ZodTypeAny> => p instanceof ZodPipe);
        if (!pipe) continue;
        const type = Number(key.split(':')[0]);
        const schema = toSchema(pipe.schema);
        if (type === RouteParamtypes.BODY) {
          const consumes = (Reflect.getMetadata('swagger/apiConsumes', h.fn) as string[] | undefined) ?? [];
          if (consumes.includes('multipart/form-data')) {
            const props = { ...((schema.properties as Json | undefined) ?? {}), file: { type: 'string', format: 'binary' } };
            const required = [...(((schema.required as string[] | undefined) ?? [])), 'file'];
            op.requestBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: props, required } } } };
          } else {
            op.requestBody = { required: true, content: { 'application/json': { schema } } };
          }
        } else if (type === RouteParamtypes.QUERY) {
          const props = (schema.properties ?? {}) as Record<string, Json>;
          const required = new Set((schema.required as string[] | undefined) ?? []);
          op.parameters = [
            ...(op.parameters ?? []).filter((p) => p.in !== 'query'),
            ...Object.entries(props).map(([name, s]) => ({ name, in: 'query', required: required.has(name), schema: s })),
          ];
        }
        op.responses['422'] ??= problem('Input failed validation; `errors` lists each field');
      }
    }
  }
  return doc;
}

/** Serves Swagger UI at /api/docs and the raw document at /api/docs-json. */
export function mountApiDocs(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'api/docs-json', customSiteTitle: 'EduERP API' });
}
