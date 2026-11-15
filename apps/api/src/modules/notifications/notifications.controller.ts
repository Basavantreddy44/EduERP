import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { PutPreferenceInput, notificationsQuerySchema, putPreferenceSchema } from '@eduerp/shared';
import { Auth, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { NotificationsService } from './notifications.service';

/** The signed-in user's own inbox and preferences in the current institution. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @TenantMember()
  @Get()
  inbox(@Query(zod(notificationsQuerySchema)) q: z.infer<typeof notificationsQuerySchema>, @Auth() auth: AuthContext) {
    return this.notifications.inbox(auth, q.unreadOnly === 'true', q.limit);
  }

  @TenantMember()
  @Post('read-all')
  markAllRead(@Auth() auth: AuthContext) {
    return this.notifications.markAllRead(auth);
  }

  @TenantMember()
  @Get('preferences')
  preferences(@Auth() auth: AuthContext) {
    return this.notifications.preferences(auth);
  }

  @TenantMember()
  @Put('preferences')
  setPreference(@Body(zod(putPreferenceSchema)) body: PutPreferenceInput, @Auth() auth: AuthContext) {
    return this.notifications.setPreference(body, auth);
  }

  @TenantMember()
  @Post(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.notifications.markRead(id, auth);
  }
}
