import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { DecisionInput, PERMISSIONS, PortalInviteInput, PortalLeaveInput, PortalMonthQuery, SubmissionInput, decisionSchema, portalInviteSchema, portalLeaveSchema, portalMonthSchema, submissionSchema } from '@eduerp/shared';
import { Auth, Client, ClientInfo, PortalUser, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { PortalAccessService } from './portal-access.service';
import { PortalChildService } from './portal-child.service';

/** Office side (M5.1): parent and student logins, from the student's profile. */
@RequireModule('STUDENTS')
@Controller('students/:id/portal')
export class StudentPortalAccessController {
  constructor(private readonly portal: PortalAccessService) {}

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get()
  list(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.portal.list(id, auth);
  }

  /** Gives a guardian a login (or sends the invitation again). */
  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Post('guardians/:guardianId')
  @HttpCode(200)
  inviteGuardian(@Param('id', ParseUUIDPipe) id: string, @Param('guardianId', ParseUUIDPipe) guardianId: string, @Body(zod(portalInviteSchema)) body: PortalInviteInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.portal.inviteGuardian(id, guardianId, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Delete('guardians/:guardianId')
  revokeGuardian(@Param('id', ParseUUIDPipe) id: string, @Param('guardianId', ParseUUIDPipe) guardianId: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.portal.revoke(id, 'GUARDIAN', guardianId, auth, client);
  }

  /** Gives the student their own login. */
  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Post('student')
  @HttpCode(200)
  inviteStudent(@Param('id', ParseUUIDPipe) id: string, @Body(zod(portalInviteSchema)) body: PortalInviteInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.portal.inviteStudent(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Delete('student')
  revokeStudent(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.portal.revoke(id, 'STUDENT', id, auth, client);
  }
}

/** Parent & student side (M5.1): only what the person's own links allow. */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalAccessService,
    private readonly child: PortalChildService,
  ) {}

  /** The signed-in person's children (and themself, for a student). */
  @PortalUser()
  @Get('me')
  me(@Auth() auth: AuthContext) {
    return this.portal.me(auth);
  }

  /** The child's attendance for a month (M5.2). */
  @PortalUser()
  @RequireModule('ATTENDANCE')
  @Get('children/:id/attendance')
  attendance(@Param('id', ParseUUIDPipe) id: string, @Query(zod(portalMonthSchema)) q: PortalMonthQuery, @Auth() auth: AuthContext) {
    return this.child.attendance(id, q.month, auth);
  }

  /** Bills, receipts and what is owed. */
  @PortalUser()
  @RequireModule('FEES')
  @Get('children/:id/fees')
  fees(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.fees(id, auth);
  }

  @PortalUser()
  @RequireModule('FEES')
  @Get('children/:id/receipts/:paymentId')
  receipt(@Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) paymentId: string, @Auth() auth: AuthContext) {
    return this.child.receipt(id, paymentId, auth);
  }

  /** Pay everything due online: returns the secure payment page. */
  @PortalUser()
  @RequireModule('FEES')
  @Post('children/:id/pay')
  @HttpCode(200)
  pay(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.child.pay(id, auth, client);
  }

  @PortalUser()
  @RequireModule('ACADEMICS')
  @Get('children/:id/materials')
  childMaterials(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.materialsOf(id, auth);
  }

  @PortalUser()
  @RequireModule('ACADEMICS')
  @Post('children/:id/materials/:materialId/open')
  @HttpCode(200)
  openMaterial(@Param('id', ParseUUIDPipe) id: string, @Param('materialId', ParseUUIDPipe) materialId: string, @Auth() auth: AuthContext) {
    return this.child.openMaterial(id, materialId, auth);
  }

  @PortalUser()
  @RequireModule('ACADEMICS')
  @Get('children/:id/materials/:materialId/file')
  async materialFile(@Param('id', ParseUUIDPipe) id: string, @Param('materialId', ParseUUIDPipe) materialId: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.child.materialFile(id, materialId, auth);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, { type: file.mimeType, length: file.sizeBytes, disposition: `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}` });
  }

  /** The child's published results. */
  @PortalUser()
  @RequireModule('EXAMS')
  @Get('children/:id/results')
  childResults(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.resultsOf(id, auth);
  }

  @PortalUser()
  @RequireModule('EXAMS')
  @Get('children/:id/results/:resultId')
  childReportCard(@Param('id', ParseUUIDPipe) id: string, @Param('resultId', ParseUUIDPipe) resultId: string, @Auth() auth: AuthContext) {
    return this.child.reportCard(id, resultId, auth);
  }

  /** The child's timetable (published) and coming substitutions. */
  @PortalUser()
  @RequireModule('ACADEMICS')
  @Get('children/:id/timetable')
  childTimetable(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.timetableOf(id, auth);
  }

  /** Homework (with the child's own submission) and class diary notes. */
  @PortalUser()
  @RequireModule('ACADEMICS')
  @Get('children/:id/homework')
  childHomework(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.homeworkOf(id, auth);
  }

  @PortalUser()
  @RequireModule('ACADEMICS')
  @Post('children/:id/homework/:homeworkId/submit')
  @HttpCode(200)
  submitHomework(@Param('id', ParseUUIDPipe) id: string, @Param('homeworkId', ParseUUIDPipe) homeworkId: string, @Body(zod(submissionSchema)) body: SubmissionInput, @Auth() auth: AuthContext) {
    return this.child.submitHomework(id, homeworkId, body, auth);
  }

  @PortalUser()
  @RequireModule('ACADEMICS')
  @Post('children/:id/diary/:noteId/seen')
  @HttpCode(200)
  seen(@Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string, @Auth() auth: AuthContext) {
    return this.child.acknowledgeDiary(id, noteId, auth);
  }

  /** The child's hostel: room, warden, roll-call, outpasses, mess. */
  @PortalUser()
  @RequireModule('HOSTEL')
  @Get('children/:id/hostel')
  hostel(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.hostel(id, auth);
  }

  /** The parent's answer to an outpass. */
  @PortalUser()
  @RequireModule('HOSTEL')
  @Post('children/:id/outpasses/:outpassId/decide')
  @HttpCode(200)
  decideOutpass(@Param('id', ParseUUIDPipe) id: string, @Param('outpassId', ParseUUIDPipe) outpassId: string, @Body(zod(decisionSchema)) body: DecisionInput, @Auth() auth: AuthContext) {
    return this.child.decideOutpass(id, outpassId, body, auth);
  }

  /** The child's bus: route, stop, timings, vehicle and driver. */
  @PortalUser()
  @RequireModule('TRANSPORT')
  @Get('children/:id/transport')
  transport(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.transport(id, auth);
  }

  @PortalUser()
  @RequireModule('ATTENDANCE')
  @Get('children/:id/leave')
  leave(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.child.leaveOverview(id, auth);
  }

  @PortalUser()
  @RequireModule('ATTENDANCE')
  @Post('children/:id/leave')
  applyLeave(@Param('id', ParseUUIDPipe) id: string, @Body(zod(portalLeaveSchema)) body: PortalLeaveInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.child.applyLeave(id, body, auth, client);
  }

  @PortalUser()
  @RequireModule('ATTENDANCE')
  @Post('children/:id/leave/:requestId/cancel')
  @HttpCode(200)
  cancelLeave(@Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) requestId: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.child.cancelLeave(id, requestId, auth, client);
  }
}
