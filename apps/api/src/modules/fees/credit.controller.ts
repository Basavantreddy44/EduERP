import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdjustCreditInput, CarriedDuesQuery, CreditRefundInput, PERMISSIONS, adjustCreditSchema, cancelAdjustmentSchema, carriedDuesQuery, creditRefundSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeCreditService } from './credit.service';

/** Phase 23: student credit balance and the earlier-year / credit reports. */
@RequireModule('FEES')
@Controller('fees')
export class FeeCreditController {
  constructor(private readonly credit: FeeCreditService) {}

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('students/:id/credit')
  view(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.credit.credit(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('students/:id/credit/adjust')
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body(zod(adjustCreditSchema)) body: AdjustCreditInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.credit.adjust(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('students/:id/credit/refunds')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body(zod(creditRefundSchema)) body: CreditRefundInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.credit.requestRefund(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_RECEIPT_CANCEL)
  @Post('credit-adjustments/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelAdjustmentSchema)) body: z.infer<typeof cancelAdjustmentSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.credit.cancelAdjustment(id, body.reason, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('reports/carried-dues')
  carried(@Query(zod(carriedDuesQuery)) q: CarriedDuesQuery, @Auth() auth: AuthContext) {
    return this.credit.carriedDues(q, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('reports/advances')
  advances(@Query(zod(carriedDuesQuery)) q: CarriedDuesQuery, @Auth() auth: AuthContext) {
    return this.credit.advances(q, auth);
  }
}
