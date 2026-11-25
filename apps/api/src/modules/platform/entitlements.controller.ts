import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AssignPlanInput, CreatePlanInput, ModuleOverrideInput, UpdatePlanInput, assignPlanSchema, createPlanSchema, moduleOverrideSchema, updatePlanSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, PlatformRoute, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { EntitlementsService } from './entitlements.service';

@Controller('platform')
export class PlansController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT')
  @Get('plans')
  listPlans() {
    return this.entitlements.listPlans();
  }

  @PlatformRoute('SUPER_ADMIN')
  @Post('plans')
  createPlan(@Body(zod(createPlanSchema)) body: CreatePlanInput) {
    return this.entitlements.createPlan(body);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Patch('plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updatePlanSchema)) body: UpdatePlanInput) {
    return this.entitlements.updatePlan(id, body);
  }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT')
  @Get('tenants/:id/entitlements')
  tenantEntitlements(@Param('id', ParseUUIDPipe) id: string) {
    return this.entitlements.tenantEntitlements(id);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Post('tenants/:id/subscription')
  assignPlan(@Param('id', ParseUUIDPipe) id: string, @Body(zod(assignPlanSchema)) body: AssignPlanInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.entitlements.assignPlan(id, body, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Put('tenants/:id/modules')
  overrideModule(@Param('id', ParseUUIDPipe) id: string, @Body(zod(moduleOverrideSchema)) body: ModuleOverrideInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.entitlements.overrideModule(id, body, auth, client);
  }
}

/** The signed-in member's institution: plan and enabled modules (drives the web menu). */
@Controller('me')
export class MyModulesController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @TenantMember()
  @Get('modules')
  mine(@Auth() auth: AuthContext) {
    return this.entitlements.mine(auth);
  }
}
