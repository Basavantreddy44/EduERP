import { z } from 'zod';

const phone = z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const pincode = z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits');
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(150), // email or phone
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });

export const INSTITUTION_TYPES = ['SCHOOL', 'PU_COLLEGE', 'DEGREE_COLLEGE', 'UNIVERSITY', 'GROUP'] as const;
export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CLOSED'] as const;

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  nameLocal: optionalText(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/, 'Use lowercase letters, digits and hyphens'),
  institutionType: z.enum(INSTITUTION_TYPES),
  email: z.string().trim().email().max(150).optional().nullable(),
  phone: phone.optional().nullable(),
  city: optionalText(100),
  state: optionalText(100),
  defaultLanguage: z.enum(['en', 'kn']).default('en'),
  admin: z.object({
    fullName: z.string().trim().min(2).max(150),
    email: z.string().trim().toLowerCase().email().max(150),
    password: z.string().min(10).max(200),
  }),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantStatusSchema = z.object({
  status: z.enum(TENANT_STATUSES),
  reason: z.string().trim().min(3).max(300),
});

export const CAMPUS_TYPES = ['SCHOOL', 'PU', 'DEGREE', 'PG', 'OTHER'] as const;

export const createCampusSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 letters, digits, - or _'),
  name: z.string().trim().min(2).max(200),
  nameLocal: optionalText(200),
  campusType: z.enum(CAMPUS_TYPES),
  affiliationNo: optionalText(50),
  udiseCode: optionalText(20),
  address: optionalText(500),
  city: optionalText(100),
  district: optionalText(100),
  state: optionalText(100),
  pincode: pincode.optional().nullable(),
  phone: phone.optional().nullable(),
  email: z.string().trim().email().max(150).optional().nullable(),
});
export type CreateCampusInput = z.infer<typeof createCampusSchema>;

export const updateCampusSchema = createCampusSchema
  .omit({ code: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export type UpdateCampusInput = z.infer<typeof updateCampusSchema>;

export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(150),
  roleCode: z.string().trim().min(2).max(50),
  campusId: z.string().uuid().optional().nullable(), // null = all campuses
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** A custom role (built-in roles are fixed templates — copy one to customise). */
export const roleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  permissionCodes: z.array(z.string().trim().min(3).max(100)).min(1, 'Choose at least one right').max(500),
});
export type RoleInput = z.infer<typeof roleSchema>;
/** Gives a user a role for all campuses (null) or one campus. */
export const assignRoleSchema = z.object({ roleId: z.string().uuid(), campusId: z.string().uuid().nullable().optional() });
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
});
