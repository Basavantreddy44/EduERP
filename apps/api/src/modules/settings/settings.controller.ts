import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { PERMISSIONS, PutSettingInput, putSettingSchema, settingsQuerySchema } from '@eduerp/shared';
import type { z } from 'zod';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Every registered setting with its effective value and where that value comes from. */
  @RequirePermission(PERMISSIONS.ORG_SETTINGS_READ)
  @Get()
  list(@Query(zod(settingsQuerySchema)) q: z.infer<typeof settingsQuerySchema>, @Auth() auth: AuthContext) {
    return this.settings.list(auth, q.campusId);
  }

  @RequirePermission(PERMISSIONS.ORG_SETTINGS_UPDATE)
  @Put(':key')
  put(@Param('key') key: string, @Body(zod(putSettingSchema)) body: PutSettingInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.settings.put(key, body, auth, client);
  }

  /** Removes the institution value (no campus) or a campus override. */
  @RequirePermission(PERMISSIONS.ORG_SETTINGS_UPDATE)
  @Delete(':key')
  reset(@Param('key') key: string, @Query(zod(settingsQuerySchema)) q: z.infer<typeof settingsQuerySchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.settings.reset(key, q.campusId ?? null, auth, client);
  }
}
