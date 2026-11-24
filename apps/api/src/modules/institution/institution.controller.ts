import { Body, Controller, Delete, Get, Param, Post, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { InstitutionProfileInput, LOGO_MAX_BYTES, PERMISSIONS, institutionProfileSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, Public, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import type { UploadedBlob } from '../files/files.service';
import { InstitutionService } from './institution.service';

const slugParam = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/);

@Controller('institution')
export class InstitutionController {
  constructor(private readonly inst: InstitutionService) {}

  @RequirePermission(PERMISSIONS.ORG_SETTINGS_READ)
  @Get('profile')
  profile(@Auth() auth: AuthContext) {
    return this.inst.profile(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_SETTINGS_UPDATE)
  @Put('profile')
  saveProfile(@Body(zod(institutionProfileSchema)) body: InstitutionProfileInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.inst.saveProfile(body, auth, client);
  }

  /** multipart/form-data with `file`: PNG, JPEG or WebP, at most 1 MB. */
  @RequirePermission(PERMISSIONS.ORG_SETTINGS_UPDATE)
  @Post('logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1, fields: 2 } }))
  setLogo(@UploadedFile() file: UploadedBlob | undefined, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.inst.setLogo(file, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_SETTINGS_UPDATE)
  @Delete('logo')
  removeLogo(@Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.inst.removeLogo(auth, client);
  }
}

/** The institution's name and logo for its own sign-in page and printed documents (no sign-in). */
@Controller('public/branding')
export class BrandingController {
  constructor(private readonly inst: InstitutionService) {}

  @Public()
  @Get(':slug')
  branding(@Param('slug', zod(slugParam)) slug: string) {
    return this.inst.publicBranding(slug);
  }

  @Public()
  @Get(':slug/logo')
  async logo(@Param('slug', zod(slugParam)) slug: string, @Res({ passthrough: true }) res: Response) {
    const l = await this.inst.publicLogo(slug);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    return new StreamableFile(l.stream, { type: l.mimeType, length: l.size, disposition: 'inline' });
  }
}
