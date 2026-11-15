import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema, switchTenantSchema, LoginInput, ResetPasswordInput } from '@eduerp/shared';
import { z } from 'zod';
import { AccountLinksService } from './account-links.service';
import { config } from '../../config';
import { Auth, Authenticated, Client, ClientInfo, Public } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AppError } from '../../common/problem';
import { AuthService, SessionResult } from './auth.service';

export const REFRESH_COOKIE = 'eduerp_rt';
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly links: AccountLinksService,
  ) {}

  /** Always 202 with the same message, whether or not the email exists. */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body(zod(forgotPasswordSchema)) body: { email: string }) {
    await this.links.requestReset(body.email);
    return { message: 'If an account exists for that email, a reset link is on its way.' };
  }

  /** Lets the page show who the link is for, or that it has expired. Token in the body, never the URL (logs). */
  @Public()
  @Post('reset-password/check')
  @HttpCode(200)
  checkLink(@Body(zod(z.object({ token: z.string().min(20).max(200) }))) body: { token: string }) {
    return this.links.check(body.token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body(zod(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.links.reset(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(zod(loginSchema)) body: LoginInput, @Client() client: ClientInfo, @Res({ passthrough: true }) res: Response) {
    return this.respond(await this.auth.login(body, client), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Client() client: ClientInfo, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], client), res);
    } catch (e) {
      // On a benign race the browser already holds the newer cookie: don't clear it.
      if (!(e instanceof AppError && e.code === 'refresh-stale')) res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  }

  @Authenticated()
  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(
    @Auth() auth: AuthContext,
    @Body(zod(switchTenantSchema)) body: { tenantId: string },
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.auth.switchTenant(auth.userId, auth.sessionId, body.tenantId, client), res);
  }

  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(auth.sessionId);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  private respond(s: SessionResult, res: Response) {
    res.cookie(REFRESH_COOKIE, s.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config().NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: config().REFRESH_TTL_DAYS * 86_400_000,
    });
    const { refreshToken: _omit, ...body } = s;
    return body;
  }
}
