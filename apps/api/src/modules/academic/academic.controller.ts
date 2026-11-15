import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateAcademicYearInput, CreateDepartmentInput, CreateHolidayInput, PERMISSIONS, UpdateDepartmentInput,
  createAcademicYearSchema, createDepartmentSchema, createHolidaySchema, holidayQuerySchema, updateDepartmentSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AcademicService } from './academic.service';

@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academic: AcademicService) {}

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.academic.listYears(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post()
  create(@Body(zod(createAcademicYearSchema)) body: CreateAcademicYearInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.createYear(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post(':id/make-current')
  makeCurrent(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.makeCurrent(id, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post(':id/close')
  close(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.closeYear(id, auth, client);
  }
}

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly academic: AcademicService) {}

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.academic.listDepartments(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post()
  create(@Body(zod(createDepartmentSchema)) body: CreateDepartmentInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.createDepartment(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateDepartmentSchema)) body: UpdateDepartmentInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.updateDepartment(id, body, auth, client);
  }
}

@Controller('holidays')
export class HolidaysController {
  constructor(private readonly academic: AcademicService) {}

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get()
  list(@Query(zod(holidayQuerySchema)) q: z.infer<typeof holidayQuerySchema>, @Auth() auth: AuthContext) {
    return this.academic.listHolidays(auth, q);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post()
  create(@Body(zod(createHolidaySchema)) body: CreateHolidayInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.createHoliday(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.academic.deleteHoliday(id, auth, client);
  }
}
