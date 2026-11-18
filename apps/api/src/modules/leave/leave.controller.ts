import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ApplyLeaveInput, LeaveQuery, LeaveTypeInput, PERMISSIONS, SaveStaffSheetInput, UpdateLeaveTypeInput,
  applyLeaveSchema, leaveQuerySchema, leaveTypeSchema, saveStaffSheetSchema, staffSheetQuerySchema, updateLeaveTypeSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { LeaveService } from './leave.service';
import { StaffAttendanceService } from './staff-attendance.service';

const balanceQuery = z.object({ applicantType: z.enum(['STUDENT', 'EMPLOYEE']), id: z.string().uuid().optional() });

/** Leave (M3.4). Staff apply for themselves (or the office for them); the office applies for students. */
@RequireModule('ATTENDANCE')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @TenantMember()
  @Get('types')
  types(@Auth() auth: AuthContext) {
    return this.leave.types(auth);
  }

  @RequirePermission(PERMISSIONS.LEAVE_STAFF)
  @Post('types')
  createType(@Body(zod(leaveTypeSchema)) body: LeaveTypeInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.leave.createType(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.LEAVE_STAFF)
  @Patch('types/:id')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateLeaveTypeSchema)) body: UpdateLeaveTypeInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.leave.updateType(id, body, auth, client);
  }

  @TenantMember()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.leave.me(auth);
  }

  /** Permission depends on whom the leave is for (checked inside): students, yourself, or other staff. */
  @TenantMember()
  @Post('requests')
  apply(@Body(zod(applyLeaveSchema)) body: ApplyLeaveInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.leave.apply(body, auth, client);
  }

  /** Your own requests, plus everything in your campuses when you may view leave. */
  @TenantMember()
  @Get('requests')
  list(@Query(zod(leaveQuerySchema)) q: LeaveQuery, @Auth() auth: AuthContext) {
    return this.leave.list(q, auth);
  }

  @TenantMember()
  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.leave.cancel(id, auth, client);
  }

  @TenantMember()
  @Get('balance')
  balance(@Query(zod(balanceQuery)) q: z.infer<typeof balanceQuery>, @Auth() auth: AuthContext) {
    return this.leave.balance(q.applicantType, q.id ?? null, auth);
  }
}

/** Staff attendance (M3.4). */
@RequireModule('ATTENDANCE')
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly staffAtt: StaffAttendanceService) {}

  @RequirePermission(PERMISSIONS.STAFF_ATT_MARK)
  @Get()
  sheet(@Query(zod(staffSheetQuerySchema)) q: z.infer<typeof staffSheetQuerySchema>, @Auth() auth: AuthContext) {
    return this.staffAtt.sheet(q.campusId, q.date, auth);
  }

  @RequirePermission(PERMISSIONS.STAFF_ATT_MARK)
  @Post()
  @HttpCode(200)
  save(@Body(zod(saveStaffSheetSchema)) body: SaveStaffSheetInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.staffAtt.save(body, auth, client);
  }
}
