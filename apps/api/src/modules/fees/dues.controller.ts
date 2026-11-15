import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DuesQuery, PERMISSIONS, RemindInput, ReportQuery, duesQuerySchema, remindSchema, reportQuerySchema, waiveFineSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeDuesService } from './dues.service';

const campusQuery = z.object({ campusId: z.string().uuid().optional() });

@RequireModule('FEES')
@Controller('fees')
export class FeeDuesController {
  constructor(private readonly dues: FeeDuesService) {}

  /** Students with dues, ageing buckets and totals (to the paisa, from open bills). */
  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('dues')
  list(@Query(zod(duesQuerySchema)) q: DuesQuery, @Auth() auth: AuthContext) {
    return this.dues.dues(auth, q);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('late-fees/apply')
  applyLateFees(@Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.dues.applyLateFees(auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('invoices/:id/waive-fine')
  waive(@Param('id', ParseUUIDPipe) id: string, @Body(zod(waiveFineSchema)) body: z.infer<typeof waiveFineSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.dues.waiveFine(id, body.reason, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('reminders')
  remind(@Body(zod(remindSchema)) body: RemindInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.dues.remind(body, auth, client);
  }

  /** Whether a student owes nothing (used before a Transfer Certificate). */
  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('students/:id/no-dues')
  noDues(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.dues.noDues(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('reports/collection')
  collection(@Query(zod(reportQuerySchema)) q: ReportQuery, @Auth() auth: AuthContext) {
    return this.dues.collection(q, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('reports/by-head')
  byHead(@Query(zod(reportQuerySchema)) q: ReportQuery, @Auth() auth: AuthContext) {
    return this.dues.byHead(q, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('reports/dues-by-class')
  duesByClass(@Query(zod(campusQuery)) q: z.infer<typeof campusQuery>, @Auth() auth: AuthContext) {
    return this.dues.duesByClass(auth, q.campusId);
  }
}
