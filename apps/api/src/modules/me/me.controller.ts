import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { zod } from '../../common/zod.pipe';

const preferencesSchema = z.object({ preferredLanguage: z.enum(['en', 'kn']) });
import { Auth, Authenticated } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { buildPermissionMap } from '../../common/access.guard';
import { Db } from '../../common/prisma.service';
import { AuthService } from '../auth/auth.service';

@Controller('me')
export class MeController {
  constructor(
    private readonly db: Db,
    private readonly authService: AuthService,
  ) {}

  @Authenticated()
  @Get()
  async me(@Auth() auth: AuthContext) {
    const user = await this.db.run({ userId: auth.userId }, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { id: true, fullName: true, email: true, phone: true, preferredLanguage: true, platformRole: true },
      }),
    );
    return { user, tenantId: auth.tenantId };
  }

  /** The signed-in person's own preferences (screen language; also used for their emails). */
  @Authenticated()
  @Patch('preferences')
  async setPreferences(@Body(zod(preferencesSchema)) body: z.infer<typeof preferencesSchema>, @Auth() auth: AuthContext) {
    return this.db.run({ userId: auth.userId }, (tx) =>
      tx.user.update({ where: { id: auth.userId }, data: { preferredLanguage: body.preferredLanguage }, select: { preferredLanguage: true } }),
    );
  }

  @Authenticated()
  @Get('memberships')
  memberships(@Auth() auth: AuthContext) {
    return this.authService.memberships(auth.userId);
  }

  /** Permissions in the current tenant, with campus scope. The web uses this to build menus/buttons. */
  @Authenticated()
  @Get('permissions')
  async permissions(@Auth() auth: AuthContext) {
    if (!auth.tenantId) return { tenantId: null, permissions: [] };
    const rows = await this.db.run({ userId: auth.userId, tenantId: auth.tenantId }, async (tx) => {
      const m = await tx.userTenant.findFirst({ where: { tenantId: auth.tenantId!, userId: auth.userId, status: 'ACTIVE' } });
      if (!m) return [];
      return tx.userRole.findMany({
        where: { userId: auth.userId },
        select: { campusId: true, role: { select: { rolePermissions: { select: { permission: { select: { code: true } } } } } } },
      });
    });
    const map = buildPermissionMap(rows);
    return {
      tenantId: auth.tenantId,
      // Sorted by code: a stable order for screens and tests (the role-permission query has none).
      permissions: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, scope]) => ({ code, allCampuses: scope.all, campusIds: scope.all ? [] : [...scope.campusIds].sort() })),
    };
  }
}
