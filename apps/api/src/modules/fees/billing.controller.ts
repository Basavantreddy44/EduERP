import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  BillingRunInput, ConcessionInput, ExtraChargeInput, PERMISSIONS, assignStructureSchema, billingRunSchema, cancelInvoiceSchema, concessionSchema, extraChargeSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeBillingService } from './billing.service';

const runsQuery = z.object({ academicYearId: z.string().uuid().optional() });

@RequireModule('FEES')
@Controller('fees')
export class FeeBillingController {
  constructor(private readonly billing: FeeBillingService) {}

  /** What a billing run would do (students, amounts per class, students without fees). */
  @RequirePermission(PERMISSIONS.FEE_READ)
  @Post('billing/preview')
  async preview(@Body(zod(billingRunSchema)) body: BillingRunInput, @Auth() auth: AuthContext) {
    return (await this.billing.preview(body, auth)).summary;
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('billing/runs')
  run(@Body(zod(billingRunSchema)) body: BillingRunInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.run(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('billing/runs')
  runs(@Query(zod(runsQuery)) q: z.infer<typeof runsQuery>, @Auth() auth: AuthContext) {
    return this.billing.runs(auth, q.academicYearId);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('students/:id')
  account(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.billing.account(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('students/:id/assignment')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(zod(assignStructureSchema)) body: z.infer<typeof assignStructureSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.changeAssignment(id, body.feeStructureId, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('students/:id/charges')
  charge(@Param('id', ParseUUIDPipe) id: string, @Body(zod(extraChargeSchema)) body: ExtraChargeInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.extraCharge(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_CONCESSION_REQUEST)
  @Post('students/:id/concessions')
  concession(@Param('id', ParseUUIDPipe) id: string, @Body(zod(concessionSchema)) body: ConcessionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.requestConcession(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('concessions/:id/cancel')
  cancelConcession(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.cancelConcession(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_BILL)
  @Post('invoices/:id/cancel')
  cancelInvoice(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelInvoiceSchema)) body: z.infer<typeof cancelInvoiceSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.cancelInvoice(id, body.reason, auth, client);
  }
}
