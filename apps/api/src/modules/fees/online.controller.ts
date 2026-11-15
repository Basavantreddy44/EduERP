import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CreatePayLinkInput, PERMISSIONS, RequestRefundInput, confirmOnlineSchema, createPayLinkSchema, requestRefundSchema, simulatePaySchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, Public, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeOnlineService } from './online.service';

const tokenParam = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

@RequireModule('FEES')
@Controller('fees')
export class FeeOnlineController {
  constructor(private readonly online: FeeOnlineService) {}

  /** Whether online payment is available here (razorpay / simulated / off). */
  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('online/status')
  status() {
    return { gateway: this.online.gateway.mode };
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('pay-links')
  createLink(@Body(zod(createPayLinkSchema)) body: CreatePayLinkInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.online.createLink(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('students/:id/pay-links')
  links(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.online.links(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('pay-links/:id/cancel')
  cancelLink(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.online.cancelLink(id, auth, client);
  }

  /** Checks unfinished online payments with the gateway now (the worker also does this every few minutes). */
  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('online/recheck')
  recheck(@Auth() auth: AuthContext) {
    return this.online.reconcileMine(auth);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('payments/:id/refunds')
  refund(@Param('id', ParseUUIDPipe) id: string, @Body(zod(requestRefundSchema)) body: RequestRefundInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.online.requestRefund(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('students/:id/refunds')
  refunds(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.online.refunds(id, auth);
  }
}

/** The page a parent opens from a payment link. No login: the long random token is the key. */
@Controller('public/pay')
export class PublicPayController {
  constructor(private readonly online: FeeOnlineService) {}

  @Public()
  @Get(':token')
  view(@Param('token', zod(tokenParam)) token: string) {
    return this.online.publicView(token);
  }

  @Public()
  @Post(':token/order')
  order(@Param('token', zod(tokenParam)) token: string) {
    return this.online.publicOrder(token);
  }

  /** Simulated gateway only (development / tests): stands in for the checkout window. */
  @Public()
  @Post(':token/simulate')
  simulate(@Param('token', zod(tokenParam)) token: string, @Body(zod(simulatePaySchema)) body: z.infer<typeof simulatePaySchema>) {
    return this.online.publicSimulate(token, body.orderId, body.outcome);
  }

  @Public()
  @HttpCode(200)
  @Post(':token/confirm')
  confirm(@Param('token', zod(tokenParam)) token: string, @Body(zod(confirmOnlineSchema)) body: z.infer<typeof confirmOnlineSchema>) {
    return this.online.publicConfirm(token, body.orderId, body.paymentId, body.signature);
  }
}

/** Razorpay webhook. The signature is checked over the exact raw body; every call is logged. */
@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly online: FeeOnlineService) {}

  @Public()
  @HttpCode(200)
  @Post('razorpay')
  razorpay(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string, @Headers('x-razorpay-event-id') eventId?: string) {
    return this.online.webhook(req.rawBody ?? Buffer.from(''), signature, eventId?.slice(0, 80));
  }
}
