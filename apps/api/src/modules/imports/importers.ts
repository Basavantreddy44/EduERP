import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  DEPT_TYPE_LABELS, DEPT_TYPES, HOLIDAY_TYPE_LABELS, HOLIDAY_TYPES, IMPORT_TYPES, ImportTypeCode, ModuleCode, PERMISSIONS, PermissionCode,
  createDepartmentSchema, createHolidaySchema, inviteUserSchema,
} from '@eduerp/shared';
import { Prisma } from '@eduerp/db';
import type { Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, CampusScope, canAccessCampus, scopeFor } from '../../common/auth-context';
import type { ClientInfo } from '../../common/decorators';
import { UsersService } from '../users/users.service';

/** Lookups loaded once per validation run. */
export interface ImportContext {
  campusByCode: Map<string, string>; // CODE → id
  scope: CampusScope;
  [k: string]: unknown;
}

export interface Importer<T> {
  type: ImportTypeCode;
  permission: PermissionCode;
  /** Plan module the import belongs to (refused when the institution's plan does not include it). */
  module?: ModuleCode;
  /** Lists shown on the template's Help sheet. */
  helpLists(tx: Tx): Promise<{ title: string; values: string[] }[]>;
  prepare(tx: Tx, auth: AuthContext): Promise<ImportContext>;
  /** Raw text values → typed row, or field errors. `seen` catches duplicates inside the file. */
  check(values: Record<string, string>, ctx: ImportContext, seen: Set<string>): { row?: T; errors: string[] };
  /** Writes one valid row (inside the commit transaction); returns the new record id. */
  write(tx: Tx, row: T, auth: AuthContext, client: ClientInfo): Promise<string>;
}

// ───────────── helpers ─────────────

const zodErrors = (e: z.ZodError, labels: Record<string, string>) =>
  e.issues.map((i) => `${labels[String(i.path[0])] ?? String(i.path[0])}: ${i.message}`);

/** Accepts a label ("Public holiday"), a code ("PUBLIC") or a loose spelling ("public"). */
function pickEnum<T extends string>(raw: string, codes: readonly T[], labels: Record<T, string>, fallback?: T): T | null {
  const v = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!v) return fallback ?? null;
  for (const c of codes) {
    if (c.toLowerCase().replace(/_/g, ' ') === v || labels[c].toLowerCase() === v || labels[c].toLowerCase().startsWith(v)) return c;
  }
  return null;
}

/** YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD (null when not a real date). */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Campus code column → id (or null for institution-wide), enforcing the importer's campus scope. */
function campusFrom(code: string, ctx: ImportContext, errors: string[]): string | null | undefined {
  const c = code.trim().toUpperCase();
  if (!c) {
    if (!ctx.scope.all) errors.push('Campus code: you can only add rows for your own campuses');
    return null;
  }
  const id = ctx.campusByCode.get(c);
  if (!id) {
    errors.push(`Campus code: "${code}" does not exist`);
    return undefined;
  }
  if (!canAccessCampus(ctx.scope, id)) errors.push(`Campus code: you do not manage campus ${c}`);
  return id;
}

async function baseContext(tx: Tx, auth: AuthContext, permission: PermissionCode): Promise<ImportContext> {
  const campuses = await tx.campus.findMany({ select: { id: true, code: true } });
  return { campusByCode: new Map(campuses.map((c) => [c.code.toUpperCase(), c.id])), scope: scopeFor(auth, permission)! };
}

const campusHelp = async (tx: Tx) => ({ title: 'Campus codes you can use', values: (await tx.campus.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true } })).map((c) => `${c.code} — ${c.name}`) });

const labelsOf = (t: ImportTypeCode) => Object.fromEntries(IMPORT_TYPES[t].columns.map((c) => [c.key, c.header]));

// ───────────── Departments ─────────────

type DeptRow = z.infer<typeof createDepartmentSchema> & { campusId: string | null };

@Injectable()
export class DepartmentsImporter implements Importer<DeptRow> {
  readonly type = 'DEPARTMENTS' as const;
  readonly permission = PERMISSIONS.ORG_ACADEMIC_MANAGE;
  constructor(private readonly audit: AuditService) {}

  async helpLists(tx: Tx) {
    return [await campusHelp(tx), { title: 'Types', values: DEPT_TYPES.map((t) => DEPT_TYPE_LABELS[t]) }];
  }

  async prepare(tx: Tx, auth: AuthContext) {
    const ctx = await baseContext(tx, auth, this.permission);
    const existing = await tx.department.findMany({ select: { campusId: true, code: true } });
    ctx.existing = new Set(existing.map((d) => `${d.campusId ?? '-'}|${d.code}`));
    return ctx;
  }

  check(v: Record<string, string>, ctx: ImportContext, seen: Set<string>) {
    const errors: string[] = [];
    const campusId = campusFrom(v.campusCode ?? '', ctx, errors);
    const deptType = pickEnum(v.deptType ?? '', DEPT_TYPES, DEPT_TYPE_LABELS);
    if (!deptType) errors.push('Type: use Academic, Administration or Support');
    const parsed = createDepartmentSchema.safeParse({ name: v.name, code: v.code, deptType: deptType ?? 'ACADEMIC', campusId: campusId ?? null });
    if (!parsed.success) errors.push(...zodErrors(parsed.error, labelsOf('DEPARTMENTS')));
    if (parsed.success && campusId !== undefined) {
      const key = `${campusId ?? '-'}|${parsed.data.code}`;
      if ((ctx.existing as Set<string>).has(key)) errors.push(`Code: ${parsed.data.code} already exists${campusId ? ' on this campus' : ''}`);
      else if (seen.has(key)) errors.push(`Code: ${parsed.data.code} appears twice in this file`);
      seen.add(key);
    }
    return errors.length ? { errors } : { row: { ...parsed.data!, campusId: campusId ?? null }, errors };
  }

  async write(tx: Tx, row: DeptRow, auth: AuthContext, client: ClientInfo) {
    const d = await tx.department.create({ data: { tenantId: auth.tenantId!, campusId: row.campusId, name: row.name, code: row.code, deptType: row.deptType, createdBy: auth.userId } });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: row.campusId, action: 'CREATE', entityType: 'DEPARTMENT', entityId: d.id, newValues: d, reason: 'Bulk import' }, client);
    return d.id;
  }
}

// ───────────── Holidays ─────────────

type HolidayRow = z.infer<typeof createHolidaySchema> & { campusId: string | null };

@Injectable()
export class HolidaysImporter implements Importer<HolidayRow> {
  readonly type = 'HOLIDAYS' as const;
  readonly permission = PERMISSIONS.ORG_ACADEMIC_MANAGE;
  constructor(private readonly audit: AuditService) {}

  async helpLists(tx: Tx) {
    return [await campusHelp(tx), { title: 'Types', values: HOLIDAY_TYPES.map((t) => HOLIDAY_TYPE_LABELS[t]) }];
  }

  async prepare(tx: Tx, auth: AuthContext) {
    const ctx = await baseContext(tx, auth, this.permission);
    const existing = await tx.holiday.findMany({ select: { campusId: true, holidayDate: true } });
    ctx.existing = new Set(existing.map((h) => `${h.campusId ?? '-'}|${h.holidayDate.toISOString().slice(0, 10)}`));
    return ctx;
  }

  check(v: Record<string, string>, ctx: ImportContext, seen: Set<string>) {
    const errors: string[] = [];
    const campusId = campusFrom(v.campusCode ?? '', ctx, errors);
    const date = v.holidayDate ? parseDate(v.holidayDate) : null;
    if (!date) errors.push(`Date: "${v.holidayDate ?? ''}" is not a date (use YYYY-MM-DD or DD-MM-YYYY)`);
    const holidayType = pickEnum(v.holidayType ?? '', HOLIDAY_TYPES, HOLIDAY_TYPE_LABELS, 'PUBLIC');
    if (!holidayType) errors.push('Type: use Public holiday, Institution holiday or Exam break');
    const parsed = createHolidaySchema.safeParse({ holidayDate: date ?? '2000-01-01', name: v.name, holidayType: holidayType ?? 'PUBLIC', campusId: campusId ?? null });
    if (!parsed.success) errors.push(...zodErrors(parsed.error, labelsOf('HOLIDAYS')));
    if (date && campusId !== undefined) {
      const key = `${campusId ?? '-'}|${date}`;
      if ((ctx.existing as Set<string>).has(key)) errors.push(`Date: a holiday is already set on ${date}`);
      else if (seen.has(key)) errors.push(`Date: ${date} appears twice in this file`);
      seen.add(key);
    }
    return errors.length ? { errors } : { row: { ...parsed.data!, campusId: campusId ?? null }, errors };
  }

  async write(tx: Tx, row: HolidayRow, auth: AuthContext, client: ClientInfo) {
    const h = await tx.holiday.create({ data: { tenantId: auth.tenantId!, campusId: row.campusId, holidayDate: new Date(`${row.holidayDate}T00:00:00.000Z`), name: row.name, holidayType: row.holidayType, createdBy: auth.userId } });
    await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId: row.campusId, action: 'CREATE', entityType: 'HOLIDAY', entityId: h.id, newValues: row, reason: 'Bulk import' }, client);
    return h.id;
  }
}

// ───────────── Users (bulk invite) ─────────────

type UserRow = { fullName: string; email: string; role: { id: string; code: string }; campusId: string | null };

@Injectable()
export class UsersImporter implements Importer<UserRow> {
  readonly type = 'USERS' as const;
  readonly permission = PERMISSIONS.IAM_USER_INVITE;
  constructor(private readonly users: UsersService) {}

  async helpLists(tx: Tx) {
    const roles = await tx.role.findMany({ orderBy: { name: 'asc' }, select: { name: true, code: true } });
    return [await campusHelp(tx), { title: 'Roles you can use', values: roles.map((r) => `${r.name} (${r.code})`) }];
  }

  async prepare(tx: Tx, auth: AuthContext) {
    const ctx = await baseContext(tx, auth, this.permission);
    const roles = await tx.role.findMany({ select: { id: true, code: true, name: true } });
    ctx.roles = new Map(roles.flatMap((r) => [[r.code.toLowerCase(), r], [r.name.toLowerCase(), r]] as const));
    const members = await tx.userTenant.findMany({ where: { status: 'ACTIVE' }, select: { user: { select: { email: true } } } });
    ctx.memberEmails = new Set(members.map((m) => m.user.email?.toLowerCase()).filter(Boolean));
    return ctx;
  }

  check(v: Record<string, string>, ctx: ImportContext, seen: Set<string>) {
    const errors: string[] = [];
    const campusId = campusFrom(v.campusCode ?? '', ctx, errors);
    const role = (ctx.roles as Map<string, { id: string; code: string }>).get((v.role ?? '').trim().toLowerCase());
    if (!role) errors.push(`Role: "${v.role ?? ''}" is not a role of this institution`);
    const parsed = inviteUserSchema.safeParse({ fullName: v.fullName, email: v.email, roleCode: role?.code ?? 'X_', campusId: campusId ?? null });
    if (!parsed.success) errors.push(...zodErrors(parsed.error, labelsOf('USERS')).filter((e) => !e.startsWith('roleCode')));
    if (parsed.success) {
      const email = parsed.data.email;
      if ((ctx.memberEmails as Set<string>).has(email)) errors.push(`Email: ${email} already has access`);
      else if (seen.has(email)) errors.push(`Email: ${email} appears twice in this file`);
      seen.add(email);
    }
    return errors.length ? { errors } : { row: { fullName: parsed.data!.fullName, email: parsed.data!.email, role: role!, campusId: campusId ?? null }, errors };
  }

  async write(tx: Tx, row: UserRow, auth: AuthContext, client: ClientInfo) {
    return (await this.users.addMember(tx, row, auth, client)).userId;
  }
}

export const IMPORTERS = Symbol('Importers');
export type AnyImporter = Importer<unknown>;
export const asJson = (v: unknown) => v as Prisma.InputJsonValue;
