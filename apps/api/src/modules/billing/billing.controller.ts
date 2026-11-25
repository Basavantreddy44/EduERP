import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  BillingCycleInput, BillingReasonInput, BillingSettingsInput, PERMISSIONS, RecordPlatformPaymentInput, TenantBillingInput,
  billingCycleSchema, billingReasonSchema, billingSettingsSchema, platformInvoiceQuery, recordPlatformPaymentSchema, tenantBillingSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, PlatformRoute, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { BillingService } from './billing.service';

/** Platform console → Billing (Phase 22). Support staff can look; only the super admin changes anything. */
@Controller('platform/billing')
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT') @Get('settings')
  settings() { return this.billing.settings(); }

  @PlatformRoute('SUPER_ADMIN') @Put('settings')
  saveSettings(@Body(zod(billingSettingsSchema)) b: BillingSettingsInput, @Auth() auth: AuthContext) { return this.billing.saveSettings(b, auth); }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT') @Get('summary')
  summary() { return this.billing.summary(); }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT') @Get('invoices')
  invoices(@Query(zod(platformInvoiceQuery)) q: z.infer<typeof platformInvoiceQuery>) { return this.billing.invoices(q); }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT') @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string) { return this.billing.invoice(id); }

  @PlatformRoute('SUPER_ADMIN') @Post('invoices/:id/payments')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body(zod(recordPlatformPaymentSchema)) b: RecordPlatformPaymentInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.recordPayment(id, b, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN') @Post('invoices/:id/cancel') @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(billingReasonSchema)) b: BillingReasonInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.cancelInvoice(id, b.reason, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN') @Post('payments/:id/reverse') @HttpCode(200)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body(zod(billingReasonSchema)) b: BillingReasonInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.reversePayment(id, b.reason, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN') @Post('run') @HttpCode(200)
  run() { return this.billing.runAll(); }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT') @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string) { return this.billing.tenantBilling(id); }

  @PlatformRoute('SUPER_ADMIN') @Patch('tenants/:id')
  updateTenant(@Param('id', ParseUUIDPipe) id: string, @Body(zod(tenantBillingSchema)) b: TenantBillingInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.updateTenantBilling(id, b, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN') @Patch('tenants/:id/cycle')
  cycle(@Param('id', ParseUUIDPipe) id: string, @Body(zod(billingCycleSchema)) b: BillingCycleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.changeCycle(id, b.billingCycle, auth, client);
  }
}

/** Settings → Subscription & bills: the institution's own plan, bills and payments (read-only accounts can still look). */
@Controller('billing')
export class InstitutionBillingController {
  constructor(private readonly billing: BillingService) {}

  @RequirePermission(PERMISSIONS.ORG_BILLING) @Get()
  mine(@Auth() auth: AuthContext) { return this.billing.mine(auth); }

  @RequirePermission(PERMISSIONS.ORG_BILLING) @Get('invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.billing.myInvoice(id, auth); }

  @RequirePermission(PERMISSIONS.ORG_BILLING) @Put('cycle')
  cycle(@Body(zod(billingCycleSchema)) b: BillingCycleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.billing.changeCycle(auth.tenantId!, b.billingCycle, auth, client);
  }
}
