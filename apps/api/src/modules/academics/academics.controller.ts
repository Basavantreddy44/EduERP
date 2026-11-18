import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ClassRoomInput, DiaryInput, ElectivesInput, HomeworkInput, MarkSubmissionInput, PERMISSIONS, SaveTimetableInput, SectionTeachersInput, SubjectInput, SubstitutionInput, SyllabusInput, UpdateSubjectInput,
  classRoomSchema, diarySchema, electivesSchema, homeworkSchema, markSubmissionSchema, saveTimetableSchema, sectionTeachersSchema, subjectSchema, substitutionSchema, syllabusSchema, updateSubjectSchema,
  LessonPlanInput, LessonStatusInput, MaterialInput, SyllabusPlanInput, lessonPlanSchema, lessonStatusSchema, materialSchema, syllabusPlanSchema,
} from '@eduerp/shared';
import { z } from 'zod';
import { Auth, Client, ClientInfo, RequireModule, RequirePermission, TenantMember } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { AcademicSubjectsService } from './subjects.service';
import { TimetableService } from './timetable.service';
import { HomeworkService } from './homework.service';
import { LessonsService } from './lessons.service';
import { MaterialsService } from './materials.service';
import type { UploadedBlob } from '../files/files.service';
const HARD_LIMIT_BYTES = 25 * 1024 * 1024;

const campusQuery = z.object({ campusId: z.string().uuid().optional() });
const campusDate = z.object({ campusId: z.string().uuid(), date: z.string().date() });
const dateQuery = z.object({ date: z.string().date() });

/** Academics I (Phase 8): subjects & teachers, timetable & substitution, homework & class diary. */
@RequireModule('ACADEMICS')
@Controller('academics')
export class AcademicsController {
  constructor(
    private readonly subjects: AcademicSubjectsService,
    private readonly timetable: TimetableService,
    private readonly homework: HomeworkService,
    private readonly lessons: LessonsService,
    private readonly materials: MaterialsService,
  ) {}

  // ───── M8.1 ─────
  /** Sections for the academics screens (a teacher sees their own). */
  @TenantMember() @Get('sections')
  sections(@Auth() auth: AuthContext) { return this.subjects.mySections(auth); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('staff')
  staff(@Query(zod(z.object({ campusId: z.string().uuid() }))) q: { campusId: string }, @Auth() auth: AuthContext) { return this.subjects.teachingStaff(q.campusId, auth); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('subjects')
  list(@Auth() auth: AuthContext) { return this.subjects.subjects(auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Post('subjects')
  create(@Body(zod(subjectSchema)) b: SubjectInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.subjects.createSubject(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Patch('subjects/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateSubjectSchema)) b: UpdateSubjectInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.subjects.updateSubject(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('classes/:levelId/syllabus')
  syllabus(@Param('levelId', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.subjects.syllabus(id, auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Put('syllabus')
  saveSyllabus(@Body(zod(syllabusSchema)) b: SyllabusInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.subjects.saveSyllabus(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('sections/:id/teachers')
  teachers(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.subjects.teachers(id, auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Put('sections/:id/teachers')
  saveTeachers(@Param('id', ParseUUIDPipe) id: string, @Body(zod(sectionTeachersSchema)) b: SectionTeachersInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.subjects.saveTeachers(id, b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Put('students/:id/electives')
  electives(@Param('id', ParseUUIDPipe) id: string, @Body(zod(electivesSchema)) b: ElectivesInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.subjects.saveElectives(id, b, auth, c); }

  // ───── M8.2 ─────
  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('rooms')
  rooms(@Query(zod(campusQuery)) q: { campusId?: string }, @Auth() auth: AuthContext) { return this.timetable.rooms(auth, q.campusId); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Post('rooms')
  createRoom(@Body(zod(classRoomSchema)) b: ClassRoomInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.timetable.createRoom(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('sections/:id/timetable')
  sectionTimetable(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.timetable.section(id, auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Put('timetable')
  saveDraft(@Body(zod(saveTimetableSchema)) b: SaveTimetableInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.timetable.saveDraft(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Post('sections/:id/timetable/publish') @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.timetable.publish(id, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('teachers/:id/timetable')
  teacher(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.timetable.teacher(id, auth); }

  /** The signed-in teacher's own week. */
  @TenantMember() @Get('me/timetable')
  async mine(@Auth() auth: AuthContext) { return this.timetable.mine(auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Get('lessons/:id/free-teachers')
  free(@Param('id', ParseUUIDPipe) id: string, @Query(zod(dateQuery)) q: { date: string }, @Auth() auth: AuthContext) { return this.timetable.freeTeachers(id, q.date, auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Post('substitutions')
  substitute(@Body(zod(substitutionSchema)) b: SubstitutionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.timetable.substitute(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Post('substitutions/:id/cancel') @HttpCode(200)
  cancelSub(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.timetable.cancelSubstitution(id, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('substitutions')
  subs(@Query(zod(campusDate)) q: { campusId: string; date: string }, @Auth() auth: AuthContext) { return this.timetable.daySubstitutions(q.campusId, q.date, auth); }

  // ───── M8.3 ─────
  @TenantMember() @Post('homework')
  createHomework(@Body(zod(homeworkSchema)) b: HomeworkInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.homework.createHomework(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('sections/:id/homework')
  sectionHomework(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.homework.sectionHomework(id, auth); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('homework/:id/submissions')
  submissions(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.homework.submissions(id, auth); }

  @TenantMember() @Post('submissions/:id/mark') @HttpCode(200)
  mark(@Param('id', ParseUUIDPipe) id: string, @Body(zod(markSubmissionSchema)) b: MarkSubmissionInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.homework.mark(id, b, auth, c); }

  @TenantMember() @Post('diary')
  createDiary(@Body(zod(diarySchema)) b: DiaryInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.homework.createDiary(b, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('sections/:id/diary')
  sectionDiary(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.homework.sectionDiary(id, auth); }

  // ───── M10.1 Lesson plans & syllabus tracking ─────
  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('classes/:levelId/subjects/:subjectId/units')
  units(@Param('levelId', ParseUUIDPipe) l: string, @Param('subjectId', ParseUUIDPipe) s: string, @Auth() auth: AuthContext) { return this.lessons.syllabus(l, s, auth); }

  @RequirePermission(PERMISSIONS.ACAD_SETUP) @Put('units')
  saveUnits(@Body(zod(syllabusPlanSchema)) b: SyllabusPlanInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lessons.saveSyllabus(b, auth, c); }

  @TenantMember() @Get('sections/:id/subjects/:subjectId/lessons')
  sectionLessons(@Param('id', ParseUUIDPipe) id: string, @Param('subjectId', ParseUUIDPipe) s: string, @Auth() auth: AuthContext) { return this.lessons.sectionSubject(id, s, auth); }

  @TenantMember() @Post('lesson-plans')
  plan(@Body(zod(lessonPlanSchema)) b: LessonPlanInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lessons.createPlan(b, auth, c); }

  @TenantMember() @Post('lesson-plans/:id/status') @HttpCode(200)
  planStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zod(lessonStatusSchema)) b: LessonStatusInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.lessons.setStatus(id, b, auth, c); }

  @TenantMember() @Get('sections/:id/progress')
  progress(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext) { return this.lessons.progress(id, auth); }

  // ───── M10.2 Study material ─────
  @TenantMember() @Get('sections/:id/subjects/:subjectId/materials')
  sectionMaterials(@Param('id', ParseUUIDPipe) id: string, @Param('subjectId', ParseUUIDPipe) s: string, @Auth() auth: AuthContext) { return this.materials.forSection(id, s, auth); }

  /** multipart/form-data: `file` plus programLevelId, subjectId and (optional) sectionId. */
  @TenantMember() @Post('materials/files')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_LIMIT_BYTES, files: 1, fields: 5 } }))
  materialFile(@UploadedFile() file: UploadedBlob | undefined, @Body(zod(z.object({ programLevelId: z.string().uuid(), subjectId: z.string().uuid(), sectionId: z.string().uuid().optional() }))) b: { programLevelId: string; subjectId: string; sectionId?: string }, @Auth() auth: AuthContext, @Client() c: ClientInfo) {
    return this.materials.upload(b, file, auth, c);
  }

  @TenantMember() @Post('materials')
  addMaterial(@Body(zod(materialSchema)) b: MaterialInput, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.materials.create(b, auth, c); }

  @TenantMember() @Post('materials/:id/state') @HttpCode(200)
  materialState(@Param('id', ParseUUIDPipe) id: string, @Body(zod(z.object({ state: z.enum(['PUBLISH', 'UNPUBLISH', 'ARCHIVE']) }))) b: { state: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE' }, @Auth() auth: AuthContext, @Client() c: ClientInfo) { return this.materials.setState(id, b.state, auth, c); }

  @RequirePermission(PERMISSIONS.ACAD_READ) @Get('materials/:id/file')
  async materialContent(@Param('id', ParseUUIDPipe) id: string, @Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const { file, stream } = await this.materials.openFileForStaff(id, auth);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, { type: file.mimeType, length: file.sizeBytes, disposition: `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}` });
  }
}