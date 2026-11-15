import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@eduerp/db';
import { config } from '../config';

export type Tx = Prisma.TransactionClient;

/** Database session variables that drive Row Level Security (see migration "Request context helpers"). */
export interface DbContext {
  tenantId?: string | null;
  userId?: string | null;
  isPlatform?: boolean;
  loginIdentifier?: string | null;
  /** Background worker reading across tenants (outbox relay only). Handlers still run in a tenant context. */
  isSystem?: boolean;
}

/**
 * The ONLY way business code touches the database.
 * Connects as the runtime role (no BYPASSRLS). Every unit of work runs in a transaction whose
 * first statement sets transaction-local context, so RLS filters every query - even one that
 * forgets a `tenantId` in its WHERE clause.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  private readonly client = new PrismaClient({ datasourceUrl: config().DATABASE_URL });

  /** `opts.timeout`: longer limit for a known-large unit of work (e.g. committing a 2,000-row import). */
  async run<T>(ctx: DbContext, work: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    return this.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT
          set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
          set_config('app.user_id', ${ctx.userId ?? ''}, true),
          set_config('app.is_platform', ${ctx.isPlatform ? 'on' : ''}, true),
          set_config('app.login_identifier', ${ctx.loginIdentifier ?? ''}, true),
          set_config('app.is_system', ${ctx.isSystem ? 'on' : ''}, true)`;
        return work(tx);
      },
      // maxWait: how long to queue for a free pooled connection during bursts (e.g. a dashboard loading
      // ten widgets at once) instead of failing after Prisma's 2 s default.
      { maxWait: 10_000, timeout: opts?.timeout ?? 15_000 },
    );
  }

  /** Health probe only. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
