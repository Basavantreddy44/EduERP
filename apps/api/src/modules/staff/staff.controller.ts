import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ChangeEmployeeStatusInput, CreateEmployeeInput, EmployeeQuery, PERMISSIONS, UpdateEmployeeInput,
  changeEmployeeStatusSchema, createEmployeeSchema, employeeQuerySchema, linkEmployeeUserSchema, updateEmployeeSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { StaffService } from './staff.service';

/** Staff, basic (M3.1). Core (always on): attendance, leave and later HR build on it. */
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermission(PERMISSIONS.HR_STAFF_READ)
  @Get('options')
  options(@Auth() auth: AuthContext) {
    return this.staff.options(auth);
  }

  /** Search by name, employee code, mobile or email; campus / department / type / status filters. */
  @RequirePermission(PERMISSIONS.HR_STAFF_READ)
  @Get()
  list(@Query(zod(employeeQuerySchema)) q: EmployeeQuery, @Auth() auth: AuthContext) {
    return this.staff.list(auth, q);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_MANAGE)
  @Post()
  create(@Body(zod(createEmployeeSchema)) body: CreateEmployeeInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.staff.create(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_READ)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.staff.get(id, auth);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_MANAGE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateEmployeeSchema)) body: UpdateEmployeeInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.staff.update(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_MANAGE)
  @Post(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(zod(changeEmployeeStatusSchema)) body: ChangeEmployeeStatusInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.staff.changeStatus(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_MANAGE)
  @Get(':id/linkable-users')
  linkable(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.staff.linkable(id, auth);
  }

  @RequirePermission(PERMISSIONS.HR_STAFF_MANAGE)
  @Post(':id/user')
  link(@Param('id', ParseUUIDPipe) id: string, @Body(zod(linkEmployeeUserSchema)) body: z.infer<typeof linkEmployeeUserSchema>, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.staff.link(id, body.userId, auth, client);
  }
}
