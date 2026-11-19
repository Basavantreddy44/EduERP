import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  CLEARANCE_SECTIONS, DesignationInput, ExitInput, ExperienceInput, LeaveAdjustmentInput, PERMISSIONS, QualificationInput, ShiftInput, StaffProfileInput,
  assignShiftSchema, carryForwardSchema, clearanceSchema, closeExitSchema, designationSchema, exitSchema, experienceSchema, leaveAdjustmentSchema, qualificationSchema, shiftSchema, staffProfileSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { HrService } from './hr.service';
import { LeaveBalancesService } from './leave-balances.service';
import { ExitsService } from './exits.service';

const M = 'HR_PAYROLL';
const uuid = z.string().uuid();

/** HR (Phase 14 / B4 §2): designations, staff profile, shifts, leave balances, exits. */
@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService, private readonly leave: LeaveBalancesService, private readonly exits: ExitsService) {}

  // ───── Designations ─────
  @RequireModule(M) @TenantMember() @Get('designations')
  designations(@Auth() auth: AuthContext) { return this.hr.designations(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Post('designations')
  addDesignation(@Body(zod(designationSchema)) b: DesignationInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.saveDesignation(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Put('designations/:id')
  editDesignation(@Param('id', ParseUUIDPipe) id: string, @Body(zod(designationSchema)) b: DesignationInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.saveDesignation(id, b, auth, c); }

  // ───── Profile ─────
  @RequireModule(M) @TenantMember() @Get('me')
  me(@Auth() auth: AuthContext) { return this.hr.me(auth); }

  @RequireModule(M) @TenantMember() @Get('staff/:id')
  profile(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.hr.profile(id, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Put('staff/:id')
  saveProfile(@Param('id', ParseUUIDPipe) id: string, @Body(zod(staffProfileSchema)) b: StaffProfileInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.saveProfile(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_REVEAL) @Post('staff/:id/reveal') @HttpCode(200)
  reveal(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ field: z.enum(['pan', 'bankAccountNo']) }))) b: { field: 'pan' | 'bankAccountNo' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.reveal(id, b.field, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Post('staff/:id/qualifications')
  addQual(@Param('id', ParseUUIDPipe) id: string, @Body(zod(qualificationSchema)) b: QualificationInput, @Auth() auth: AuthContext) { return this.hr.addQualification(id, b, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Delete('staff/:id/qualifications/:qid')
  removeQual(@Param('id', ParseUUIDPipe) id: string, @Param('qid', ParseUUIDPipe) qid: string, @Auth() auth: AuthContext) { return this.hr.removeQualification(id, qid, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Post('staff/:id/experiences')
  addExp(@Param('id', ParseUUIDPipe) id: string, @Body(zod(experienceSchema)) b: ExperienceInput, @Auth() auth: AuthContext) { return this.hr.addExperience(id, b, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_MANAGE) @Delete('staff/:id/experiences/:xid')
  removeExp(@Param('id', ParseUUIDPipe) id: string, @Param('xid', ParseUUIDPipe) xid: string, @Auth() auth: AuthContext) { return this.hr.removeExperience(id, xid, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_READ) @Get('staff-options')
  staffOptions(@Query(zod(z.object({ campusId: uuid.optional() }))) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.hr.staffOptions(auth, q.campusId); }

  // ───── Shifts ─────
  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_PROFILE_READ) @Get('shifts')
  shifts(@Auth() auth: AuthContext) { return this.hr.shifts(auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Post('shifts')
  addShift(@Body(zod(shiftSchema)) b: ShiftInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.saveShift(null, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Put('shifts/:id')
  editShift(@Param('id', ParseUUIDPipe) id: string, @Body(zod(shiftSchema)) b: ShiftInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.saveShift(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Post('shifts/assign') @HttpCode(200)
  assign(@Body(zod(assignShiftSchema)) b: { shiftId: string | null; employeeIds: string[] }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.hr.assignShift(b.shiftId, b.employeeIds, auth, c); }

  // ───── Leave balances ─────
  @RequireModule(M) @TenantMember() @Get('leave-balances')
  balances(@Query(zod(z.object({ yearId: uuid, employeeId: uuid.optional() }))) q: { yearId: string; employeeId?: string }, @Auth() auth: AuthContext) { return this.leave.balances(q.yearId, auth, q.employeeId); }

  @RequireModule(M) @TenantMember() @Get('leave-balances/:employeeId/adjustments')
  adjustments(@Param('employeeId', ParseUUIDPipe) id: string, @Query(zod(z.object({ yearId: uuid }))) q: { yearId: string }, @Auth() auth: AuthContext) { return this.leave.adjustments(id, q.yearId, auth); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Post('leave-balances/adjust')
  adjust(@Body(zod(leaveAdjustmentSchema)) b: LeaveAdjustmentInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.leave.adjust(b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Post('leave-balances/carry-forward') @HttpCode(200)
  carry(@Body(zod(carryForwardSchema)) b: { fromYearId: string; toYearId: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.leave.carryForward(b.fromYearId, b.toYearId, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_SETUP) @Put('leave-types/:id/carry-limit')
  carryLimit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ carryForwardMax: z.coerce.number().min(0).max(365).nullable() }))) b: { carryForwardMax: number | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.leave.setCarryLimit(id, b.carryForwardMax, auth, c); }

  // ───── Exits ─────
  @RequireModule(M) @TenantMember() @Get('exits')
  exitList(@Query(zod(z.object({ status: z.enum(['INITIATED', 'CLOSED', 'CANCELLED']).optional() }))) q: { status?: string }, @Auth() auth: AuthContext) { return this.exits.list(auth, q.status); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_EXIT) @Post('exits')
  startExit(@Body(zod(exitSchema)) b: ExitInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exits.initiate(b, auth, c); }

  @RequireModule(M) @TenantMember() @Get('exits/:id')
  exit(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.exits.get(id, auth); }

  @RequireModule(M) @TenantMember() @Post('exits/:id/clear/:section') @HttpCode(200)
  clear(@Param('id', ParseUUIDPipe) id: string, @Param('section', zod(z.enum(CLEARANCE_SECTIONS))) section: string, @Body(zod(clearanceSchema)) b: { remarks?: string | null; dueAmount: number }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exits.clear(id, section, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_EXIT) @Post('exits/:id/close') @HttpCode(200)
  closeExit(@Param('id', ParseUUIDPipe) id: string, @Body(zod(closeExitSchema)) b: { settlementAmount: number; remarks?: string | null }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exits.close(id, b, auth, c); }

  @RequireModule(M) @RequirePermission(PERMISSIONS.HR_EXIT) @Post('exits/:id/cancel') @HttpCode(200)
  cancelExit(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.exits.cancel(id, auth, c); }
}
