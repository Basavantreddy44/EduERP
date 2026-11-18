import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CorrectionInput, CorrectionQuery, DayOverviewQuery, PERMISSIONS, correctionQuerySchema, correctionSchema, SavePeriodsInput, SaveSheetInput, SheetQuery, dayOverviewSchema, savePeriodsSchema, saveSheetSchema, sheetQuerySchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AttendanceService } from './attendance.service';
import { AttendanceCorrectionsService } from './corrections.service';

const campusQuery = z.object({ campusId: z.string().uuid() });

/** Student attendance (M3.2). */
@RequireModule('ATTENDANCE')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly corrections: AttendanceCorrectionsService,
  ) {}

  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('options')
  options(@Auth() auth: AuthContext) {
    return this.attendance.options(auth);
  }

  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('periods')
  periods(@Query(zod(campusQuery)) q: z.infer<typeof campusQuery>, @Auth() auth: AuthContext) {
    return this.attendance.periods(q.campusId, auth);
  }

  /** Replaces the campus bell timings (matched by name, so past marks stay linked). */
  @RequirePermission(PERMISSIONS.ATT_SETUP)
  @Put('periods')
  savePeriods(@Body(zod(savePeriodsSchema)) body: SavePeriodsInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.attendance.savePeriods(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('sheet')
  sheet(@Query(zod(sheetQuerySchema)) q: SheetQuery, @Auth() auth: AuthContext) {
    return this.attendance.sheet(q, auth);
  }

  /** Saves the whole sheet in one request: as a draft, or submitted (locked). */
  @RequirePermission(PERMISSIONS.ATT_MARK)
  @Post('sheet')
  @HttpCode(200)
  save(@Body(zod(saveSheetSchema)) body: SaveSheetInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.attendance.saveSheet(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('day')
  day(@Query(zod(dayOverviewSchema)) q: DayOverviewQuery, @Auth() auth: AuthContext) {
    return this.attendance.day(q, auth);
  }

  /** Ask to change a submitted mark (with a reason; approval when the institution has a rule). */
  @RequirePermission(PERMISSIONS.ATT_CORRECT)
  @Post('corrections')
  correct(@Body(zod(correctionSchema)) body: CorrectionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.corrections.request(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('corrections')
  listCorrections(@Query(zod(correctionQuerySchema)) q: CorrectionQuery, @Auth() auth: AuthContext) {
    return this.corrections.list(q, auth);
  }
}
