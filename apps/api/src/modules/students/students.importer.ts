import { Injectable } from '@nestjs/common';
import { BLOOD_GROUPS, CATEGORIES, GENDERS, PERMISSIONS, aadhaarLast4 } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { EVENTS, OutboxService } from '../../common/outbox.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import type { ImportContext, Importer } from '../imports/importers';
import { parseDate } from '../imports/importers';
import { NumberingService } from '../numbering/numbering.service';
import { allocateNo, day, linkGuardians, recordStatus, todayIST } from './student-records';
import { autoAssign } from '../fees/assignments';

type Gender = (typeof GENDERS)[number];
type Category = (typeof CATEGORIES)[number];
type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface StudentImportRow {
  admissionNo: string | null;
  firstName: string;
  lastName: string | null;
  dob: string;
  gender: Gender;
  category: Category | null;
  motherTongue: string | null;
  aadhaarLast4: string | null;
  bloodGroup: BloodGroup | null;
  campusId: string;
  sectionId: string;
  rollNo: string | null;
  admissionDate: string;
  fatherName: string | null;
  motherName: string | null;
  guardianName: string | null;
  parentPhone: string;
  parentEmail: string | null;
  address: string | null;
}

interface Ctx extends ImportContext {
  year: { id: string; name: string } | null;
  programs: Map<string, string>; // campusId|CODE → programId
  levels: Map<string, string>; // programId|class name → levelId
  sections: Map<string, { id: string; capacity: number; filled: number }>; // levelId|SECTION → …
  admissionNos: Set<string>;
}

const GENDER_WORDS: Record<string, Gender> = { boy: 'MALE', male: 'MALE', m: 'MALE', girl: 'FEMALE', female: 'FEMALE', f: 'FEMALE', other: 'OTHER' };
const text = (v: string | undefined, max: number) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Student import (AC28): existing students with class and parents, placed in the current academic
 * year. Uses the same rules as admission: Aadhaar last 4 only, seats per section, parents shared by
 * mobile number, a permanent "Imported" status entry and the `student.enrolled` event.
 */
@Injectable()
export class StudentsImporter implements Importer<StudentImportRow> {
  readonly type = 'STUDENTS' as const;
  readonly permission = PERMISSIONS.STU_STUDENT_MANAGE;
  readonly module = 'STUDENTS' as const;

  constructor(
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly numbering: NumberingService,
  ) {}

  async helpLists(tx: Tx) {
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    const [campuses, programs, sections] = await Promise.all([
      tx.campus.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true } }),
      tx.program.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' }, select: { code: true, name: true, campus: { select: { code: true } }, levels: { orderBy: { sequence: 'asc' }, select: { name: true } } } }),
      year
        ? tx.section.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, orderBy: [{ level: { program: { code: 'asc' } } }, { level: { sequence: 'asc' } }, { name: 'asc' }], select: { name: true, capacity: true, level: { select: { name: true, program: { select: { code: true } } } } } })
        : [],
    ]);
    return [
      { title: 'Campus codes you can use', values: campuses.map((c) => `${c.code} — ${c.name}`) },
      { title: 'Programme codes and classes', values: programs.map((p) => `${p.code} (${p.campus.code}) — ${p.name}: ${p.levels.map((l) => l.name).join(', ')}`) },
      { title: `Sections in ${year?.name ?? 'the current year (none set)'}`, values: sections.map((s) => `${s.level.program.code} · ${s.level.name} · ${s.name} (${s.capacity} seats)`) },
      { title: 'Gender', values: ['Boy', 'Girl', 'Other'] },
      { title: 'Category', values: [...CATEGORIES] },
      { title: 'Blood group', values: [...BLOOD_GROUPS] },
    ];
  }

  async prepare(tx: Tx, auth: AuthContext): Promise<Ctx> {
    const [campuses, year, programs, students] = await Promise.all([
      tx.campus.findMany({ select: { id: true, code: true } }),
      tx.academicYear.findFirst({ where: { isCurrent: true, status: { not: 'CLOSED' } }, select: { id: true, name: true } }),
      tx.program.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true, campusId: true, levels: { select: { id: true, name: true } } } }),
      tx.student.findMany({ select: { admissionNo: true } }),
    ]);
    const sections = year
      ? await tx.section.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, select: { id: true, name: true, capacity: true, programLevelId: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } })
      : [];
    return {
      campusByCode: new Map(campuses.map((c) => [c.code.toUpperCase(), c.id])),
      scope: scopeFor(auth, this.permission)!,
      year,
      programs: new Map(programs.map((p) => [`${p.campusId}|${p.code.toUpperCase()}`, p.id])),
      levels: new Map(programs.flatMap((p) => p.levels.map((l) => [`${p.id}|${l.name.trim().toLowerCase()}`, l.id] as const))),
      sections: new Map(sections.map((s) => [`${s.programLevelId}|${s.name.toUpperCase()}`, { id: s.id, capacity: s.capacity, filled: s._count.enrollments }])),
      admissionNos: new Set(students.map((s) => s.admissionNo.toUpperCase())),
    };
  }

  check(v: Record<string, string>, raw: ImportContext, seen: Set<string>) {
    const ctx = raw as Ctx;
    const errors: string[] = [];
    if (!ctx.year) errors.push('No current academic year is set (Set-up → Academic years)');

    const admissionNo = text(v.admissionNo, 40);
    if (admissionNo) {
      const key = admissionNo.toUpperCase();
      if (!/^[A-Za-z0-9/_.-]+$/.test(admissionNo)) errors.push('Admission no: use letters, digits and / - _ . only');
      else if (ctx.admissionNos.has(key)) errors.push(`Admission no: ${admissionNo} already exists`);
      else if (seen.has(`adm|${key}`)) errors.push(`Admission no: ${admissionNo} appears twice in this file`);
      seen.add(`adm|${key}`);
    }

    const firstName = text(v.firstName, 80);
    if (!firstName) errors.push('First name: required');
    const dob = v.dob ? parseDate(v.dob) : null;
    if (!dob) errors.push(`Date of birth: "${v.dob ?? ''}" is not a date (use YYYY-MM-DD or DD-MM-YYYY)`);
    else if (dob >= todayIST().toISOString().slice(0, 10)) errors.push('Date of birth: must be in the past');
    const gender = GENDER_WORDS[(v.gender ?? '').trim().toLowerCase()];
    if (!gender) errors.push('Gender: use Boy, Girl or Other');

    const catRaw = (v.category ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/^CATEGORY_/, 'CAT_');
    const category = catRaw ? ((CATEGORIES as readonly string[]).includes(catRaw) ? (catRaw as Category) : undefined) : null;
    if (category === undefined) errors.push(`Category: "${v.category}" is not one of ${CATEGORIES.join(', ')}`);

    let aadhaar: string | null = null;
    if ((v.aadhaarLast4 ?? '').trim()) {
      const a = aadhaarLast4.safeParse(v.aadhaarLast4);
      if (a.success) aadhaar = a.data;
      else errors.push(`Aadhaar: ${a.error.issues[0].message}`);
    }
    const bgRaw = (v.bloodGroup ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/VE$/, '');
    const bloodGroup = bgRaw ? ((BLOOD_GROUPS as readonly string[]).includes(bgRaw) ? (bgRaw as BloodGroup) : undefined) : null;
    if (bloodGroup === undefined) errors.push(`Blood group: "${v.bloodGroup}" is not one of ${BLOOD_GROUPS.join(', ')}`);

    // Class placement: campus → programme → class → section (with a free seat).
    let seat: { id: string; capacity: number; filled: number } | undefined;
    const campusCode = (v.campusCode ?? '').trim().toUpperCase();
    const campusId = ctx.campusByCode.get(campusCode);
    if (!campusCode) errors.push('Campus code: required');
    else if (!campusId) errors.push(`Campus code: "${v.campusCode}" does not exist`);
    else if (!canAccessCampus(ctx.scope, campusId)) errors.push(`Campus code: you do not manage campus ${campusCode}`);
    else {
      const programId = ctx.programs.get(`${campusId}|${(v.programCode ?? '').trim().toUpperCase()}`);
      const levelId = programId ? ctx.levels.get(`${programId}|${(v.className ?? '').trim().toLowerCase()}`) : undefined;
      const sec = levelId ? ctx.sections.get(`${levelId}|${(v.section ?? '').trim().toUpperCase()}`) : undefined;
      if (!programId) errors.push(`Programme code: "${v.programCode ?? ''}" is not an active programme of ${campusCode}`);
      else if (!levelId) errors.push(`Class: "${v.className ?? ''}" is not a class of ${v.programCode}`);
      else if (!sec) errors.push(`Section: "${v.section ?? ''}" of ${v.className} does not exist in ${ctx.year?.name ?? 'the current year'}`);
      else seat = sec;
    }

    const admissionDate = v.admissionDate?.trim() ? parseDate(v.admissionDate) : todayIST().toISOString().slice(0, 10);
    if (!admissionDate) errors.push(`Admission date: "${v.admissionDate}" is not a date`);
    else if (dob && admissionDate <= dob) errors.push('Admission date: must be after the date of birth');

    const fatherName = text(v.fatherName, 150);
    const motherName = text(v.motherName, 150);
    const guardianName = text(v.guardianName, 150);
    if (!fatherName && !motherName && !guardianName) errors.push('Father / mother / guardian name: enter at least one');
    const parentPhone = (v.parentPhone ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(parentPhone)) errors.push(`Parent mobile: "${v.parentPhone ?? ''}" is not a 10-digit mobile number`);
    const parentEmail = text(v.parentEmail, 150)?.toLowerCase() ?? null;
    if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) errors.push(`Parent email: "${parentEmail}" is not an email address`);

    // A seat is counted only for a row that is otherwise valid (rows earlier in the file take seats first).
    if (!errors.length && seat) {
      if (seat.filled >= seat.capacity) errors.push(`Section: ${v.className} ${v.section} is full (${seat.capacity} seats)`);
      else seat.filled += 1;
    }
    if (errors.length) return { errors };
    return {
      errors,
      row: {
        admissionNo, firstName: firstName!, lastName: text(v.lastName, 80), dob: dob!, gender: gender!, category: category ?? null,
        motherTongue: text(v.motherTongue, 30), aadhaarLast4: aadhaar, bloodGroup: bloodGroup ?? null, campusId: campusId!, sectionId: seat!.id,
        rollNo: text(v.rollNo, 10), admissionDate: admissionDate!, fatherName, motherName, guardianName, parentPhone, parentEmail, address: text(v.address, 500),
      },
    };
  }

  /** Joined this year's section on the admission date, or on the first day of the year for older students. */
  private joinedOn(admissionDate: Date, yearStart: Date) {
    const d = admissionDate > yearStart ? admissionDate : yearStart;
    return d > todayIST() ? todayIST() : d;
  }

  async write(tx: Tx, row: StudentImportRow, auth: AuthContext, client: ClientInfo) {
    const tenantId = auth.tenantId!;
    const sec = await tx.section.findUniqueOrThrow({ where: { id: row.sectionId }, select: { academicYearId: true, programLevelId: true, name: true, academicYear: { select: { name: true, startDate: true } } } });
    const admissionNo = row.admissionNo ?? (await allocateNo(this.numbering, tx, 'ADMISSION', row.campusId, sec.academicYear.name, auth.userId));
    const admissionDate = day(row.admissionDate);
    const student = await tx.student.create({
      data: {
        tenantId, campusId: row.campusId, admissionNo, firstName: row.firstName, lastName: row.lastName, dob: day(row.dob), gender: row.gender, category: row.category,
        motherTongue: row.motherTongue, aadhaarLast4: row.aadhaarLast4, bloodGroup: row.bloodGroup, address: row.address, admissionDate, createdBy: auth.userId,
      },
    });
    const guardians = await linkGuardians(tx, student.id, { tenantId, fatherName: row.fatherName, motherName: row.motherName, guardianName: row.guardianName, parentPhone: row.parentPhone, parentEmail: row.parentEmail }, auth.userId);
    await tx.studentEnrollment.create({ data: { tenantId, studentId: student.id, academicYearId: sec.academicYearId, sectionId: row.sectionId, rollNo: row.rollNo, enrolledOn: this.joinedOn(admissionDate, sec.academicYear.startDate), createdBy: auth.userId } });
    await recordStatus(tx, { tenantId, studentId: student.id, oldStatus: null, newStatus: 'ACTIVE', effectiveDate: admissionDate, reason: 'Imported', userId: auth.userId });
    await autoAssign(tx, { tenantId, studentId: student.id, academicYearId: sec.academicYearId, programLevelId: sec.programLevelId, userId: auth.userId });
    await this.outbox.add(tx, {
      tenantId, eventType: EVENTS.STUDENT_ENROLLED, aggregateType: 'STUDENT', aggregateId: student.id,
      payload: { studentId: student.id, admissionNo, campusId: row.campusId, academicYearId: sec.academicYearId, sectionId: row.sectionId, source: 'IMPORT' },
      dedupeKey: `import:${student.id}`,
    });
    await this.audit.log(tx, { tenantId, userId: auth.userId, campusId: row.campusId, action: 'CREATE', entityType: 'STUDENT', entityId: student.id, newValues: { admissionNo, section: sec.name, guardians }, reason: 'Bulk import' }, client);
    return student.id;
  }
}
