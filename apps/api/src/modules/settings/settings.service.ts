import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS, PutSettingInput, SETTINGS, SETTINGS_BY_KEY, SettingDefinition } from '@eduerp/shared';
import { Prisma } from '@eduerp/db';
import { Db, Tx } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AuthContext, canAccessCampus, scopeFor } from '../../common/auth-context';
import { AppError, Forbidden, NotFound } from '../../common/problem';
import type { ClientInfo } from '../../common/decorators';

type Source = 'CAMPUS' | 'INSTITUTION' | 'DEFAULT';

export interface EffectiveSetting {
  key: string;
  label: string;
  description: string;
  group: string;
  scopes: string[];
  defaultValue: unknown;
  institutionValue: unknown;
  campusValue: unknown;
  value: unknown;
  source: Source;
}

const unknownKey = (key: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'setting-unknown', `There is no setting called "${key}"`);

/**
 * Settings registry (G-11). Values are validated against the shared registry; the effective value
 * resolves campus override → institution value → registry default.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** For other services: the effective value of one setting inside an existing transaction. */
  async effective<T = unknown>(tx: Tx, key: string, campusId?: string | null): Promise<T> {
    const def = SETTINGS_BY_KEY[key];
    if (!def) throw unknownKey(key);
    const rows = await tx.setting.findMany({
      where: { settingKey: key, OR: [{ campusId: null }, ...(campusId ? [{ campusId }] : [])] },
      select: { campusId: true, settingValue: true },
    });
    const campus = campusId ? rows.find((r) => r.campusId === campusId) : undefined;
    const inst = rows.find((r) => r.campusId === null);
    return (campus?.settingValue ?? inst?.settingValue ?? def.defaultValue) as T;
  }

  async list(auth: AuthContext, campusId?: string): Promise<EffectiveSetting[]> {
    const scope = scopeFor(auth, PERMISSIONS.ORG_SETTINGS_READ)!;
    if (campusId && !canAccessCampus(scope, campusId)) throw NotFound('Campus');
    const rows = await this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
      return tx.setting.findMany({
        where: { OR: [{ campusId: null }, ...(campusId ? [{ campusId }] : [])] },
        select: { campusId: true, settingKey: true, settingValue: true },
      });
    });
    return SETTINGS.map((d) => {
      const def = d as SettingDefinition;
      const inst = rows.find((r) => r.settingKey === def.key && r.campusId === null);
      const camp = campusId ? rows.find((r) => r.settingKey === def.key && r.campusId === campusId) : undefined;
      const source: Source = camp ? 'CAMPUS' : inst ? 'INSTITUTION' : 'DEFAULT';
      return {
        key: def.key,
        label: def.label,
        description: def.description,
        group: def.group,
        scopes: def.scopes,
        defaultValue: def.defaultValue,
        institutionValue: inst?.settingValue ?? null,
        campusValue: camp?.settingValue ?? null,
        value: camp ? camp.settingValue : inst ? inst.settingValue : def.defaultValue,
        source,
      };
    });
  }

  async put(key: string, input: PutSettingInput, auth: AuthContext, client: ClientInfo) {
    const def = SETTINGS_BY_KEY[key];
    if (!def) throw unknownKey(key);
    const campusId = input.campusId ?? null;
    this.checkWriteScope(def, campusId, auth);

    const parsed = def.schema.safeParse(input.value);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({ field: ['value', ...i.path].join('.'), message: i.message }));
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'validation-failed', 'Some fields are invalid', errors);
    }
    const value = parsed.data as Prisma.InputJsonValue;

    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const tenantId = auth.tenantId!;
      if (campusId && !(await tx.campus.findUnique({ where: { id: campusId }, select: { id: true } }))) throw NotFound('Campus');
      const existing = await tx.setting.findFirst({ where: { settingKey: key, campusId }, select: { id: true, settingValue: true } });
      const row = existing
        ? await tx.setting.update({ where: { id: existing.id }, data: { settingValue: value, updatedBy: auth.userId } })
        : await tx.setting.create({ data: { tenantId, campusId, settingKey: key, settingValue: value, createdBy: auth.userId } });
      await this.audit.log(
        tx,
        { tenantId, userId: auth.userId, campusId, action: 'UPDATE', entityType: 'SETTING', entityId: row.id, oldValues: existing ? { key, value: existing.settingValue } : null, newValues: { key, campusId, value } },
        client,
      );
      return { key, campusId, value: row.settingValue };
    });
  }

  /** Removes a campus override (or the institution value), falling back to the next level. */
  async reset(key: string, campusId: string | null, auth: AuthContext, client: ClientInfo) {
    const def = SETTINGS_BY_KEY[key];
    if (!def) throw unknownKey(key);
    this.checkWriteScope(def, campusId, auth);
    return this.db.run({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const existing = await tx.setting.findFirst({ where: { settingKey: key, campusId }, select: { id: true, settingValue: true } });
      if (!existing) return { key, campusId, reset: false };
      await tx.setting.delete({ where: { id: existing.id } });
      await this.audit.log(tx, { tenantId: auth.tenantId!, userId: auth.userId, campusId, action: 'DELETE', entityType: 'SETTING', entityId: existing.id, oldValues: { key, value: existing.settingValue } }, client);
      return { key, campusId, reset: true };
    });
  }

  private checkWriteScope(def: SettingDefinition, campusId: string | null, auth: AuthContext) {
    const scope = scopeFor(auth, PERMISSIONS.ORG_SETTINGS_UPDATE)!;
    if (campusId) {
      if (!def.scopes.includes('CAMPUS')) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'setting-not-per-campus', `"${def.label}" can only be set for the whole institution`);
      if (!canAccessCampus(scope, campusId)) throw NotFound('Campus');
    } else {
      if (!def.scopes.includes('TENANT')) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'setting-campus-only', `"${def.label}" is set per campus`);
      if (!scope.all) throw Forbidden('scope-insufficient', 'Only institution-wide users can change institution settings');
    }
  }
}
