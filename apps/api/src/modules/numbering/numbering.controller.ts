import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateSequenceInput, PERMISSIONS, createSequenceSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { NumberingService } from './numbering.service';

@Controller('numbering/sequences')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @RequirePermission(PERMISSIONS.ORG_NUMBERING_MANAGE)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.numbering.list(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_NUMBERING_MANAGE)
  @Post()
  create(@Body(zod(createSequenceSchema)) body: CreateSequenceInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.numbering.create(body, auth, client);
  }
}
