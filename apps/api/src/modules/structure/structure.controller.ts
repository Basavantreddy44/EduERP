import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CreateBoardInput, CreateProgramInput, CreateSectionsInput, PERMISSIONS, UpdateProgramInput, UpdateSectionInput,
  createBoardSchema, createProgramSchema, createSectionsSchema, renameLevelSchema, sectionsQuerySchema, updateProgramSchema, updateSectionSchema,
} from '@eduerp/shared';
import { Auth, Client, ClientInfo, RequirePermission } from '../../common/decorators';
import type { AuthContext } from '../../common/auth-context';
import { zod } from '../../common/zod.pipe';
import { StructureService } from './structure.service';

@Controller()
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get('boards')
  boards(@Auth() auth: AuthContext) {
    return this.structure.boards(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post('boards')
  createBoard(@Body(zod(createBoardSchema)) body: CreateBoardInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.createBoard(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post('boards/common')
  addCommonBoards(@Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.addCommonBoards(auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get('programs')
  programs(@Auth() auth: AuthContext) {
    return this.structure.programs(auth);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post('programs')
  createProgram(@Body(zod(createProgramSchema)) body: CreateProgramInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.createProgram(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Patch('programs/:id')
  updateProgram(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateProgramSchema)) body: UpdateProgramInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.updateProgram(id, body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Patch('program-levels/:id')
  renameLevel(@Param('id', ParseUUIDPipe) id: string, @Body(zod(renameLevelSchema)) body: { name: string }, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.renameLevel(id, body.name, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_READ)
  @Get('sections')
  sections(@Query(zod(sectionsQuerySchema)) q: z.infer<typeof sectionsQuerySchema>, @Auth() auth: AuthContext) {
    return this.structure.sections(auth, q);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Post('sections')
  createSections(@Body(zod(createSectionsSchema)) body: CreateSectionsInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.createSections(body, auth, client);
  }

  @RequirePermission(PERMISSIONS.ORG_ACADEMIC_MANAGE)
  @Patch('sections/:id')
  updateSection(@Param('id', ParseUUIDPipe) id: string, @Body(zod(updateSectionSchema)) body: UpdateSectionInput, @Auth() auth: AuthContext, @Client() client: ClientInfo) {
    return this.structure.updateSection(id, body, auth, client);
  }
}
