import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { IMPORT_MAX_MB, ImportTypeCode, exportQuerySchema, exportTypeParam, importRowsQuerySchema, importTypeParam } from '@eduerp/shared';
import { Auth, Client, ClientInfo, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { ImportsService } from './imports.service';
import { ExportsService } from './exports.service';

const download = (res: Response, fileName: string, contentType: string, data: Buffer) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return new StreamableFile(data, { type: contentType, length: data.length, disposition: `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}` });
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Access: any member may call these routes; the service then requires the permission of the
 * data being imported (e.g. org.academic.manage for holidays) — one rule per import type.
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @TenantMember()
  @Get('types')
  types(@Auth() auth: AuthContext) {
    return this.imports.types(auth);
  }

  @TenantMember()
  @Get('templates/:type')
  async template(@Param('type', zod(importTypeParam)) type: ImportTypeCode, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const t = await this.imports.template(type, auth);
    return download(res, t.fileName, XLSX, t.data);
  }

  /** multipart/form-data with `file` (.xlsx or .csv). Validates every row; nothing is imported yet. */
  @TenantMember()
  @Post(':type')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_MB * 1024 * 1024 + 1, files: 1 } }))
  upload(@Param('type', zod(importTypeParam)) type: ImportTypeCode, @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined, @Auth() auth: AuthContext) {
    return this.imports.upload(type, file, auth);
  }

  @TenantMember()
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.imports.list(auth);
  }

  @TenantMember()
  @Get('jobs/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.imports.get(id, auth);
  }

  @TenantMember()
  @Get('jobs/:id/rows')
  rows(@Param('id', ParseUUIDPipe) id: string, @Query(zod(importRowsQuerySchema)) q: z.infer<typeof importRowsQuerySchema>, @Auth() auth: AuthContext) {
    return this.imports.rows(id, q, auth);
  }

  @TenantMember()
  @Get('jobs/:id/errors.xlsx')
  async errors(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.imports.errorReport(id, auth);
    return download(res, r.fileName, XLSX, r.data);
  }

  @TenantMember()
  @Post('jobs/:id/commit')
  commit(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.imports.commit(id, auth, client);
  }

  @TenantMember()
  @Post('jobs/:id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.imports.cancel(id, auth);
  }
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** Access: member; the service requires read permission for the exported list. */
  @TenantMember()
  @Get(':type')
  async export(
    @Param('type', zod(exportTypeParam)) type: string,
    @Query(zod(exportQuerySchema)) q: z.infer<typeof exportQuerySchema>,
    @Auth() auth: AuthContext,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.exportsService.export(type, q.format, auth, client);
    return download(res, f.fileName, f.contentType, f.data);
  }
}
