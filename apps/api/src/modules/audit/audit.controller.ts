import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS, pageQuerySchema } from '@eduerp/shared';
import { z } from 'zod';
import { Auth, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { Db } from '../../common/prisma.service';
import { zod } from '../../common/zod.pipe';

const auditQuery = pageQuerySchema.extend({ entityType: z.string().max(50).optional(), entityId: z.string().uuid().optional() });

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly db: Db) {}

  @RequirePermission(PERMISSIONS.AUDIT_LOG_READ)
  @Get()
  async list(@Query(zod(auditQuery)) q: z.infer<typeof auditQuery>, @Auth() auth: AuthContext) {
    const where = { ...(q.entityType && { entityType: q.entityType }), ...(q.entityId && { entityId: q.entityId }) };
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        tx.auditLog.count({ where }),
      ]);
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }
}
