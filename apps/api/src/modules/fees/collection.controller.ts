import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { BounceInput, CollectInput, PERMISSIONS, bounceSchema, cancelReceiptSchema, closeCounterSchema, collectSchema, openCounterSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeCollectionService } from './collection.service';

@RequireModule('FEES')
@Controller('fees')
export class FeeCollectionController {
  constructor(private readonly collection: FeeCollectionService) {}

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Get('counter')
  counter(@Auth() auth: AuthContext) {
    return this.collection.counter(auth);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('counter/open')
  open(@Body(zod(openCounterSchema)) body: z.infer<typeof openCounterSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.collection.openCounter(body.campusId, body.openingCash, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('counter/:id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Body(zod(closeCounterSchema)) body: z.infer<typeof closeCounterSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.collection.closeCounter(id, body.countedCash, body.remarks, auth, client);
  }

  /** Send an Idempotency-Key header: a retried "Collect" returns the first receipt instead of charging twice. */
  @RequirePermission(PERMISSIONS.FEE_COLLECT)
  @Post('payments')
  collect(@Body(zod(collectSchema)) body: CollectInput, @Headers('idempotency-key') key: string | undefined, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.collection.collect(body, key?.trim() || null, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('payments/:id')
  receipt(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.collection.receipt(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_RECEIPT_CANCEL)
  @Post('payments/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(cancelReceiptSchema)) body: z.infer<typeof cancelReceiptSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.collection.cancel(id, body.reason, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_RECEIPT_CANCEL)
  @Post('payments/:id/bounce')
  bounce(@Param('id', ParseUUIDPipe) id: string, @Body(zod(bounceSchema)) body: BounceInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.collection.bounce(id, body, auth, client);
  }
}
