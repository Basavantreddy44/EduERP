import { z } from 'zod';
import { CORE_MODULES, MODULES, ModuleCode } from './modules';
import { PERMISSIONS, PERMISSION_CATALOGUE, PermissionCode } from './permissions';

/**
 * Editions (CD-125): one code base, ready-made set-ups chosen when an institution is created.
 * An edition decides the starting modules, extra starting roles, screen wording (web) and menu
 * order. Afterwards every module, role and setting can be changed as for any institution.
 * Existing institutions are the Standard edition. A University edition comes in the next version.
 */
export const EDITION_CODES = ['STANDARD', 'RESIDENTIAL'] as const;
export type EditionCode = (typeof EDITION_CODES)[number];

export interface EditionRole {
  code: string;
  name: string;
  permissions: PermissionCode[];
}

export interface EditionDef {
  code: EditionCode;
  name: string;
  description: string;
  /** Non-core modules switched OFF at the start (everything else is on). */
  modulesOff: ModuleCode[];
  /** Roles created in addition to the system roles. */
  roles: EditionRole[];
}

/** Rights a school principal does not get: institution-wide set-up, money set-up, role management. */
const NOT_FOR_PRINCIPAL = new Set<PermissionCode>([
  PERMISSIONS.ORG_CAMPUS_CREATE, PERMISSIONS.IAM_ROLE_MANAGE, PERMISSIONS.ORG_SETTINGS_UPDATE, PERMISSIONS.ORG_NUMBERING_MANAGE,
  PERMISSIONS.APPROVALS_RULE_MANAGE, PERMISSIONS.ORG_ACADEMIC_MANAGE, PERMISSIONS.ACC_SETUP, PERMISSIONS.ACC_CLOSE, PERMISSIONS.ACC_REVEAL,
  PERMISSIONS.HR_SETUP, PERMISSIONS.HR_REVEAL, PERMISSIONS.PAYROLL_SETUP, PERMISSIONS.PAYROLL_SALARY, PERMISSIONS.PAYROLL_RUN, PERMISSIONS.PAYROLL_PAY,
  PERMISSIONS.PAYROLL_LOAN, PERMISSIONS.FEE_SETUP_MANAGE, PERMISSIONS.CERT_SETUP, PERMISSIONS.DEPT_REQ_SETUP, PERMISSIONS.INV_SETUP,
  PERMISSIONS.WELFARE_MANAGE, PERMISSIONS.DIET_MANAGE, PERMISSIONS.GRIEVANCE_SENSITIVE, PERMISSIONS.ALLOT_MANAGE, PERMISSIONS.STU_TRANSFER, PERMISSIONS.HR_TRANSFER, PERMISSIONS.ATT_SETUP, PERMISSIONS.EXAM_SETUP, PERMISSIONS.ACAD_SETUP,
]);

const COMMON: PermissionCode[] = [PERMISSIONS.ORG_CAMPUS_READ, PERMISSIONS.MEETING_ATTEND, PERMISSIONS.LEAVE_SELF, PERMISSIONS.DEPT_REQ_RAISE, PERMISSIONS.FEED_READ, PERMISSIONS.EVENT_READ, PERMISSIONS.GRIEVANCE_RAISE];

const RESIDENTIAL_ROLES: EditionRole[] = [
  {
    code: 'HEAD_OFFICE_OFFICER', name: 'Head office officer',
    permissions: [...COMMON, PERMISSIONS.OVERVIEW_READ, PERMISSIONS.ORG_ACADEMIC_READ, PERMISSIONS.STU_STUDENT_READ, PERMISSIONS.HR_STAFF_READ, PERMISSIONS.HR_PROFILE_READ,
      PERMISSIONS.ATT_READ, PERMISSIONS.EXAM_READ, PERMISSIONS.HOSTEL_READ, PERMISSIONS.HEALTH_READ, PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_MANAGE,
      PERMISSIONS.DIET_MANAGE, PERMISSIONS.GOV_EXPORT_MANAGE, PERMISSIONS.INV_READ, PERMISSIONS.ACAD_READ, PERMISSIONS.AUDIT_LOG_READ,
      PERMISSIONS.ALLOT_MANAGE, PERMISSIONS.ALLOT_JOIN, PERMISSIONS.STU_TRANSFER, PERMISSIONS.HR_TRANSFER, PERMISSIONS.STU_STUDENT_MANAGE],
  },
  {
    code: 'PRINCIPAL', name: 'Principal',
    permissions: PERMISSION_CATALOGUE.map((p) => p.code).filter((c) => !NOT_FOR_PRINCIPAL.has(c)),
  },
  {
    code: 'WARDEN', name: 'Warden',
    permissions: [...COMMON, PERMISSIONS.STU_STUDENT_READ, PERMISSIONS.HOSTEL_READ, PERMISSIONS.HOSTEL_ALLOT, PERMISSIONS.HOSTEL_WARDEN, PERMISSIONS.MESS_MANAGE,
      PERMISSIONS.MEALS_RECORD, PERMISSIONS.HEALTH_READ, PERMISSIONS.HEALTH_HOSTEL, PERMISSIONS.LEAVE_STUDENT, PERMISSIONS.ATT_READ, PERMISSIONS.DISC_REPORT,
      PERMISSIONS.WELFARE_READ, PERMISSIONS.WELFARE_GIVE, PERMISSIONS.FRONT_DESK],
  },
  {
    code: 'KITCHEN_INCHARGE', name: 'Kitchen in-charge',
    permissions: [...COMMON, PERMISSIONS.HOSTEL_READ, PERMISSIONS.MESS_MANAGE, PERMISSIONS.MEALS_RECORD, PERMISSIONS.INV_READ, PERMISSIONS.INV_REQUEST, PERMISSIONS.INV_RECEIVE, PERMISSIONS.INV_ISSUE],
  },
];

export const EDITIONS: Record<EditionCode, EditionDef> = {
  STANDARD: {
    code: 'STANDARD', name: 'EduERP',
    description: 'Private schools, PU and degree colleges — every module on',
    modulesOff: [],
    roles: [],
  },
  RESIDENTIAL: {
    code: 'RESIDENTIAL', name: 'EduERP Residential',
    description: 'Government residential schools (Morarji Desai / KREIS): hostel, meals, welfare, SATS / UDISE+ and a head office over many schools',
    modulesOff: ['ADMISSIONS', 'FEES', 'TRANSPORT', 'PLACEMENTS'],
    roles: RESIDENTIAL_ROLES,
  },
};

/** Menu sections (web nav keys) shown first, in this order; the other sections keep the standard order after them. */
export const EDITION_MENU_FIRST: Record<EditionCode, string[]> = {
  STANDARD: [],
  RESIDENTIAL: ['nav.overview', 'nav.students', 'nav.hostel', 'nav.campusCare', 'nav.attendance', 'nav.academics', 'nav.exams'],
};

/** Module on/off list an edition starts with (core modules always on). */
export function editionModules(code: EditionCode): { code: ModuleCode; isEnabled: boolean }[] {
  const off = new Set<string>(EDITIONS[code].modulesOff);
  return MODULES.map((m) => ({ code: m.code, isEnabled: (CORE_MODULES as string[]).includes(m.code) || !off.has(m.code) }));
}

export const editionSchema = z.enum(EDITION_CODES);
export const changeEditionSchema = z.object({
  edition: editionSchema,
  reason: z.string().trim().min(3, 'Give a reason (at least 3 letters)').max(300),
});
export type ChangeEditionInput = z.infer<typeof changeEditionSchema>;

// ───────────── Institution profile & branding (E4) ─────────────

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const institutionProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter the name (at least 2 letters)').max(200),
  nameLocal: optText(200),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email').max(150)]).optional().nullable().transform((v) => (v ? v : null)),
  phone: z.union([z.literal(''), z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')]).optional().nullable().transform((v) => (v ? v : null)),
  website: optText(200),
  address: optText(500),
  city: optText(100),
  district: optText(100),
  state: optText(100),
  pincode: z.union([z.literal(''), z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits')]).optional().nullable().transform((v) => (v ? v : null)),
});
export type InstitutionProfileInput = z.infer<typeof institutionProfileSchema>;

/** Logo: images only (sniffed from the bytes), at most this size. */
export const LOGO_MAX_BYTES = 1024 * 1024;
