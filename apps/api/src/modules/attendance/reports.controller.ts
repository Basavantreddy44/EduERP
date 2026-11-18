import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  PERMISSIONS, RegisterQuery, StaffMonthQuery, StudentPctQuery, registerQuerySchema, staffMonthQuerySchema, studentPctQuerySchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AttendanceReportsService, FileOut } from './reports.service';

const send = (res: Response, f: FileOut) => {
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
  return new StreamableFile(f.data);
};

/** Attendance reports (M3.5). `format=xlsx` downloads exactly what the screen shows. */
@RequireModule('ATTENDANCE')
@Controller('attendance/reports')
export class AttendanceReportsController {
  constructor(private readonly reports: AttendanceReportsService) {}

  /** Monthly class register: students × days, with totals and %. */
  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('register')
  async register(@Query(zod(registerQuerySchema)) q: RegisterQuery, @Auth() auth: AuthContext, @Client() client: ClientInfo, @Res({ passthrough: true }) res: Response) {
    return q.format === 'xlsx' ? send(res, await this.reports.registerFile(q, auth, client)) : this.reports.register(q, auth);
  }

  /** Attendance % per student over a period; optionally only those below a percentage. */
  @RequirePermission(PERMISSIONS.ATT_READ)
  @Get('students')
  async students(@Query(zod(studentPctQuerySchema)) q: StudentPctQuery, @Auth() auth: AuthContext, @Client() client: ClientInfo, @Res({ passthrough: true }) res: Response) {
    return q.format === 'xlsx' ? send(res, await this.reports.studentsFile(q, auth, client)) : this.reports.students(q, auth);
  }

  /** Staff attendance for a month. */
  @RequirePermission(PERMISSIONS.STAFF_ATT_MARK)
  @Get('staff')
  async staff(@Query(zod(staffMonthQuerySchema)) q: StaffMonthQuery, @Auth() auth: AuthContext, @Client() client: ClientInfo, @Res({ passthrough: true }) res: Response) {
    return q.format === 'xlsx' ? send(res, await this.reports.staffFile(q, auth, client)) : this.reports.staff(q, auth);
  }
}
