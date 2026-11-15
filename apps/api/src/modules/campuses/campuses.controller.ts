import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PERMISSIONS, createCampusSchema, updateCampusSchema, CreateCampusInput, UpdateCampusInput } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { CampusesService } from './campuses.service';

@Controller('campuses')
export class CampusesController {
  constructor(private readonly campuses: CampusesService) {}

  @RequirePermission(PERMISSIONS.ORG_CAMPUS_READ)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.campuses.list(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_CAMPUS_READ)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.campuses.get(id, auth);
  }

  @RequirePermission(PERMISSIONS.ORG_CAMPUS_CREATE)
  @Post()
  create(@Body(zod(createCampusSchema)) body: CreateCampusInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.campuses.create(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_CAMPUS_UPDATE)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateCampusSchema)) body: UpdateCampusInput,
    @Auth() auth: AuthContext,
    @Client() client: ClientInfo,
  ) {
    return this.campuses.update(id, body, auth, client);
  }
}
