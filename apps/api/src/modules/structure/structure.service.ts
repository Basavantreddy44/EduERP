import { HttpStatus, Injectable } from '@nestjs/common';
import {
  COMMON_BOARDS, CreateBoardInput, CreateProgramInput, CreateSectionsInput, PERMISSIONS, UpdateProgramInput, UpdateSectionInput, generateLevelNames,
} from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

const inScope = (s: CampusScope) => (s.all ? {} : { campusId: { in: s.campusIds } });

/**
 * Class structure (M1.1): boards, programmes with their levels (promotion order), and sections per
 * academic year. Programmes and sections belong to a campus; campus-limited staff manage only theirs.
 */
@Injectable()
export class StructureService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private read(auth: AuthContext) {
    return scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_READ)!;
  }
  private manage(auth: AuthContext, campusId: string) {
    if (!canAccessCampus(scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!, campusId)) throw NotFound('Campus');
  }

  // ───────────── Boards ─────────────

  boards(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => tx.educationBoard.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
  }

  async createBoard(input: CreateBoardInput, auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide users add boards');
    return this.db.run(this.ctx(auth), async (tx) => {
      if (await tx.educationBoard.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } })) {
        throw Conflict('board-exists', `${input.name} is already in your list`);
      }
      const b = await tx.educationBoard.create({ data: { ...input, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: b.tenantId, userId: auth.userId, action: 'CREATE', entityType: 'BOARD', entityId: b.id, newValues: b }, client);
      return b;
    });
  }

  /** Adds the common Karnataka boards that are not yet in the list. */
  async addCommonBoards(auth: AuthContext, client: ClientInfo) {
    if (!scopeFor(auth, PERMISSIONS.ORG_ACADEMIC_MANAGE)!.all) throw Forbidden('scope-insufficient', 'Only institution-wide users add boards');
    return this.db.run(this.ctx(auth), async (tx) => {
      const res = await tx.educationBoard.createMany({ data: COMMON_BOARDS.map((b) => ({ ...b, tenantId: auth.tenantId!, createdBy: auth.userId })), skipDuplicates: true });
      if (res.count) await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'BOARD', newValues: { added: res.count, source: 'common list' } }, client);
      return tx.educationBoard.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    });
  }

  // ───────────── Programmes & levels ─────────────

  programs(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) =>
      tx.program.findMany({
        where: inScope(this.read(auth)),
        orderBy: [{ campusId: 'asc' }, { status: 'asc' }, { name: 'asc' }],
        include: {
          levels: { orderBy: { sequence: 'asc' }, select: { id: true, name: true, sequence: true, isFinal: true } },
          board: { select: { id: true, name: true } },
          campus: { select: { code: true, name: true } },
        },
      }),
    );
  }

  async createProgram(input: CreateProgramInput, auth: AuthContext, client: ClientInfo) {
    this.manage(auth, input.campusId);
    const names = input.levelNames ?? generateLevelNames(input.programType, input.levelLabel, input.durationLevels, input.startAt);
    return this.db.run(this.ctx(auth), async (tx) => {
      const tenantId = auth.tenantId!;
      if (!(await tx.campus.findUnique({ where: { id: input.campusId }, select: { id: true } }))) throw NotFound('Campus');
      if (input.boardId && !(await tx.educationBoard.findUnique({ where: { id: input.boardId }, select: { id: true } }))) throw NotFound('Board');
      if (await tx.program.findUnique({ where: { tenantId_campusId_code: { tenantId, campusId: input.campusId, code: input.code } }, select: { id: true } })) {
        throw Conflict('program-code-taken', `Programme code ${input.code} is already used on this campus`);
      }
      // Two steps in one transaction: nested creates cannot set tenant_id, which is part of the composite link.
      const created = await tx.program.create({
        data: {
          tenantId, campusId: input.campusId, boardId: input.boardId ?? null, departmentId: input.departmentId ?? null, name: input.name, code: input.code,
          programType: input.programType, stream: input.stream ?? null, durationLevels: names.length, levelLabel: input.levelLabel, createdBy: auth.userId,
        },
      });
      await tx.programLevel.createMany({ data: names.map((name, i) => ({ tenantId, programId: created.id, name, sequence: i + 1, isFinal: i === names.length - 1 })) });
      const program = { ...created, levels: await tx.programLevel.findMany({ where: { programId: created.id }, orderBy: { sequence: 'asc' } }) };
      await this.audit.log(tx, { tenantId, userId: auth.userId, campusId: input.campusId, action: 'CREATE', entityType: 'PROGRAM', entityId: program.id, newValues: { ...input, levels: names } }, client);
      return program;
    });
  }

  async updateProgram(id: string, input: UpdateProgramInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.program.findUnique({ where: { id } });
      if (!before) throw NotFound('Programme');
      this.manage(auth, before.campusId);
      const p = await tx.program.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: p.tenantId, userId: auth.userId, campusId: p.campusId, action: 'UPDATE', entityType: 'PROGRAM', entityId: id, oldValues: before, newValues: p }, client);
      return p;
    });
  }

  async renameLevel(id: string, name: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id }, include: { program: { select: { campusId: true } } } });
      if (!level) throw NotFound('Class');
      this.manage(auth, level.program.campusId);
      const clash = await tx.programLevel.findFirst({ where: { programId: level.programId, name: { equals: name, mode: 'insensitive' }, id: { not: id } }, select: { id: true } });
      if (clash) throw Conflict('level-name-taken', `${name} is already used in this programme`);
      const updated = await tx.programLevel.update({ where: { id }, data: { name } });
      await this.audit.log(tx, { tenantId: level.tenantId, userId: auth.userId, campusId: level.program.campusId, action: 'UPDATE', entityType: 'PROGRAM_LEVEL', entityId: id, oldValues: { name: level.name }, newValues: { name } }, client);
      return updated;
    });
  }

  // ───────────── Sections ─────────────

  async sections(auth: AuthContext, q: { academicYearId?: string; campusId?: string; programId?: string }) {
    const scope = this.read(auth);
    if (q.campusId && !canAccessCampus(scope, q.campusId)) throw NotFound('Campus');
    return this.db.run(this.ctx(auth), async (tx) => {
      const yearId = q.academicYearId ?? (await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
      if (!yearId) return [];
      return tx.section.findMany({
        where: { academicYearId: yearId, ...(q.campusId ? { campusId: q.campusId } : inScope(scope)), ...(q.programId ? { level: { programId: q.programId } } : {}) },
        orderBy: [{ level: { program: { name: 'asc' } } }, { level: { sequence: 'asc' } }, { name: 'asc' }],
        include: { level: { select: { id: true, name: true, sequence: true, programId: true } } },
      });
    });
  }

  /** Adds one or more sections (A, B, C…) to a class for an academic year. */
  async createSections(input: CreateSectionsInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const level = await tx.programLevel.findUnique({ where: { id: input.programLevelId }, include: { program: { select: { campusId: true, status: true, name: true } } } });
      if (!level) throw NotFound('Class');
      this.manage(auth, level.program.campusId);
      if (level.program.status !== 'ACTIVE') throw Conflict('program-inactive', `${level.program.name} is inactive`);
      const year = await tx.academicYear.findUnique({ where: { id: input.academicYearId }, select: { status: true, name: true } });
      if (!year) throw NotFound('Academic year');
      if (year.status === 'CLOSED') throw new AppError(HttpStatus.CONFLICT, 'academic-year-closed', `${year.name} is closed`);
      const existing = await tx.section.findMany({ where: { academicYearId: input.academicYearId, programLevelId: input.programLevelId, name: { in: input.names } }, select: { name: true } });
      if (existing.length) throw Conflict('section-exists', `Already exists: ${existing.map((s) => s.name).join(', ')}`);
      const created = [];
      for (const name of input.names) {
        created.push(await tx.section.create({ data: { tenantId: auth.tenantId!, campusId: level.program.campusId, academicYearId: input.academicYearId, programLevelId: input.programLevelId, name, capacity: input.capacity, createdBy: auth.userId } }));
      }
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: level.program.campusId, action: 'CREATE', entityType: 'SECTION', newValues: { class: level.name, year: year.name, names: input.names, capacity: input.capacity } }, client);
      return created;
    });
  }

  async updateSection(id: string, input: UpdateSectionInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const before = await tx.section.findUnique({ where: { id } });
      if (!before) throw NotFound('Section');
      this.manage(auth, before.campusId);
      const s = await tx.section.update({ where: { id }, data: { ...input, updatedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: s.tenantId, userId: auth.userId, campusId: s.campusId, action: 'UPDATE', entityType: 'SECTION', entityId: id, oldValues: before, newValues: s }, client);
      return s;
    });
  }

  /** For other modules: a section with its class and programme, inside a tenant transaction. */
  static sectionDetail(tx: Tx, id: string) {
    return tx.section.findUnique({ where: { id }, include: { level: { include: { program: true } } } });
  }
}
