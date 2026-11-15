import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PERMISSIONS, inviteUserSchema, InviteUserInput } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.users.list(auth);
  }

  /** Roles of this institution (for the invite form). */
  @RequirePermission(PERMISSIONS.IAM_USER_READ)
  @Get('roles')
  roles(@Auth() auth: AuthContext) {
    return this.users.roles(auth);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post('invite')
  invite(@Body(zod(inviteUserSchema)) body: InviteUserInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.users.invite(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.IAM_USER_INVITE)
  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.users.remove(id, auth, client);
  }
}
