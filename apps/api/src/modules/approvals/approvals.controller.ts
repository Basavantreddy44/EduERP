import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ApprovalActionInput, CreateApprovalRuleInput, PERMISSIONS, approvalActionSchema, approvalListQuerySchema, createApprovalRuleSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { ApprovalsService } from './approvals.service';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @RequirePermission(PERMISSIONS.APPROVALS_RULE_MANAGE)
  @Get('rules')
  listRules(@Auth() auth: AuthContext) {
    return this.approvals.listRules(auth);
  }

  @RequirePermission(PERMISSIONS.APPROVALS_RULE_MANAGE)
  @Post('rules')
  createRule(@Body(zod(createApprovalRuleSchema)) body: CreateApprovalRuleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.approvals.createRule(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.APPROVALS_RULE_MANAGE)
  @Post('rules/:id/deactivate')
  deactivateRule(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.approvals.deactivateRule(id, auth, client);
  }

  /** Requests waiting for my decision. */
  @TenantMember()
  @Get('inbox')
  inbox(@Auth() auth: AuthContext) {
    return this.approvals.inbox(auth);
  }

  @RequirePermission(PERMISSIONS.APPROVALS_REQUEST_READ)
  @Get('requests')
  list(@Query(zod(approvalListQuerySchema)) q: z.infer<typeof approvalListQuerySchema>, @Auth() auth: AuthContext) {
    return this.approvals.list(auth, q.status, q.entityType);
  }

  @TenantMember()
  @Get('requests/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.approvals.get(id, auth);
  }

  @TenantMember()
  @Post('requests/:id/act')
  act(@Param('id', ParseUUIDPipe) id: string, @Body(zod(approvalActionSchema)) body: ApprovalActionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.approvals.act(id, body, auth, client);
  }

  @TenantMember()
  @Post('requests/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.approvals.cancel(id, auth, client);
  }
}
