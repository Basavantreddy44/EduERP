import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ChangeEditionInput, EditionCode, changeEditionSchema, createTenantSchema, editionSchema, updateTenantStatusSchema, CreateTenantInput } from '@eduerp/shared';
import { Auth, Client, ClientInfo, PlatformRoute } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { TenantsService } from './tenants.service';

@Controller('platform/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT')
  @Get()
  list(@Query(zod(z.object({ edition: editionSchema.optional() }))) q: { edition?: EditionCode }) {
    return this.tenants.list(q.edition);
  }

  @PlatformRoute('SUPER_ADMIN', 'SUPPORT')
  @Get(':id/edition-preview')
  editionPreview(@Param('id', ParseUUIDPipe) id: string, @Query(zod(z.object({ edition: editionSchema }))) q: { edition: EditionCode }) {
    return this.tenants.editionPreview(id, q.edition);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Patch(':id/edition')
  changeEdition(@Param('id', ParseUUIDPipe) id: string, @Body(zod(changeEditionSchema)) body: ChangeEditionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.tenants.changeEdition(id, body, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Post()
  create(@Body(zod(createTenantSchema)) body: CreateTenantInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.tenants.create(body, auth, client);
  }

  @PlatformRoute('SUPER_ADMIN')
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateTenantStatusSchema)) body: { status: string; reason: string },
    @Auth() auth: AuthContext,
    @Client() client: ClientInfo,
  ) {
    return this.tenants.setStatus(id, body.status, body.reason, auth, client);
  }
}
