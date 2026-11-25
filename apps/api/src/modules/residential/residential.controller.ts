import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AllotmentJoinInput, AllotmentStatusInput, CampEntryInput, HealthCampInput, HostelDailyNoteInput, PERMISSIONS, StaffMoveInput, StudentMoveInput, UpdateHealthCampInput,
  allotmentJoinSchema, allotmentListQuery, allotmentStatusSchema, campEntriesSchema, healthCampSchema, hostelDailyNoteSchema, hostelDayQuery, movesQuery,
  staffMoveSchema, studentMoveSchema, updateHealthCampSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AllotmentsService } from './allotments.service';
import { MovesService } from './moves.service';
import { HostelDayService } from './hostel-day.service';
import { HealthCampsService } from './health-camps.service';

const uuid = z.string().uuid();

/** R1 Allotment list: list for readers (join or manage right), join and status per allotment. */
@Controller('allotments')
export class AllotmentsController {
  constructor(private readonly allot: AllotmentsService) {}

  @RequireModule('STUDENTS') @TenantMember() @Get()
  list(@Query(zod(allotmentListQuery)) q: z.infer<typeof allotmentListQuery>, @Auth() auth: AuthContext) { return this.allot.list(q, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.ALLOT_JOIN) @Get(':id/sections')
  sections(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.allot.sections(id, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.ALLOT_JOIN) @Post(':id/join') @HttpCode(200)
  join(@Param('id', ParseUUIDPipe) id: string, @Body(zod(allotmentJoinSchema)) b: AllotmentJoinInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.allot.join(id, b, auth, client); }

  @RequireModule('STUDENTS') @TenantMember() @Post(':id/status') @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body(zod(allotmentStatusSchema)) b: AllotmentStatusInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.allot.setStatus(id, b, auth, client); }
}

/** R2 Moves between schools. */
@Controller('moves')
export class MovesController {
  constructor(private readonly moves: MovesService) {}

  @TenantMember() @Get()
  list(@Query(zod(movesQuery)) q: z.infer<typeof movesQuery>, @Auth() auth: AuthContext) { return this.moves.list(q, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_STUDENT_READ) @Get('students/:id')
  studentHistory(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.moves.history('STUDENT', id, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_TRANSFER) @Get('students/:id/options')
  studentOptions(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.moves.studentOptions(id, auth); }

  @RequireModule('STUDENTS') @RequirePermission(PERMISSIONS.STU_TRANSFER) @Post('students/:id')
  moveStudent(@Param('id', ParseUUIDPipe) id: string, @Body(zod(studentMoveSchema)) b: StudentMoveInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.moves.moveStudent(id, b, auth, client); }

  @RequireModule('HR_PAYROLL') @RequirePermission(PERMISSIONS.HR_STAFF_READ) @Get('staff/:id')
  staffHistory(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.moves.history('STAFF', id, auth); }

  @RequireModule('HR_PAYROLL') @RequirePermission(PERMISSIONS.HR_TRANSFER) @Post('staff/:id')
  moveStaff(@Param('id', ParseUUIDPipe) id: string, @Body(zod(staffMoveSchema)) b: StaffMoveInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.moves.moveStaff(id, b, auth, client); }
}

/** R4 Warden's daily report. */
@Controller('hostel-day')
export class HostelDayController {
  constructor(private readonly day: HostelDayService) {}

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.HOSTEL_READ) @Get(':hostelId')
  report(@Param('hostelId', ParseUUIDPipe) hostelId: string, @Query(zod(hostelDayQuery)) q: { date: string }, @Auth() auth: AuthContext) { return this.day.report(hostelId, q.date, auth); }

  @RequireModule('HOSTEL') @RequirePermission(PERMISSIONS.HOSTEL_WARDEN) @Put(':hostelId/remarks')
  remarks(@Param('hostelId', ParseUUIDPipe) hostelId: string, @Body(zod(hostelDailyNoteSchema)) b: HostelDailyNoteInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.day.saveNote(hostelId, b, auth, client); }
}

/** R5 Health check-up camps. */
@Controller('health/camps')
export class HealthCampsController {
  constructor(private readonly camps: HealthCampsService) {}

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_READ) @Get()
  list(@Query(zod(z.object({ campusId: uuid.optional() }))) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.camps.list(q.campusId, auth); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Post()
  create(@Body(zod(healthCampSchema)) b: HealthCampInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.camps.create(b, auth, client); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_READ) @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Query(zod(z.object({ sectionId: uuid.optional() }))) q: { sectionId?: string }, @Auth() auth: AuthContext) { return this.camps.get(id, q.sectionId, auth); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateHealthCampSchema)) b: UpdateHealthCampInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.camps.update(id, b, auth, client); }

  @RequireModule('HEALTH') @RequirePermission(PERMISSIONS.HEALTH_MANAGE) @Put(':id/entries')
  entries(@Param('id', ParseUUIDPipe) id: string, @Body(zod(campEntriesSchema)) b: { entries: CampEntryInput[] }, @Auth() auth: AuthContext, @Client() client: ClientInfo) { return this.camps.saveEntries(id, b.entries, auth, client); }
}
