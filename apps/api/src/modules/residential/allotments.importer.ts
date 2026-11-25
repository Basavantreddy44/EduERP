import { Injectable } from '@nestjs/common';
import { CATEGORIES, PERMISSIONS } from '@eduerp/shared';
import type { Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import type { AuthContext } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import { ImportContext, Importer, baseContext, campusFrom, parseDate } from '../imports/importers';

export interface AllotmentRow {
  entranceRegNo: string;
  firstName: string;
  lastName: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dob: string;
  category: string | null;
  quota: string | null;
  rank: number | null;
  campusId: string;
  levelName: string;
  fatherName: string | null;
  motherName: string | null;
  parentPhone: string;
  address: string | null;
}

interface Ctx extends ImportContext {
  year: { id: string; name: string } | null;
  levels: Map<string, Set<string>>; // campusId → class names (lower case) taught this year
  levelName: Map<string, string>; // campusId|lower → proper name
  regNos: Set<string>;
}

const GENDER_WORDS: Record<string, AllotmentRow['gender']> = { boy: 'MALE', male: 'MALE', m: 'MALE', girl: 'FEMALE', female: 'FEMALE', f: 'FEMALE', other: 'OTHER' };
const text = (v: string | undefined, max: number) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Allotment list (Phase 21 R1): children allotted to the institution's schools by the entrance /
 * counselling list, for the current academic year. Nothing is created in the student register until
 * a school marks the child as joined.
 */
@Injectable()
export class AllotmentsImporter implements Importer<AllotmentRow> {
  readonly type = 'ALLOTMENTS' as const;
  readonly permission = PERMISSIONS.ALLOT_MANAGE;
  readonly module = 'STUDENTS' as const;
  constructor(private readonly audit: AuditService) {}

  async helpLists(tx: Tx) {
    const campuses = await tx.campus.findMany({ orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    const levels = year
      ? await tx.$queryRaw<{ campus_id: string; name: string }[]>`
          SELECT DISTINCT s.campus_id, pl.name FROM sections s JOIN program_levels pl ON pl.id = s.program_level_id
           WHERE s.academic_year_id = ${year.id}::uuid AND s.status = 'ACTIVE' ORDER BY pl.name`
      : [];
    return [
      { title: 'School codes you can use', values: campuses.map((c) => `${c.code} — ${c.name}`) },
      { title: 'Classes this year', values: [...new Set(levels.map((l) => l.name))] },
      { title: 'Categories', values: [...CATEGORIES] },
    ];
  }

  async prepare(tx: Tx, auth: AuthContext): Promise<Ctx> {
    const base = await baseContext(tx, auth, this.permission);
    const year = await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true } });
    const levels = new Map<string, Set<string>>();
    const levelName = new Map<string, string>();
    if (year) {
      const rows = await tx.$queryRaw<{ campus_id: string; name: string }[]>`
        SELECT DISTINCT s.campus_id, pl.name FROM sections s JOIN program_levels pl ON pl.id = s.program_level_id
         WHERE s.academic_year_id = ${year.id}::uuid AND s.status = 'ACTIVE'`;
      for (const r of rows) {
        const k = r.name.trim().toLowerCase();
        if (!levels.has(r.campus_id)) levels.set(r.campus_id, new Set());
        levels.get(r.campus_id)!.add(k);
        levelName.set(`${r.campus_id}|${k}`, r.name);
      }
    }
    const regNos = year ? new Set((await tx.studentAllotment.findMany({ where: { academicYearId: year.id }, select: { entranceRegNo: true } })).map((a) => a.entranceRegNo.toUpperCase())) : new Set<string>();
    return { ...base, year, levels, levelName, regNos };
  }

  check(v: Record<string, string>, ctx: Ctx, seen: Set<string>) {
    const errors: string[] = [];
    if (!ctx.year) return { errors: ['There is no current academic year. Set one under Setup → Academic years.'] };
    const reg = (v.entranceRegNo ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9/_-]{3,30}$/.test(reg)) errors.push('Entrance reg no: 3–30 letters, digits, / - or _');
    else if (seen.has(reg)) errors.push(`Entrance reg no: ${reg} is twice in this file`);
    else if (ctx.regNos.has(reg)) errors.push(`Entrance reg no: ${reg} is already on the allotment list for ${ctx.year.name}`);
    seen.add(reg);
    const firstName = text(v.firstName, 100);
    if (!firstName) errors.push('First name: required');
    const gender = GENDER_WORDS[(v.gender ?? '').trim().toLowerCase()];
    if (!gender) errors.push('Gender: Boy, Girl or Other');
    const dob = parseDate(v.dob ?? '');
    if (!dob) errors.push('Date of birth: YYYY-MM-DD or DD-MM-YYYY');
    else if (dob > new Date().toISOString().slice(0, 10)) errors.push('Date of birth: in the future');
    // Karnataka writes Category 1 as "1", "Cat-1" or "Category 1" (and "Cat-2A" for 2A).
    let category = text(v.category, 20)?.toUpperCase().replace(/^(CAT(EGORY)?[\s_-]?)?(1|I)$/, 'CAT_1').replace(/^(CAT(EGORY)?[\s_-]?)(2A|2B|3A|3B)$/, '$3') ?? null;
    if (category && !(CATEGORIES as readonly string[]).includes(category)) {
      errors.push(`Category: one of ${CATEGORIES.join(', ')}`);
      category = null;
    }
    let rank: number | null = null;
    if ((v.rank ?? '').trim()) {
      rank = Number(v.rank.trim());
      if (!Number.isInteger(rank) || rank < 1) errors.push('Rank: a whole number from 1');
    }
    const campusId = campusFrom(v.campusCode ?? '', ctx, errors);
    if ((v.campusCode ?? '').trim() === '') errors.push('School code: required');
    const cls = (v.className ?? '').trim().toLowerCase();
    let levelName = '';
    if (!cls) errors.push('Class: required');
    else if (campusId && !ctx.levels.get(campusId)?.has(cls)) errors.push(`Class: "${v.className}" has no section at this school in ${ctx.year.name}`);
    else if (campusId) levelName = ctx.levelName.get(`${campusId}|${cls}`)!;
    const fatherName = text(v.fatherName, 150);
    const motherName = text(v.motherName, 150);
    if (!fatherName && !motherName) errors.push('Father or mother name: at least one');
    const parentPhone = (v.parentPhone ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(parentPhone)) errors.push('Parent mobile: a 10-digit mobile number');
    if (errors.length) return { errors };
    return {
      errors,
      row: { entranceRegNo: reg, firstName: firstName!, lastName: text(v.lastName, 100), gender: gender!, dob: dob!, category, quota: text(v.quota, 60), rank, campusId: campusId!, levelName, fatherName, motherName, parentPhone, address: text(v.address, 500) },
    };
  }

  async write(tx: Tx, row: AllotmentRow, auth: AuthContext, client: ClientInfo) {
    const year = await tx.academicYear.findFirstOrThrow({ where: { isCurrent: true }, select: { id: true } });
    const a = await tx.studentAllotment.create({
      data: { ...row, dob: new Date(`${row.dob}T00:00:00Z`), tenantId: auth.tenantId!, academicYearId: year.id, createdBy: auth.userId },
    });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: row.campusId, action: 'CREATE', entityType: 'STUDENT_ALLOTMENT', entityId: a.id, newValues: { entranceRegNo: row.entranceRegNo, levelName: row.levelName }, reason: 'Allotment list import' }, client);
    return a.id;
  }
}
