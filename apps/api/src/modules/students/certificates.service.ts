import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { CertRequestInput, CertTemplateInput, DEFAULT_CERT_TEMPLATES, PERMISSIONS, PermissionCode, VERIFY_ALPHABET, fillTemplate } from '@eduerp/shared';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Conflict, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { allocateNo } from './student-records';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const unprocessable = (code: string, detail: string, field: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, detail, [{ field, message: detail }]);
const longDate = (d: string | null, lang: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(lang === 'kn' ? 'kn-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);
const newCode = () => Array.from({ length: 12 }, () => VERIFY_ALPHABET[randomInt(VERIFY_ALPHABET.length)]).join('').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');

/**
 * Certificates (M10.3): bonafide, study, character and conduct certificates from the institution's
 * templates. Issuing fills the template from the student's record, takes the next number of the
 * institution's CERT series and a public verification code (QR), and freezes the text. Templates
 * that ask for approval go through the approvals engine first. A public page confirms a code.
 */
@Injectable()
export class CertificatesService implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit() {
    this.approvals.onComplete('CERTIFICATE', async (tx, d) => {
      const c = await tx.certificate.findUnique({ where: { id: d.entityId } });
      if (!c || c.status !== 'REQUESTED') return;
      if (d.decision === 'APPROVED') await this.issueTx(tx, c.id, d.userId);
      else await tx.certificate.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
    });
  }

  private ctx(auth: AuthContext) {
    return { tenantId: auth.tenantId, userId: auth.userId };
  }
  private scope(auth: AuthContext, code: PermissionCode = PERMISSIONS.CERT_READ) {
    return scopeFor(auth, code) ?? scopeFor(auth, PERMISSIONS.CERT_ISSUE) ?? { all: false, campusIds: [] };
  }

  // ───────────── Templates ─────────────

  templates(auth: AuthContext) {
    return this.db.run(this.ctx(auth), (tx) => tx.certificateTemplate.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ certificateType: 'asc' }, { language: 'asc' }, { name: 'asc' }] }));
  }

  saveTemplate(id: string | null, input: CertTemplateInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const clash = await tx.certificateTemplate.findUnique({ where: { tenantId_name: { tenantId: auth.tenantId!, name: input.name } }, select: { id: true } });
      if (clash && clash.id !== id) throw Conflict('template-name-taken', `${input.name} already exists`);
      const before = id ? await tx.certificateTemplate.findUnique({ where: { id } }) : null;
      if (id && !before) throw NotFound('Template');
      const t = id ? await tx.certificateTemplate.update({ where: { id }, data: input }) : await tx.certificateTemplate.create({ data: { ...input, tenantId: auth.tenantId!, createdBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: id ? 'UPDATE' : 'CREATE', entityType: 'CERTIFICATE_TEMPLATE', entityId: t.id, oldValues: before ?? undefined, newValues: input }, client);
      return t;
    });
  }

  /** Adds the ready-made templates that are not there yet (by name). */
  addDefaults(auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const have = new Set((await tx.certificateTemplate.findMany({ select: { name: true } })).map((t) => t.name));
      const add = DEFAULT_CERT_TEMPLATES.filter((t) => !have.has(t.name));
      if (add.length) await tx.certificateTemplate.createMany({ data: add.map((t) => ({ ...t, requiresApproval: false, tenantId: auth.tenantId!, createdBy: auth.userId })) });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, action: 'CREATE', entityType: 'CERTIFICATE_TEMPLATE', entityId: auth.tenantId!, newValues: { defaults: add.map((t) => t.name) } }, client);
      return { added: add.length };
    });
  }

  // ───────────── Certificates ─────────────

  private async student(tx: Tx, studentId: string, auth: AuthContext, code: PermissionCode = PERMISSIONS.CERT_READ) {
    const s = await tx.student.findUnique({ where: { id: studentId }, select: { id: true, campusId: true, firstName: true, lastName: true, admissionNo: true } });
    if (!s || !canAccessCampus(this.scope(auth, code), s.campusId)) throw NotFound('Student');
    return s;
  }

  list(auth: AuthContext, studentId?: string) {
    return this.db.run(this.ctx(auth), async (tx) => {
      if (studentId) await this.student(tx, studentId, auth);
      const s = this.scope(auth);
      const rows = await tx.certificate.findMany({ where: { ...(studentId ? { studentId } : {}), ...(s.all ? {} : { campusId: { in: s.campusIds } }) }, orderBy: { createdAt: 'desc' }, take: 300 });
      const st = new Map((await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } })).map((x) => [x.id, x]));
      return rows.map((c) => ({ id: c.id, studentId: c.studentId, student: `${st.get(c.studentId)?.firstName ?? ''} ${st.get(c.studentId)?.lastName ?? ''}`.trim(), admissionNo: st.get(c.studentId)?.admissionNo ?? '', certificateType: c.certificateType, title: c.title, language: c.language, purpose: c.purpose, certificateNo: c.certificateNo, issueDate: iso(c.issueDate), status: c.status, createdAt: c.createdAt }));
    });
  }

  /** Request a certificate: issued at once, or after approval when the template asks for it (and a rule exists). */
  request(input: CertRequestInput, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const s = await this.student(tx, input.studentId, auth, PERMISSIONS.CERT_ISSUE);
      const t = await tx.certificateTemplate.findUnique({ where: { id: input.templateId } });
      if (!t || t.status !== 'ACTIVE') throw NotFound('Template');
      const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
      if (!year || !(await tx.studentEnrollment.findFirst({ where: { studentId: s.id, academicYearId: year.id, status: { in: ['ACTIVE', 'PROMOTED', 'DETAINED'] } } }))) throw unprocessable('not-enrolled', 'The student has no class this year', 'studentId');
      const c = await tx.certificate.create({ data: { tenantId: auth.tenantId!, campusId: s.campusId, studentId: s.id, templateId: t.id, certificateType: t.certificateType, language: t.language, title: t.title, purpose: input.purpose, requestedBy: auth.userId } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: s.campusId, action: 'CREATE', entityType: 'CERTIFICATE', entityId: c.id, newValues: input }, client);
      if (t.requiresApproval) {
        const req = await this.approvals.submit(tx, { tenantId: auth.tenantId!, requestedBy: auth.userId, entityType: 'CERTIFICATE', entityId: c.id, campusId: s.campusId, summary: `${t.title} · ${s.firstName} ${s.lastName ?? ''} (${s.admissionNo}) · ${input.purpose}`.replace(/\s+/g, ' ') }, client);
        if (req) {
          await tx.certificate.update({ where: { id: c.id }, data: { approvalRequestId: req.id } });
          return { id: c.id, status: 'REQUESTED' };
        }
      }
      return this.issueTx(tx, c.id, auth.userId);
    });
  }

  /** Fills the template, numbers the certificate, creates its public code and freezes the text. */
  private async issueTx(tx: Tx, id: string, userId: string) {
    const c = await tx.certificate.findUniqueOrThrow({ where: { id }, include: { template: true } });
    const st = await tx.student.findUniqueOrThrow({ where: { id: c.studentId }, select: { firstName: true, lastName: true, admissionNo: true, dob: true, gender: true, admissionDate: true } });
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    const e = year && (await tx.studentEnrollment.findFirst({ where: { studentId: c.studentId, academicYearId: year.id }, orderBy: { enrolledOn: 'desc' }, select: { section: { select: { name: true, level: { select: { name: true, program: { select: { name: true } } } } } } } }));
    const guardians = await tx.studentGuardian.findMany({ where: { studentId: c.studentId }, orderBy: { isPrimary: 'desc' }, select: { relation: true, guardian: { select: { name: true } } } });
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true } });
    const campus = await tx.campus.findUniqueOrThrow({ where: { id: c.campusId }, select: { name: true } });
    const today = todayIST();
    const lang = c.language;
    const female = st.gender === 'FEMALE';
    const male = st.gender === 'MALE';
    const values = {
      studentName: `${st.firstName} ${st.lastName ?? ''}`.trim(),
      parentName: guardians[0]?.guardian.name ?? null,
      fatherName: guardians.find((g) => g.relation === 'FATHER')?.guardian.name ?? null,
      motherName: guardians.find((g) => g.relation === 'MOTHER')?.guardian.name ?? null,
      admissionNo: st.admissionNo,
      className: e ? `${e.section.level.name} – ${e.section.name} (${e.section.level.program.name})` : null,
      academicYear: year?.name ?? null,
      dateOfBirth: longDate(iso(st.dob), lang),
      admissionDate: longDate(iso(st.admissionDate), lang),
      gender: female ? 'female' : male ? 'male' : null,
      heShe: female ? 'She' : male ? 'He' : 'They',
      hisHer: female ? 'her' : male ? 'his' : 'their',
      sonDaughter: female ? 'daughter' : male ? 'son' : 'child',
      purpose: c.purpose, issueDate: longDate(today, lang), schoolName: tenant.name, campusName: campus.name,
    };
    const certificateNo = await allocateNo(this.numbering, tx, 'CERT', c.campusId, year?.name ?? today.slice(0, 4), userId);
    let code = newCode();
    for (let i = 0; i < 5 && (await tx.certificateVerification.findUnique({ where: { code } })); i++) code = newCode();
    await tx.certificate.update({ where: { id }, data: { status: 'ISSUED', body: fillTemplate(c.template.body, values), certificateNo, issueDate: new Date(`${today}T00:00:00Z`), verificationCode: code, issuedBy: userId } });
    await tx.certificateVerification.create({ data: { code, tenantId: c.tenantId, certificateId: id } });
    await this.audit.log(tx, { tenantId: c.tenantId, userId, campusId: c.campusId, action: 'STATUS_CHANGE', entityType: 'CERTIFICATE', entityId: id, oldValues: { status: c.status }, newValues: { status: 'ISSUED', certificateNo } });
    return { id, status: 'ISSUED', certificateNo, verificationCode: code };
  }

  /** The certificate to print. */
  get(id: string, auth: AuthContext) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.certificate.findUnique({ where: { id } });
      if (!c) throw NotFound('Certificate');
      const s = await this.student(tx, c.studentId, auth);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true } });
      const campus = await tx.campus.findUniqueOrThrow({ where: { id: c.campusId }, select: { name: true } });
      return { id: c.id, school: tenant.name, campus: campus.name, student: `${s.firstName} ${s.lastName ?? ''}`.trim(), admissionNo: s.admissionNo, certificateType: c.certificateType, language: c.language, title: c.title, body: c.body, purpose: c.purpose, certificateNo: c.certificateNo, issueDate: iso(c.issueDate), verificationCode: c.verificationCode, status: c.status, cancelReason: c.cancelReason, cancelledAt: c.cancelledAt };
    });
  }

  cancel(id: string, reason: string, auth: AuthContext, client: ClientInfo) {
    return this.db.run(this.ctx(auth), async (tx) => {
      const c = await tx.certificate.findUnique({ where: { id } });
      if (!c) throw NotFound('Certificate');
      await this.student(tx, c.studentId, auth, PERMISSIONS.CERT_ISSUE);
      if (c.status !== 'ISSUED') throw Conflict('not-issued', 'Only an issued certificate can be cancelled');
      await tx.certificate.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledBy: auth.userId, cancelledAt: new Date() } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: c.campusId, action: 'STATUS_CHANGE', entityType: 'CERTIFICATE', entityId: id, oldValues: { status: 'ISSUED' }, newValues: { status: 'CANCELLED', reason } }, client);
      return { id, status: 'CANCELLED' };
    });
  }

  /**
   * Public check of a code (no login): finds the institution from the code-only lookup, then reads the
   * certificate inside that institution. Shows only what is printed on the certificate's face.
   */
  async verify(code: string) {
    const v = await this.db.run({ tenantId: null, userId: null }, (tx) => tx.certificateVerification.findUnique({ where: { code } }));
    if (!v) return { valid: false as const };
    return this.db.run({ tenantId: v.tenantId, userId: null }, async (tx) => {
      const c = await tx.certificate.findUnique({ where: { id: v.certificateId } });
      if (!c || c.verificationCode !== code) return { valid: false as const };
      const st = await tx.student.findUniqueOrThrow({ where: { id: c.studentId }, select: { firstName: true, lastName: true } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true } });
      const campus = await tx.campus.findUniqueOrThrow({ where: { id: c.campusId }, select: { name: true } });
      return { valid: true as const, status: c.status, student: `${st.firstName} ${st.lastName ?? ''}`.trim(), title: c.title, certificateType: c.certificateType, certificateNo: c.certificateNo, issueDate: iso(c.issueDate), school: tenant.name, campus: campus.name, cancelledAt: c.status === 'CANCELLED' ? iso(c.cancelledAt) : null };
    });
  }
}
