import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS, inviteUserSchema, InviteUserInput, roleSchema, RoleInput, assignRoleSchema, AssignRoleInput } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { UsersService } from './users.service';
import { AccessService } from './access.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly access: AccessService) {}

  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.users.list(auth);
  }

  /** The rights catalogue of this institution's switched-on modules, grouped by module. */
  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get('permissions')
  permissions(@Auth() auth: AuthContext) {
    return this.access.permissions(auth);
  }

  /** Roles master: built-in (fixed templates) and the institution's own roles. */
  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get('roles')
  roles(@Auth() auth: AuthContext) {
    return this.access.roles(auth);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get('roles/:id')
  role(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.access.role(id, auth);
  }

  @RequirePermission(PERMISSIONS.IAM_ROLE_MANAGE)
  @Post('roles')
  createRole(@Body(zod(roleSchema)) body: RoleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.createRole(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_ROLE_MANAGE)
  @Put('roles/:id')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body(zod(roleSchema)) body: RoleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.updateRole(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_ROLE_MANAGE)
  @Post('roles/:id/delete')
  @HttpCode(200)
  deleteRole(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.deleteRole(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post('invite')
  invite(@Body(zod(inviteUserSchema)) body: InviteUserInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.users.invite(body, auth, client);
  }

  /** One person's access: roles per campus, linked staff / student / parent record, effective rights. */
  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get(':id')
  user(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.access.user(id, auth);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post(':id/roles')
  addRole(@Param('id', ParseUUIDPipe) id: string, @Body(zod(assignRoleSchema)) body: AssignRoleInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.addRole(id, body.roleId, body.campusId ?? null, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post(':id/roles/:userRoleId/remove')
  @HttpCode(200)
  removeRole(@Param('id', ParseUUIDPipe) id: string, @Param('userRoleId', ParseUUIDPipe) userRoleId: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.removeRole(id, userRoleId, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post(':id/password-link')
  @HttpCode(200)
  passwordLink(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.access.passwordLink(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.users.remove(id, auth, client);
  }
}
