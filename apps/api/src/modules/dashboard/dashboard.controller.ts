import { Controller, Get, Query } from '@nestjs/common';
import { DashboardQuery, dashboardQuerySchema } from '@eduerp/shared';
import { Auth, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { DashboardService } from './dashboard.service';

/** Home dashboard (M4.1). Any member may call it; each block appears only with the matching permission. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Today's figures for one campus, or every campus the user can see. */
  @TenantMember()
  @Get('summary')
  summary(@Query(zod(dashboardQuerySchema)) q: DashboardQuery, @Auth() auth: AuthContext) {
    return this.dashboard.summary(q, auth);
  }

  /** Fee collection (last 30 days) and student attendance % (last 4 weeks), per day. */
  @TenantMember()
  @Get('trends')
  trends(@Query(zod(dashboardQuerySchema)) q: DashboardQuery, @Auth() auth: AuthContext) {
    return this.dashboard.trends(q, auth);
  }
}
