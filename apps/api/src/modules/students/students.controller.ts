import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  AddGuardianInput, ChangeSectionInput, ChangeStudentStatusInput, PERMISSIONS, StudentQuery, UpdateStudentInput,
  addGuardianSchema, changeSectionSchema, changeStudentStatusSchema, guardianLookupSchema, studentQuerySchema, updateGuardianLinkSchema,
  updateGuardianSchema, updateStudentSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { StudentsService } from './students.service';

const optionsQuery = z.object({ academicYearId: z.string().uuid().optional() });
const guardianEditSchema = updateGuardianSchema.merge(updateGuardianLinkSchema);

@RequireModule('STUDENTS')
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get('options')
  options(@Query(zod(optionsQuery)) q: z.infer<typeof optionsQuery>, @Auth() auth: AuthContext) {
    return this.students.options(auth, q.academicYearId);
  }

  /** Search by name, admission number or parent mobile, with campus / class / section / status filters. */
  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get()
  list(@Query(zod(studentQuerySchema)) q: StudentQuery, @Auth() auth: AuthContext) {
    return this.students.list(auth, q);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get('guardians/lookup')
  lookup(@Query(zod(guardianLookupSchema)) q: z.infer<typeof guardianLookupSchema>, @Auth() auth: AuthContext) {
    return this.students.lookupGuardians(q.phone, auth);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_READ)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.students.get(id, auth);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateStudentSchema)) body: UpdateStudentInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.students.update(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Post(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(zod(changeStudentStatusSchema)) body: ChangeStudentStatusInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.students.changeStatus(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Get(':id/sections')
  sections(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.students.sectionOptions(id, auth);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Post(':id/section')
  section(@Param('id', ParseUUIDPipe) id: string, @Body(zod(changeSectionSchema)) body: ChangeSectionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.students.changeSection(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Post(':id/guardians')
  addGuardian(@Param('id', ParseUUIDPipe) id: string, @Body(zod(addGuardianSchema)) body: AddGuardianInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.students.addGuardian(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Patch(':id/guardians/:guardianId')
  updateGuardian(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body(zod(guardianEditSchema)) body: z.infer<typeof guardianEditSchema>,
    @Auth() auth: AuthContext,
    @Client() client: ClientInfo,
  ) {
    return this.students.updateGuardian(id, guardianId, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.STU_STUDENT_MANAGE)
  @Delete(':id/guardians/:guardianId')
  removeGuardian(@Param('id', ParseUUIDPipe) id: string, @Param('guardianId', ParseUUIDPipe) guardianId: string, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.students.removeGuardian(id, guardianId, auth, client);
  }
}
