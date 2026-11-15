import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { Db } from '../../common/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.db.ping();
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
