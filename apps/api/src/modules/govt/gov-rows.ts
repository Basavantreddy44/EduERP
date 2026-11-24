import { GOV_FIELDS, GOV_STANDARD_LAYOUTS, GovExportCode, GovFieldKey } from '@eduerp/shared';
import { Tx } from '../../common/prisma.service';
import { fullName, iso } from '../campuslife/common';

type Cell = string | number | null;
export type GovRow = Record<GovFieldKey, Cell> & { studentId: string; campusId: string };
export interface GovColumn { key: GovFieldKey; label: string; type: 'text' | 'date' | 'number' }

const FIELD = new Map(GOV_FIELDS.map((f) => [f.key as GovFieldKey, f]));
const yn = (v: boolean | null | undefined) => (v == null ? null : v ? 'Yes' : 'No');
/** Karnataka reservation categories fold into the four national social categories for UDISE+. */
const social = (c: string | null) => (!c ? null : c === 'GENERAL' ? 'GEN' : c === 'SC' || c === 'ST' ? c : 'OBC');
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

/** The export's columns: the institution's own layout, or the standard one. */
export async function govColumns(tx: Tx, code: GovExportCode): Promise<GovColumn[]> {
  // Row-level security limits the read to the current institution.
  const own = await tx.govExportLayout.findFirst({ where: { exportCode: code } });
  const list = own && Array.isArray(own.columns) ? (own.columns as { key: GovFieldKey; label: string }[]).filter((c) => FIELD.has(c.key)) : GOV_STANDARD_LAYOUTS[code].map((k) => ({ key: k, label: FIELD.get(k)!.label }));
  return list.map((c) => ({ key: c.key, label: c.label, type: FIELD.get(c.key)!.type }));
}

/** One row per active student of the given campuses (null = all), optionally one class section. */
export async function govRows(tx: Tx, campuses: string[] | null, f: { campusId?: string; sectionId?: string; studentIds?: string[] }, max = 50_000): Promise<GovRow[]> {
  const campusWhere = f.campusId ? (campuses && !campuses.includes(f.campusId) ? '00000000-0000-0000-0000-000000000000' : f.campusId) : campuses ? { in: campuses } : undefined;
  const students = await tx.student.findMany({
    where: { campusId: campusWhere as never, status: 'ACTIVE', ...(f.studentIds ? { id: { in: f.studentIds } } : {}), ...(f.sectionId ? { enrollments: { some: { sectionId: f.sectionId, status: 'ACTIVE' } } } : {}) },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: max,
    select: {
      id: true, campusId: true, admissionNo: true, firstName: true, lastName: true, nameLocal: true, dob: true, gender: true, category: true, religion: true, motherTongue: true, aadhaarLast4: true, bloodGroup: true, apaarId: true, address: true, admissionDate: true,
      enrollments: { where: { status: 'ACTIVE' }, orderBy: { enrolledOn: 'desc' }, take: 1, select: { rollNo: true, section: { select: { name: true, level: { select: { name: true } } } } } },
      guardians: { select: { relation: true, isPrimary: true, guardian: { select: { name: true, phone: true, email: true } } } },
    },
  });
  const ids = students.map((s) => s.id);
  const [gov, health, campusRows] = await Promise.all([
    tx.studentGovProfile.findMany({ where: { studentId: { in: ids } } }),
    tx.studentHealthProfile.findMany({ where: { studentId: { in: ids } }, select: { studentId: true, heightCm: true, weightKg: true } }),
    tx.campus.findMany({ select: { id: true, name: true, udiseCode: true } }),
  ]);
  const G = new Map(gov.map((g) => [g.studentId, g]));
  const H = new Map(health.map((h) => [h.studentId, h]));
  const C = new Map(campusRows.map((c) => [c.id, c]));
  return students.map((s) => {
    const g = G.get(s.id);
    const h = H.get(s.id);
    const e = s.enrollments[0];
    const by = (rel: string) => s.guardians.find((x) => x.relation === rel)?.guardian ?? null;
    const primary = s.guardians.find((x) => x.isPrimary)?.guardian ?? s.guardians[0]?.guardian ?? null;
    const row: Record<GovFieldKey, Cell> = {
      satsId: g?.satsId ?? null, penNo: g?.penNo ?? null, apaarId: s.apaarId, admissionNo: s.admissionNo, admissionDate: iso(s.admissionDate),
      name: fullName(s), nameLocal: s.nameLocal, gender: s.gender, dob: iso(s.dob), className: e?.section.level.name ?? null, section: e?.section.name ?? null, rollNo: e?.rollNo ?? null,
      medium: g?.mediumOfInstruction ?? null, motherTongue: s.motherTongue, religion: s.religion, category: s.category, socialCategory: social(s.category), minorityGroup: g?.minorityGroup ?? null,
      fatherName: by('FATHER')?.name ?? null, motherName: by('MOTHER')?.name ?? null, guardianName: by('GUARDIAN')?.name ?? null, parentPhone: primary?.phone ?? null, parentEmail: primary?.email ?? null,
      address: s.address, aadhaarLast4: s.aadhaarLast4, rationCard: g?.rationCardType ?? null,
      bpl: g?.rationCardType ? yn(g.rationCardType === 'BPL' || g.rationCardType === 'AAY') : null, aay: g?.rationCardType ? yn(g.rationCardType === 'AAY') : null,
      ews: yn(g?.isEws), cwsn: g ? yn(g.isCwsn) : null, disabilityType: g?.disabilityType ?? null,
      heightCm: num(h?.heightCm), weightKg: num(h?.weightKg), bloodGroup: s.bloodGroup, distanceKm: num(g?.distanceKm), previousSchool: g?.previousSchool ?? null,
      campus: C.get(s.campusId)?.name ?? null, udiseCode: C.get(s.campusId)?.udiseCode ?? null,
    };
    return { ...row, studentId: s.id, campusId: s.campusId };
  });
}

/** Required fields a row is missing for an export (labels). */
export function missingFor(code: GovExportCode, r: GovRow): string[] {
  return GOV_FIELDS.filter((f) => (f.required as readonly string[]).includes(code) && (r[f.key] == null || r[f.key] === '')).map((f) => f.label);
}
