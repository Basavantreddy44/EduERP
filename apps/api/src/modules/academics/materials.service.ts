import { HttpStatus, Injectable } from '@nestjs/common';
import { MaterialInput, PERMISSIONS } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { FilesService, UploadedBlob } from '../files/files.service';
import { rosterOf } from '../attendance/attendance.service';
import { AcademicSubjectsService } from './subjects.service';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);

/**
 * Study material (M10.2): notes, links, videos and files for a class (every section, or one) and
 * subject. Set-up staff, or a teacher of that subject in the class (in that section when it is for
 * one section), add and publish it. Parents and students see published material of their child's
 * class in the app; files are opened only through that check; each opening is counted.
 */
@Injectable()
export class MaterialsService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly subjects: AcademicSubjectsService, private readonly files: FilesService) {}

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }

  /** The class (and campus); may this user publish material for it? */
  private async target(tx: Tx, programLevelId: string, sectionId: string | null | undefined, subjectId: string, auth: AuthContext) {
    const level = await tx.programLevel.findUnique({ where: { id: programLevelId }, select: { id: true, program: { select: { campusId: true } } } });
    if (!level || !canAccessCampus(this.subjects.scope(auth), level.program.campusId)) throw NotFound('Class');
    const campusId = level.program.campusId;
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    if (!year) throw unprocessable('no-current-year', 'Set the current academic year first', 'programLevelId');
    if (sectionId) {
      const s = await tx.section.findUnique({ where: { id: sectionId }, select: { programLevelId: true, academicYearId: true } });
      if (!s || s.programLevelId !== programLevelId || s.academicYearId !== year.id) throw unprocessable('section-invalid', 'Choose a section of this class', 'sectionId');
    }
    const setup = scopeFor(auth, PERMISSIONS.ACAD_SETUP);
    let allowed = !!setup && canAccessCampus(setup, campusId);
    if (!allowed && scopeFor(auth, PERMISSIONS.ACAD_TEACH)) {
      const me = await tx.employee.findFirst({ where: { userId: auth.userId }, select: { id: true } });
      const secIds = (await tx.section.findMany({ where: { programLevelId, academicYearId: year.id, ...(sectionId ? { id: sectionId } : {}) }, select: { id: true } })).map((x) => x.id);
      allowed = !!me && !!(await tx.sectionSubjectTeacher.findFirst({ where: { subjectId, employeeId: me.id, sectionId: { in: secIds } }, select: { id: true } }));
    }
    return { campusId, yearId: year.id, allowed };
  }

  /** Uploads a file for material (PDF / image), after the same check as publishing. */
  async upload(fields: { programLevelId: string; sectionId?: string | null; subjectId: string }, blob: UploadedBlob | undefined, auth: AuthContext, client: ClientInfo) {
    const t = await this.db.run(this.ctx(auth), (tx) => this.target(tx, fields.programLevelId, fields.sectionId, fields.subjectId, auth));
    if (!t.allowed) throw Forbidden('not-your-subject', 'You do not teach this subject in this class');
    return this.files.store({ entityType: 'GENERAL', docType: 'OTHER', campusId: t.campusId }, blob, auth, client);
  }

  create(input: MaterialInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const t = await this.target(tx, input.programLevelId, input.sectionId, input.subjectId, auth);
      if (!t.allowed) throw Forbidden('not-your-subject', 'You do not teach this subject in this class');
      if (!(await tx.levelSubject.findFirst({ where: { programLevelId: input.programLevelId, subjectId: input.subjectId } }))) throw unprocessable('not-in-syllabus', 'This subject is not in the class’s syllabus', 'subjectId');
      if (input.topicId) {
        const topic = await tx.syllabusTopic.findUnique({ where: { id: input.topicId }, include: { unit: true } });
        if (!topic || topic.unit.programLevelId !== input.programLevelId || topic.unit.subjectId !== input.subjectId) throw unprocessable('topic-invalid', 'Choose a topic of this class and subject', 'topicId');
      }
      if (input.fileId) {
        const f = await tx.fileObject.findUnique({ where: { id: input.fileId }, select: { createdBy: true, status: true } });
        if (!f || f.status !== 'ACTIVE' || f.createdBy !== auth.userId) throw NotFound('File');
      }
      const m = await tx.studyMaterial.create({
        data: {
          tenantId: auth.tenantId!, academicYearId: t.yearId, programLevelId: input.programLevelId, sectionId: input.sectionId ?? null, subjectId: input.subjectId, topicId: input.topicId ?? null,
          title: input.title, description: input.description ?? null, materialType: input.materialType,
          url: input.materialType === 'LINK' || input.materialType === 'VIDEO' ? input.url ?? null : null, body: input.materialType === 'NOTE' ? input.body ?? null : null, fileId: input.materialType === 'FILE' ? input.fileId ?? null : null,
          isPublished: input.publish, publishedAt: input.publish ? new Date() : null, uploadedBy: auth.userId,
        },
      });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: t.campusId, action: 'CREATE', entityType: 'STUDY_MATERIAL', entityId: m.id, newValues: { ...input, body: input.body ? `${input.body.length} characters` : null } }, client);
      return { id: m.id, isPublished: m.isPublished };
    });
  }

  /** Publish, take back to draft, or archive (never deleted). */
  setState(id: string, state: 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE', auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const m = await tx.studyMaterial.findUnique({ where: { id } });
      if (!m || m.status !== 'ACTIVE') throw NotFound('Material');
      const t = await this.target(tx, m.programLevelId, m.sectionId, m.subjectId, auth);
      if (!t.allowed) throw Forbidden('not-your-subject', 'You do not teach this subject in this class');
      const data = state === 'PUBLISH' ? { isPublished: true, publishedAt: m.publishedAt ?? new Date() } : state === 'UNPUBLISH' ? { isPublished: false } : { status: 'ARCHIVED', isPublished: false };
      await tx.studyMaterial.update({ where: { id }, data });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: t.campusId, action: 'STATUS_CHANGE', entityType: 'STUDY_MATERIAL', entityId: id, oldValues: { isPublished: m.isPublished, status: m.status }, newValues: data }, client);
      return { id, ...data };
    });
  }

  /** A section's material for a subject (whole-class items and this section's), with how many students opened each. */
  forSection(sectionId: string, subjectId: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.subjects.section(tx, sectionId, auth);
      const rows = await tx.studyMaterial.findMany({ where: { status: 'ACTIVE', academicYearId: s.academicYearId, programLevelId: s.programLevelId, subjectId, OR: [{ sectionId: null }, { sectionId }] }, orderBy: [{ createdAt: 'desc' }] });
      const roster = await rosterOf(tx, sectionId, todayIST());
      const ids = roster.map((r) => r.id);
      const views = await tx.materialView.groupBy({ by: ['materialId'], where: { materialId: { in: rows.map((r) => r.id) }, studentId: { in: ids } }, _count: true });
      const topics = new Map((await tx.syllabusTopic.findMany({ where: { id: { in: rows.map((r) => r.topicId).filter((x): x is string => !!x) } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]));
      const fileNames = new Map((await tx.fileObject.findMany({ where: { id: { in: rows.map((r) => r.fileId).filter((x): x is string => !!x) } }, select: { id: true, fileName: true, sizeBytes: true } })).map((f) => [f.id, { name: f.fileName, size: Number(f.sizeBytes) }]));
      const t = await this.target(tx, s.programLevelId, sectionId, subjectId, auth);
      return {
        section: { id: s.id, name: `${s.level.name} – ${s.name}`, programLevelId: s.programLevelId }, students: ids.length, canAdd: t.allowed,
        items: rows.map((m) => ({ id: m.id, title: m.title, description: m.description, materialType: m.materialType, url: m.url, body: m.body, file: m.fileId ? fileNames.get(m.fileId) ?? null : null, forSection: !!m.sectionId, topic: m.topicId ? topics.get(m.topicId) ?? null : null, isPublished: m.isPublished, publishedAt: m.publishedAt, viewed: views.find((v) => v.materialId === m.id)?._count ?? 0 })),
      };
    });
  }

  /** Staff open a file of material they can see. */
  async openFileForStaff(id: string, auth: AuthContext) {
    const m = await this.db.run(this.ctx(auth), async (tx) => {
      const x = await tx.studyMaterial.findUnique({ where: { id } });
      if (!x || !x.fileId) throw NotFound('Material');
      const level = await tx.programLevel.findUnique({ where: { id: x.programLevelId }, select: { program: { select: { campusId: true } } } });
      if (!level || !canAccessCampus(this.subjects.scope(auth), level.program.campusId)) throw NotFound('Material');
      return x;
    });
    return this.files.openChecked(m.fileId!, auth);
  }

  // ───────────── Parent / student app ─────────────

  private async childClass(tx: Tx, studentId: string) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: year.id, status: 'ACTIVE' }, select: { sectionId: true, section: { select: { programLevelId: true } } } }));
    return e && year ? { yearId: year.id, sectionId: e.sectionId, programLevelId: e.section.programLevelId } : null;
  }

  private visible(c: { yearId: string; sectionId: string; programLevelId: string }) {
    return { status: 'ACTIVE', isPublished: true, academicYearId: c.yearId, programLevelId: c.programLevelId, OR: [{ sectionId: null }, { sectionId: c.sectionId }] };
  }

  /** Published material of the child's class, newest first, with whether the child has opened it. */
  async forStudentTx(tx: Tx, studentId: string) {
    const c = await this.childClass(tx, studentId);
    if (!c) return { items: [] };
    const rows = await tx.studyMaterial.findMany({ where: this.visible(c), orderBy: { publishedAt: 'desc' }, take: 200 });
    const subjects = new Map((await tx.subject.findMany({ where: { id: { in: rows.map((r) => r.subjectId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const seen = new Set((await tx.materialView.findMany({ where: { studentId, materialId: { in: rows.map((r) => r.id) } }, select: { materialId: true } })).map((v) => v.materialId));
    return { items: rows.map((m) => ({ id: m.id, subject: subjects.get(m.subjectId) ?? '', title: m.title, description: m.description, materialType: m.materialType, hasFile: !!m.fileId, publishedAt: m.publishedAt, opened: seen.has(m.id) })) };
  }

  /** The child opens an item: counted, and the content returned (a file is fetched separately). */
  async openForStudentTx(tx: Tx, studentId: string, materialId: string) {
    const c = await this.childClass(tx, studentId);
    const m = c && (await tx.studyMaterial.findFirst({ where: { id: materialId, ...this.visible(c) } }));
    if (!m) throw NotFound('Material');
    const ex = await tx.materialView.findUnique({ where: { tenantId_materialId_studentId: { tenantId: m.tenantId, materialId, studentId } } });
    if (ex) await tx.materialView.update({ where: { id: ex.id }, data: { lastViewedAt: new Date(), viewCount: { increment: 1 } } });
    else await tx.materialView.create({ data: { tenantId: m.tenantId, materialId, studentId } });
    return { id: m.id, title: m.title, description: m.description, materialType: m.materialType, url: m.url, body: m.body, fileId: m.fileId };
  }
}
