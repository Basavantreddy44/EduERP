import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IssueTcInput, PERMISSIONS, PromotionInput, issueTcSchema, promotionSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { StudentLifecycleService } from './lifecycle.service';

/** Year-end promotion and Transfer Certificates (M1.4). */
@RequireModule('STUDENTS')
@Controller()
export class StudentLifecycleController {
  constructor(private readonly lifecycle: StudentLifecycleService) {}

  @RequirePermission(PERMISSIONS.STU_PROMOTE)
  @Get('promotions/options')
  options(@Auth() auth: AuthContext) {
    return this.lifecycle.options(auth);
  }

  @RequirePermission(PERMISSIONS.STU_PROMOTE)
  @Get('promotions')
  runs(@Auth() auth: AuthContext) {
    return this.lifecycle.runs(auth);
  }

  /** Who goes where, with any problems (missing sections, too few seats). Nothing changes. */
  @RequirePermission(PERMISSIONS.STU_PROMOTE)
  @Post('promotions/preview')
  @HttpCode(200)
  preview(@Body(zod(promotionSchema)) body: PromotionInput, @Auth() auth: AuthContext) {
    return this.lifecycle.preview(body, auth);
  }

  @RequirePermission(PERMISSIONS.STU_PROMOTE)
  @Post('promotions')
  commit(@Body(zod(promotionSchema)) body: PromotionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.lifecycle.commit(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_TC_ISSUE)
  @Post('students/:id/tc')
  issueTc(@Param('id', ParseUUIDPipe) id: string, @Body(zod(issueTcSchema)) body: IssueTcInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.lifecycle.issueTc(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get('students/:id/tcs')
  tcsOf(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.lifecycle.tcsOf(id, auth);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get('transfer-certificates/:id')
  tc(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.lifecycle.tc(id, auth);
  }
}
