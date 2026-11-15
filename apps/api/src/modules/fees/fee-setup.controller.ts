import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CopyFeeStructureInput, CreateFeeHeadInput, FeeStructureInput, LateFeeRuleInput, PERMISSIONS, UpdateFeeHeadInput, UpdateFeeStructureInput,
  copyFeeStructureSchema, createFeeHeadSchema, feeStructureQuerySchema, feeStructureSchema, lateFeeRuleSchema, updateFeeHeadSchema, updateFeeStructureSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { FeeSetupService } from './fee-setup.service';

const ruleUpdateSchema = z.intersection(lateFeeRuleSchema, z.object({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }));

@RequireModule('FEES')
@Controller('fees')
export class FeeSetupController {
  constructor(private readonly fees: FeeSetupService) {}

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('setup/options')
  options(@Auth() auth: AuthContext) {
    return this.fees.options(auth);
  }

  // Fee heads (listed by setup/options)

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('heads')
  createHead(@Body(zod(createFeeHeadSchema)) body: CreateFeeHeadInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.createHead(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Patch('heads/:id')
  updateHead(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateFeeHeadSchema)) body: UpdateFeeHeadInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.updateHead(id, body, auth, client);
  }

  // Structures

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('structures')
  structures(@Query(zod(feeStructureQuerySchema)) q: z.infer<typeof feeStructureQuerySchema>, @Auth() auth: AuthContext) {
    return this.fees.structures(auth, q);
  }

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('structures/:id')
  structure(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.fees.structure(id, auth);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures')
  create(@Body(zod(feeStructureSchema)) body: FeeStructureInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.createStructure(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Patch('structures/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateFeeStructureSchema)) body: UpdateFeeStructureInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.updateStructure(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Delete('structures/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.remove(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures/:id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.activate(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures/:id/assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.assign(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures/:id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.close(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures/:id/revise')
  revise(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.revise(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('structures/:id/copy')
  copy(@Param('id', ParseUUIDPipe) id: string, @Body(zod(copyFeeStructureSchema)) body: CopyFeeStructureInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.copy(id, body, auth, client);
  }

  // Late fee rules

  @RequirePermission(PERMISSIONS.FEE_READ)
  @Get('late-fee-rules')
  rules(@Auth() auth: AuthContext) {
    return this.fees.lateFeeRules(auth);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Post('late-fee-rules')
  createRule(@Body(zod(lateFeeRuleSchema)) body: LateFeeRuleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.saveLateFeeRule(null, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.FEE_SETUP_MANAGE)
  @Patch('late-fee-rules/:id')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body(zod(ruleUpdateSchema)) body: z.infer<typeof ruleUpdateSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.fees.saveLateFeeRule(id, body, auth, client);
  }
}
