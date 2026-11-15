import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, from, lastValueFrom } from 'rxjs';
import { Prisma } from '@eduerp/db';
import { Db } from './prisma.service';
import { AppError, Conflict } from './problem';
import type { AuthContext } from './auth-context';

const TTL_HOURS = 24;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Idempotency keys (G-12 platform). A client may send `Idempotency-Key: <uuid>` on a write. The first
 * request reserves the key, runs, and stores its response; a retry with the same key and the same body
 * gets that stored response instead of running again (no double admission, receipt or academic year
 * after a timeout). Same key + different body → 422; same key while the first is still running → 409.
 * Only successful responses are stored, so a failed attempt can be retried with the same key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'] as string | undefined;
    const auth = req.auth as AuthContext | undefined;
    if (!key || !MUTATING.has(req.method) || !auth?.tenantId || req.is?.('multipart/form-data')) return next.handle();
    return from(this.run(ctx, next, key.trim(), auth));
  }

  private async run(ctx: ExecutionContext, next: CallHandler, key: string, auth: AuthContext): Promise<unknown> {
    if (!/^[\w-]{8,100}$/.test(key)) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'idempotency-key-invalid', 'Idempotency-Key must be 8–100 letters, digits, - or _');
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const endpoint = `${req.method} ${req.route?.path ?? req.path}`.slice(0, 200);
    const requestHash = createHash('sha256').update(JSON.stringify({ url: req.originalUrl, body: req.body ?? null })).digest('hex');
    const tctx = { tenantId: auth.tenantId, userId: auth.userId };

    // Reserve the key (unique per tenant + key + endpoint) in its own short transaction.
    const reserved = await this.db.run(tctx, async (tx) => {
      await tx.idempotencyKey.deleteMany({ where: { key, endpoint, expiresAt: { lt: new Date() } } });
      const prior = await tx.idempotencyKey.findUnique({ where: { tenantId_key_endpoint: { tenantId: auth.tenantId!, key, endpoint } } });
      if (prior) return prior;
      try {
        await tx.idempotencyKey.create({ data: { tenantId: auth.tenantId!, key, endpoint, requestHash, expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000) } });
        return null;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'race' as const;
        throw e;
      }
    });

    if (reserved === 'race') throw Conflict('request-in-progress', 'This request is already being processed');
    if (reserved) {
      if (reserved.requestHash !== requestHash) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'idempotency-key-reused', 'This Idempotency-Key was already used for a different request');
      if (reserved.status !== 'DONE') throw Conflict('request-in-progress', 'This request is already being processed');
      res.status(reserved.responseStatus ?? 200);
      res.setHeader('Idempotent-Replay', 'true');
      return reserved.responseBody;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.db.run(tctx, (tx) =>
        tx.idempotencyKey.update({
          where: { tenantId_key_endpoint: { tenantId: auth.tenantId!, key, endpoint } },
          data: { status: 'DONE', responseStatus: res.statusCode, responseBody: body === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue) },
        }),
      );
      return body;
    } catch (e) {
      // Failed attempts are not remembered: the client can retry with the same key.
      await this.db.run(tctx, (tx) => tx.idempotencyKey.deleteMany({ where: { key, endpoint } })).catch(() => undefined);
      throw e;
    }
  }
}
